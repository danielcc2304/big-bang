import type { GameCommand, OnlinePlayer, Room, Seat } from '../types';
import { ensureAnonymousUser } from '../supabase/client';
import { serverNow, syncServerClock } from '../supabase/clock';
import { createReconnectToken, hashReconnectToken, loadReconnectToken, saveReconnectToken } from './identity';
import { createGame, type PlayerSetup } from '../game/engine';
import { isGameCommand } from '../game/engine/commands';
import { secureId } from '../utils/random';
import {
  claimReconnect,
  createRoomRecord,
  endRoomRecord,
  enqueueCommandRecord,
  getRoomSnapshot,
  joinRoomRecord,
  saveSeatProof,
  startRoomRecord,
  updatePresence,
} from './supabaseRepository';
import { LEASE_DURATION_MS } from './coordinator';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COMMAND_SLOTS = 100;
const roomCode = (): string => {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint32Array(6);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
  }
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
};
const normalizeCode = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export interface RoomIdentity {
  readonly code: string;
  readonly uid: string;
  readonly playerId: string;
  readonly reconnectToken: string;
  readonly presenceConnectionId?: string;
}

export const createRoom = async (displayName: string, maxPlayers: 4 | 5 | 6 | 7, characterMode: Room['characterMode']): Promise<RoomIdentity> => {
  const user = await ensureAnonymousUser();
  await syncServerClock();
  const playerId = `player-${user.id.slice(0, 10)}`;
  const token = createReconnectToken();
  const hash = await hashReconnectToken(token);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = roomCode();
    const now = serverNow();
    const seat: Seat = { number: 0, playerId, ownerUid: user.id, reconnectHash: null, isBot: false, joinedAt: now };
    const onlinePlayer: OnlinePlayer = { uid: user.id, playerId, displayName, connected: true, lastSeen: now };
    const room: Room = {
      code,
      status: 'LOBBY',
      createdAt: now,
      hostUid: user.id,
      maxPlayers,
      characterMode,
      seats: { 0: seat },
      players: { [playerId]: onlinePlayer },
      coordinator: { coordinatorId: user.id, coordinatorEpoch: 1, leaseUntil: now + LEASE_DURATION_MS, heartbeat: now },
      canonical: null,
      commands: {},
      commandReceipts: {},
      presence: {},
      transportVersion: 0,
    };
    if (!await createRoomRecord(code, room, playerId, displayName, now)) continue;
    await saveSeatProof(code, 0, hash);
    saveReconnectToken(code, token);
    const presenceConnectionId = await configurePresence(code, playerId);
    return { code, uid: user.id, playerId, reconnectToken: token, presenceConnectionId };
  }
  throw new Error('No se pudo reservar un código de sala.');
};

export const joinRoom = async (rawCode: string, displayName: string): Promise<RoomIdentity> => {
  const code = normalizeCode(rawCode);
  const user = await ensureAnonymousUser();
  await syncServerClock();
  const playerId = `player-${user.id.slice(0, 10)}`;
  const token = createReconnectToken();
  const hash = await hashReconnectToken(token);
  const joined = await joinRoomRecord(code, playerId, displayName, serverNow());
  const reconnectToken = joined.existing ? loadReconnectToken(code) : token;
  if (!reconnectToken) throw new Error('Ya tienes un asiento en esta sala. Usa la clave de recuperación para volver a entrar.');
  if (!joined.existing) {
    await saveSeatProof(code, joined.seat, hash);
    saveReconnectToken(code, token);
  }
  const presenceConnectionId = await configurePresence(code, joined.playerId);
  return { code, uid: user.id, playerId: joined.playerId, reconnectToken, presenceConnectionId };
};

export const reconnectToRoom = async (rawCode: string, token: string): Promise<RoomIdentity> => {
  const code = normalizeCode(rawCode);
  const user = await ensureAnonymousUser();
  await syncServerClock();
  const hash = await hashReconnectToken(token);
  const claimed = await claimReconnect(code, hash);
  saveReconnectToken(code, token);
  const presenceConnectionId = await configurePresence(code, claimed.playerId);
  return { code, uid: user.id, playerId: claimed.playerId, reconnectToken: token, presenceConnectionId };
};

