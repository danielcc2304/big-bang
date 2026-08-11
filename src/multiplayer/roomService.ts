import { get, onDisconnect, onValue, push, ref, runTransaction, set, update } from 'firebase/database';
import type { GameCommand, OnlinePlayer, Room, Seat } from '../types';
import { ensureAnonymousUser, firebaseServices } from '../firebase/client';
import { createReconnectToken, hashReconnectToken, saveReconnectToken } from './identity';
import { hydrateRoom } from './hydrate';
import { LEASE_DURATION_MS } from './coordinator';
import { createGame, type PlayerSetup } from '../game/engine';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = (): string => Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
const normalizeCode = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export interface RoomIdentity { readonly code: string; readonly uid: string; readonly playerId: string; readonly reconnectToken: string }

export const createRoom = async (displayName: string, maxPlayers: 4 | 5 | 6 | 7, characterMode: Room['characterMode']): Promise<RoomIdentity> => {
  const user = await ensureAnonymousUser();
  const services = firebaseServices()!;
  const playerId = `player-${user.uid.slice(0, 10)}`;
  const token = createReconnectToken();
  const hash = await hashReconnectToken(token);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = roomCode();
    const now = Date.now();
    const seat: Seat = { number: 0, playerId, ownerUid: user.uid, reconnectHash: null, isBot: false, joinedAt: now };
    const onlinePlayer: OnlinePlayer = { uid: user.uid, playerId, displayName, connected: true, lastSeen: now };
    const room: Room = {
      code, status: 'LOBBY', createdAt: now, hostUid: user.uid, maxPlayers, characterMode,
      seats: { 0: seat }, players: { [playerId]: onlinePlayer },
      coordinator: { coordinatorId: user.uid, coordinatorEpoch: 1, leaseUntil: now + LEASE_DURATION_MS, heartbeat: now },
      canonical: null, commands: {},
    };
    const transaction = await runTransaction(ref(services.database, `rooms/${code}`), (current: Room | null) => current === null ? room : undefined, { applyLocally: false });
    if (transaction.committed) {
      await set(ref(services.database, `seatProofs/${code}/0`), hash);
      saveReconnectToken(code, token);
      await configurePresence(code, playerId, user.uid);
      return { code, uid: user.uid, playerId, reconnectToken: token };
    }
  }
  throw new Error('No se pudo reservar un código de sala.');
};

export const joinRoom = async (rawCode: string, displayName: string): Promise<RoomIdentity> => {
  const code = normalizeCode(rawCode);
  const user = await ensureAnonymousUser();
  const services = firebaseServices()!;
  const token = createReconnectToken();
  const hash = await hashReconnectToken(token);
  const playerId = `player-${user.uid.slice(0, 10)}`;
  const roomValue = (await get(ref(services.database, `rooms/${code}`))).val() as Room | null;
  const roomSnapshot = roomValue ? hydrateRoom(roomValue) : null;
  if (!roomSnapshot || roomSnapshot.status !== 'LOBBY') throw new Error('La sala no existe o ya ha empezado.');
  const transaction = await runTransaction(ref(services.database, `rooms/${code}/seats`), (seats: Room['seats'] | null) => {
    const currentSeats = seats ?? {};
    const used = Object.keys(currentSeats).map(Number);
    if (used.length >= roomSnapshot.maxPlayers) return;
    const number = Array.from({ length: roomSnapshot.maxPlayers }, (_, index) => index).find((seat) => !used.includes(seat));
    if (number === undefined) return;
    const now = Date.now();
    return { ...currentSeats, [number]: { number, playerId, ownerUid: user.uid, reconnectHash: null, isBot: false, joinedAt: now } };
  }, { applyLocally: false });
  if (!transaction.committed) throw new Error('La sala ya está completa.');
  const claimedSeat = Object.values(transaction.snapshot.val() as Room['seats']).find((seat) => seat.playerId === playerId)?.number;
  if (claimedSeat === undefined) throw new Error('No se pudo confirmar el asiento.');
  await set(ref(services.database, `rooms/${code}/players/${playerId}`), { uid: user.uid, playerId, displayName, connected: true, lastSeen: Date.now() } satisfies OnlinePlayer);
  await set(ref(services.database, `seatProofs/${code}/${claimedSeat}`), hash);
  saveReconnectToken(code, token);
  await configurePresence(code, playerId, user.uid);
  return { code, uid: user.uid, playerId, reconnectToken: token };
};

export const reconnectToRoom = async (rawCode: string, token: string): Promise<RoomIdentity> => {
  const code = normalizeCode(rawCode);
  const user = await ensureAnonymousUser();
  const services = firebaseServices()!;
  const hash = await hashReconnectToken(token);
  const roomValue = (await get(ref(services.database, `rooms/${code}`))).val() as Room | null;
  const room = roomValue ? hydrateRoom(roomValue) : null;
  if (!room || room.status === 'ENDED') throw new Error('La sala no existe o ya terminó.');
  const owned = Object.values(room.seats).find((seat) => seat.ownerUid === user.uid);
  if (!owned) {
    await set(ref(services.database, `reconnectClaims/${code}/${user.uid}`), { hash, requestedAt: Date.now() });
  }
  const claimedPlayerId = owned?.playerId ?? await new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => { unsubscribe(); reject(new Error('La clave no fue validada. Debe haber un coordinador conectado.')); }, 12_000);
    const unsubscribe = onValue(ref(services.database, `rooms/${code}/seats`), (snapshot) => {
      const seats = snapshot.val() as Room['seats'] | null;
      const seat = seats && Object.values(seats).find((candidate) => candidate.ownerUid === user.uid);
      if (seat) { window.clearTimeout(timeout); unsubscribe(); resolve(seat.playerId); }
    });
  });
  saveReconnectToken(code, token);
  await configurePresence(code, claimedPlayerId, user.uid);
  return { code, uid: user.uid, playerId: claimedPlayerId, reconnectToken: token };
};