/** Recovery is atomic in PostgreSQL; this compatibility hook is intentionally idempotent. */
export const processReconnectClaims = (_code: string, _coordinatorUid: string): Promise<void> => {
  void _code;
  void _coordinatorUid;
  return Promise.resolve();
};

export const enqueueCommand = async (code: string, command: GameCommand, uid: string): Promise<void> => {
  if (!isGameCommand(command)) throw new Error('La acción no tiene un formato válido.');
  const room = await getRoomSnapshot(code);
  if (!room || room.status !== 'PLAYING') throw new Error('La partida no está disponible para recibir acciones.');
  const seat = Object.values(room.seats).find((candidate) => candidate.playerId === command.playerId);
  if (!seat || seat.ownerUid !== uid) throw new Error('No eres propietario de este asiento.');
  for (let slot = 0; slot < COMMAND_SLOTS; slot += 1) {
    if (await enqueueCommandRecord(code, `slot-${slot}`, command)) return;
  }
  throw new Error('La cola de acciones se llenó mientras esperabas. Vuelve a intentarlo.');
};

export const endOnlineRoom = async (code: string, uid: string): Promise<void> => {
  const room = await getRoomSnapshot(code);
  if (!room || room.status === 'ENDED' || room.hostUid !== uid || room.coordinator.coordinatorId !== uid || room.coordinator.leaseUntil <= serverNow()) {
    throw new Error('La sala ya terminó o el lease del coordinador ha caducado.');
  }
  if (!await endRoomRecord(code, room.transportVersion ?? 0, room.coordinator.coordinatorEpoch)) throw new Error('La sala cambió antes de finalizar. Reintenta.');
};

export const startOnlineGame = async (code: string, uid: string): Promise<void> => {
  const room = await getRoomSnapshot(code);
  const gameSeed = serverNow();
  if (!room || room.status !== 'LOBBY' || room.hostUid !== uid) throw new Error('Solo el host puede iniciar una sala abierta.');
  const humanSeats = Object.values(room.seats)
    .filter((seat) => seat.number >= 0 && seat.number < room.maxPlayers)
    .sort((left, right) => left.number - right.number);
  const playerIds = humanSeats.map((seat) => seat.playerId);
  if (new Set(playerIds).size !== playerIds.length || new Set(humanSeats.map((seat) => seat.number)).size !== humanSeats.length || humanSeats.some((seat) => !room.players[seat.playerId])) {
    throw new Error('La sala contiene asientos incompletos.');
  }
  const nextSeats = { ...room.seats };
  const seatsByNumber = new Map(humanSeats.map((seat) => [seat.number, seat]));
  const setups: PlayerSetup[] = [];
  let botIndex = 0;
  for (let seat = 0; seat < room.maxPlayers; seat += 1) {
    const human = seatsByNumber.get(seat);
    if (human) {
      setups.push({ id: human.playerId, name: room.players[human.playerId]?.displayName ?? `Jugador ${seat + 1}`, kind: 'HUMAN' });
      continue;
    }
    const playerId = `bot-${seat}`;
    nextSeats[seat] = { number: seat, playerId, ownerUid: null, reconnectHash: null, isBot: true, joinedAt: gameSeed };
    setups.push({ id: playerId, name: ['Coyote', 'Sombra', 'Maverick', 'Ruby', 'Doc', 'Rattler'][botIndex] ?? `Bot ${seat}`, kind: 'AI' });
    botIndex += 1;
  }
  const next: Room = {
    ...room,
    status: 'PLAYING',
    seats: nextSeats,
    canonical: createGame(setups, gameSeed, room.characterMode),
    commandReceipts: {},
    commands: {},
    presence: {},
  };
  if (!await startRoomRecord(code, room.transportVersion ?? 0, next)) throw new Error('La sala cambió antes de empezar. Reintenta.');
};

const configurePresence = async (code: string, playerId: string): Promise<string> => {
  const connectionId = secureId('connection');
  await updatePresence(code, playerId, connectionId, serverNow());
  return connectionId;
};