export const processReconnectClaims = async (code: string, coordinatorUid: string): Promise<void> => {
  const services = firebaseServices();
  if (!services) return;
  const [roomSnapshot, claimsSnapshot, proofsSnapshot] = await Promise.all([
    get(ref(services.database, `rooms/${code}`)),
    get(ref(services.database, `reconnectClaims/${code}`)),
    get(ref(services.database, `seatProofs/${code}`)),
  ]);
  const roomValue = roomSnapshot.val() as Room | null;
  const room = roomValue ? hydrateRoom(roomValue) : null;
  if (!room || room.coordinator.coordinatorId !== coordinatorUid) return;
  const claims = claimsSnapshot.val() as Record<string, { hash: string; requestedAt: number }> | null;
  const proofs = proofsSnapshot.val() as Record<string, string> | null;
  if (!claims || !proofs) return;
  for (const [uid, claim] of Object.entries(claims)) {
    const seatNumber = Object.entries(proofs).find(([, proof]) => proof === claim.hash)?.[0];
    const seat = seatNumber ? room.seats[seatNumber] : undefined;
    if (!seat) continue;
    await update(ref(services.database), {
      [`rooms/${code}/seats/${seatNumber}/ownerUid`]: uid,
      [`rooms/${code}/players/${seat.playerId}/uid`]: uid,
      [`rooms/${code}/players/${seat.playerId}/connected`]: true,
      [`rooms/${code}/players/${seat.playerId}/lastSeen`]: Date.now(),
      [`reconnectClaims/${code}/${uid}`]: null,
    });
  }
};

export const enqueueCommand = async (code: string, command: GameCommand, uid: string): Promise<void> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado.');
  const roomValue = (await get(ref(services.database, `rooms/${code}`))).val() as Room | null;
  const room = roomValue ? hydrateRoom(roomValue) : null;
  const seat = room && Object.values(room.seats).find((candidate) => candidate.playerId === command.playerId);
  if (!seat || seat.ownerUid !== uid) throw new Error('No eres propietario de este asiento.');
  await set(ref(services.database, `rooms/${code}/commands/${command.commandId}`), { command, submittedByUid: uid, submittedAt: Date.now() });
};

export const endOnlineRoom = async (code: string, uid: string): Promise<void> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado.');
  const roomValue = (await get(ref(services.database, `rooms/${code}`))).val() as Room | null;
  const room = roomValue ? hydrateRoom(roomValue) : null;
  if (!room || room.hostUid !== uid || room.coordinator.coordinatorId !== uid) throw new Error('Solo el host coordinador puede finalizar la partida.');
  await update(ref(services.database, `rooms/${code}`), { status: 'ENDED', endedAt: Date.now() });
};

export const startOnlineGame = async (code: string, uid: string): Promise<void> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado.');
  const result = await runTransaction(ref(services.database, `rooms/${code}`), (value: Room | null) => {
    const room = value ? hydrateRoom(value) : null;
    if (!room || room.status !== 'LOBBY' || room.hostUid !== uid) return;
    const humanSeats = Object.values(room.seats).sort((a, b) => a.number - b.number);
    const nextSeats = { ...room.seats };
    const setups: PlayerSetup[] = humanSeats.map((seat) => ({ id: seat.playerId, name: room.players[seat.playerId]?.displayName ?? `Jugador ${seat.number + 1}`, kind: 'HUMAN' }));
    for (let seat = humanSeats.length; seat < room.maxPlayers; seat += 1) {
      const playerId = `bot-${seat}`;
      nextSeats[seat] = { number: seat, playerId, ownerUid: null, reconnectHash: null, isBot: true, joinedAt: Date.now() };
      setups.push({ id: playerId, name: ['Coyote', 'Sombra', 'Maverick', 'Ruby', 'Doc', 'Rattler'][seat - humanSeats.length] ?? `Bot ${seat}`, kind: 'AI' });
    }
    return { ...room, status: 'PLAYING', seats: nextSeats, canonical: createGame(setups, Date.now()) };
  }, { applyLocally: false });
  if (!result.committed) throw new Error('Solo el host puede iniciar una sala abierta.');
};

const configurePresence = async (code: string, playerId: string, uid: string): Promise<void> => {
  const services = firebaseServices()!;
  const presence = ref(services.database, `rooms/${code}/players/${playerId}`);
  await onDisconnect(presence).update({ connected: false, lastSeen: Date.now(), uid });
  await update(presence, { connected: true, lastSeen: Date.now(), uid });
};

export const createCommandKey = (code: string): string => push(ref(firebaseServices()!.database, `rooms/${code}/commands`)).key ?? crypto.randomUUID();
