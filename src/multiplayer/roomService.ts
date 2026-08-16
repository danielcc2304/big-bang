import { get, onDisconnect, onValue, ref, remove, runTransaction, serverTimestamp, set, update } from 'firebase/database';
import type { CommandEnvelope, GameCommand, OnlinePlayer, Room, Seat } from '../types';
import { ensureAnonymousUser, firebaseServices } from '../firebase/client';
import { createReconnectToken, hashReconnectToken, loadReconnectToken, saveReconnectToken } from './identity';
import { hydrateRoom } from './hydrate';
import { acquireCoordinatorLease, LEASE_DURATION_MS } from './coordinator';
import { DISCONNECTED_TAKEOVER_MS } from './onlineAutomation';
import { createGame, type PlayerSetup } from '../game/engine';
import { isGameCommand } from '../game/engine/commands';
import { secureId } from '../utils/random';
import { serverNow, syncServerClock } from '../firebase/clock';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COMMAND_SLOTS = 100;
const commandSlotStart = (commandId: string): number => {
  let hash = 2166136261;
  for (const character of commandId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % COMMAND_SLOTS;
};
const roomCode = (): string => {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint32Array(6);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
  }
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
};
const normalizeCode = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const isPermissionDenied = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === 'PERMISSION_DENIED' || code === 'permission_denied';
};

export interface RoomIdentity { readonly code: string; readonly uid: string; readonly playerId: string; readonly reconnectToken: string; readonly presenceConnectionId?: string }

export const createRoom = async (displayName: string, maxPlayers: 4 | 5 | 6 | 7, characterMode: Room['characterMode']): Promise<RoomIdentity> => {
  const user = await ensureAnonymousUser();
  const services = firebaseServices()!;
  await syncServerClock(services.database);
  const playerId = `player-${user.uid.slice(0, 10)}`;
  const token = createReconnectToken();
  const hash = await hashReconnectToken(token);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = roomCode();
    const now = serverNow();
    const seat: Seat = { number: 0, playerId, ownerUid: user.uid, reconnectHash: null, isBot: false, joinedAt: now };
    const onlinePlayer: OnlinePlayer = { uid: user.uid, playerId, displayName, connected: true, lastSeen: now };
    const room: Room = {
      code, status: 'LOBBY', createdAt: now, hostUid: user.uid, maxPlayers, characterMode,
      seats: { 0: seat }, players: { [playerId]: onlinePlayer },
      coordinator: { coordinatorId: user.uid, coordinatorEpoch: 1, leaseUntil: now + LEASE_DURATION_MS, heartbeat: now },
      canonical: null, commands: {}, commandReceipts: {}, presence: {},
    };
    let committed = false;
    try {
      const transaction = await runTransaction(ref(services.database, `rooms/${code}`), (current: Room | null) => current === null ? room : undefined, { applyLocally: false });
      committed = transaction.committed;
    } catch (error) {
      // Older deployments may still have the hardened room read rule that
      // rejects the null preflight read required by a transaction. A direct
      // create remains protected by the room .write condition (!data.exists())
      // and lets those deployments recover without weakening collision safety.
      if (!isPermissionDenied(error)) throw error;
      await set(ref(services.database, `rooms/${code}`), room);
      committed = true;
    }
    if (committed) {
      try {
        await set(ref(services.database, `seatProofs/${code}/0`), hash);
        saveReconnectToken(code, token);
        const presenceConnectionId = await configurePresence(code, playerId, user.uid);
        return { code, uid: user.uid, playerId, reconnectToken: token, presenceConnectionId };
      } catch (error) {
        await rollbackLobbySeat(code, 0, user.uid, playerId);
        throw error;
      }
    }
  }
  throw new Error('No se pudo reservar un código de sala.');
};

export const joinRoom = async (rawCode: string, displayName: string): Promise<RoomIdentity> => {
  const code = normalizeCode(rawCode);
  const user = await ensureAnonymousUser();
  const services = firebaseServices()!;
  await syncServerClock(services.database);
  const token = createReconnectToken();
  const hash = await hashReconnectToken(token);
  const playerId = `player-${user.uid.slice(0, 10)}`;
  const roomValue = (await get(ref(services.database, `rooms/${code}`))).val() as Room | null;
  const roomSnapshot = roomValue ? hydrateRoom(roomValue) : null;
  if (!roomSnapshot || roomSnapshot.status !== 'LOBBY') throw new Error('La sala no existe o ya ha empezado.');
  const existingSeat = Object.values(roomSnapshot.seats).find((seat) => seat.ownerUid === user.uid);
  if (existingSeat) {
    const storedToken = loadReconnectToken(code);
    if (!storedToken) throw new Error('Ya tienes un asiento en esta sala. Usa la clave de recuperación para volver a entrar.');
    const presenceConnectionId = await configurePresence(code, existingSeat.playerId, user.uid);
    return { code, uid: user.uid, playerId: existingSeat.playerId, reconnectToken: storedToken, presenceConnectionId };
  }
  let claimedSeat: number | undefined;
  for (let number = 0; number < roomSnapshot.maxPlayers; number += 1) {
    const transaction = await runTransaction(ref(services.database, `rooms/${code}/seats/${number}`), (seat: Seat | null) => {
      if (seat !== null) return;
      return { number, playerId, ownerUid: user.uid, reconnectHash: null, isBot: false, joinedAt: serverNow() } satisfies Seat;
    }, { applyLocally: false });
    if (transaction.committed) {
      claimedSeat = number;
      break;
    }
  }
  if (claimedSeat === undefined) throw new Error('No se pudo confirmar el asiento.');
  try {
    await set(ref(services.database, `rooms/${code}/players/${playerId}`), { uid: user.uid, playerId, displayName, connected: true, lastSeen: serverNow() } satisfies OnlinePlayer);
    await set(ref(services.database, `seatProofs/${code}/${claimedSeat}`), hash);
    saveReconnectToken(code, token);
    const presenceConnectionId = await configurePresence(code, playerId, user.uid);
    return { code, uid: user.uid, playerId, reconnectToken: token, presenceConnectionId };
  } catch (error) {
    await rollbackLobbySeat(code, claimedSeat, user.uid, playerId);
    throw error;
  }
};

export const reconnectToRoom = async (rawCode: string, token: string): Promise<RoomIdentity> => {
  const code = normalizeCode(rawCode);
  const user = await ensureAnonymousUser();
  const services = firebaseServices()!;
  await syncServerClock(services.database);
  const hash = await hashReconnectToken(token);
  let room: Room | null = null;
  try {
    const roomValue = (await get(ref(services.database, `rooms/${code}`))).val() as Room | null;
    room = roomValue ? hydrateRoom(roomValue) : null;
  } catch (error) {
    // A new device is not a member yet, so hardened rules may deny the room
    // root. It can still submit a claim and wait on the public seat branch.
    const codeValue = (error as { readonly code?: string }).code;
    if (codeValue !== 'PERMISSION_DENIED') throw error;
  }
  if (room?.status === 'ENDED') throw new Error('La sala no existe o ya terminó.');
  const owned = room ? Object.values(room.seats).find((seat) => seat.ownerUid === user.uid) : undefined;
  let recoveryTimer: number | undefined;
  if (!owned) {
    try {
      await set(ref(services.database, `reconnectClaims/${code}/${user.uid}`), { hash, requestedAt: serverNow() });
    } catch (error) {
      if ((error as { readonly code?: string }).code === 'PERMISSION_DENIED') throw new Error('La clave de recuperacion no es valida para esta sala.');
      throw error;
    }
    const attemptRecovery = async (): Promise<void> => {
      try {
        const lease = await acquireCoordinatorLease(code, user.uid);
        if (lease) await processReconnectClaims(code, user.uid);
      } catch {
        // Another coordinator may still own the lease, or the room may have ended.
      }
    };
    await attemptRecovery();
    recoveryTimer = window.setInterval(() => void attemptRecovery(), 1_500);
  }
  const claimedPlayerId = owned?.playerId ?? await new Promise<string>((resolve, reject) => {
    const stopRecovery = (): void => { if (recoveryTimer !== undefined) { window.clearInterval(recoveryTimer); recoveryTimer = undefined; } };
    let unsubscribe: () => void = () => undefined;
    const timeout = window.setTimeout(() => { stopRecovery(); unsubscribe(); reject(new Error('La clave no fue validada. La sala debe seguir activa.')); }, 12_000);
    unsubscribe = onValue(ref(services.database, `rooms/${code}/seats`), (snapshot) => {
      const seats = snapshot.val() as Room['seats'] | null;
      const seat = seats && Object.values(seats).find((candidate) => candidate.ownerUid === user.uid);
      if (seat) { window.clearTimeout(timeout); stopRecovery(); unsubscribe(); resolve(seat.playerId); }
    }, (error) => { window.clearTimeout(timeout); stopRecovery(); unsubscribe(); reject(error); });
  });
  if (recoveryTimer !== undefined) window.clearInterval(recoveryTimer);
  saveReconnectToken(code, token);
  const presenceConnectionId = await configurePresence(code, claimedPlayerId, user.uid);
  return { code, uid: user.uid, playerId: claimedPlayerId, reconnectToken: token, presenceConnectionId };
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
  if (!room || room.status === 'ENDED' || room.coordinator.coordinatorId !== coordinatorUid || room.coordinator.leaseUntil <= serverNow()) return;
  const now = serverNow();
  const stalePresencePaths = Object.entries(room.presence ?? {}).flatMap(([playerId, connections]) => Object.entries(connections).filter(([, connection]) => now - connection.lastSeen > 60_000).map(([connectionId]) => `rooms/${code}/presence/${playerId}/${connectionId}`));
  if (stalePresencePaths.length > 0) await Promise.all(stalePresencePaths.map((path) => runTransaction(ref(services.database, path), (connection: { readonly lastSeen?: number } | null) => connection && typeof connection.lastSeen === 'number' && now - connection.lastSeen > 60_000 ? null : undefined, { applyLocally: false }).catch(() => undefined)));
  const presenceUpdates = Object.entries(room.players).flatMap(([playerId, player]) => {
    const connections = room.presence?.[playerId];
    if (!connections) return [];
    const live = Object.values(connections).some((connection) => connection.uid === player.uid && connection.connected && now - connection.lastSeen < DISCONNECTED_TAKEOVER_MS);
    if (live === player.connected) return [];
    return [update(ref(services.database, `rooms/${code}/players/${playerId}`), { connected: live, lastSeen: live ? Math.max(...Object.values(connections).map((connection) => connection.lastSeen)) : now }).catch(() => undefined)];
  });
  if (presenceUpdates.length > 0) await Promise.all(presenceUpdates);
  const claims = claimsSnapshot.val() as Record<string, { hash: string; requestedAt: number }> | null;
  const proofs = proofsSnapshot.val() as Record<string, string> | null;
  if (!claims || !proofs) return;
  for (const [uid, claim] of Object.entries(claims)) {
    if (!claim || typeof claim.hash !== 'string' || !Number.isFinite(claim.requestedAt) || now - claim.requestedAt > 30_000 || claim.requestedAt - now > 10_000) {
      await remove(ref(services.database, `reconnectClaims/${code}/${uid}`));
      continue;
    }
    const seatNumber = Object.entries(proofs).find(([, proof]) => proof === claim.hash)?.[0];
    const seat = seatNumber ? room.seats[seatNumber] : undefined;
    if (!seatNumber || !seat) {
      await remove(ref(services.database, `reconnectClaims/${code}/${uid}`));
      continue;
    }
    const matchedSeatNumber = seatNumber;
    const result = await runTransaction(ref(services.database, `rooms/${code}`), (current: Room | null) => {
      const nextRoom = current ? hydrateRoom(current) : null;
      if (!nextRoom || nextRoom.status === 'ENDED' || nextRoom.coordinator.coordinatorId !== coordinatorUid || nextRoom.coordinator.leaseUntil <= serverNow()) return;
      const currentSeat = nextRoom.seats[matchedSeatNumber];
      const currentPlayer = currentSeat ? nextRoom.players[currentSeat.playerId] : undefined;
      if (!currentSeat || !currentPlayer) return;
      const connections = nextRoom.presence?.[currentSeat.playerId];
      const activeConnection = connections
        ? Object.values(connections).some((connection) => connection.uid === currentPlayer.uid && connection.connected && serverNow() - connection.lastSeen < DISCONNECTED_TAKEOVER_MS)
        : currentPlayer.connected;
      if (currentSeat.ownerUid && currentSeat.ownerUid !== uid && activeConnection) return;
      return {
        ...nextRoom,
        seats: { ...nextRoom.seats, [matchedSeatNumber]: { ...currentSeat, ownerUid: uid } },
        players: { ...nextRoom.players, [currentSeat.playerId]: { ...currentPlayer, uid, connected: true, lastSeen: serverNow() } },
      };
    }, { applyLocally: false });
    if (result.committed) await remove(ref(services.database, `reconnectClaims/${code}/${uid}`));
  }
};

export const enqueueCommand = async (code: string, command: GameCommand, uid: string): Promise<void> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado.');
  if (!isGameCommand(command)) throw new Error('La accion no tiene un formato valido.');
  // Rules validate command timestamps against Firebase's server clock. A
  // tablet with a wrong local clock must not be rejected before the engine
  // gets a chance to process its action.
  const submittedAt = serverNow();
  const normalizedCommand = { ...command, createdAt: submittedAt } satisfies GameCommand;
  const roomValue = (await get(ref(services.database, `rooms/${code}`))).val() as Room | null;
  const room = roomValue ? hydrateRoom(roomValue) : null;
  if (!room || room.status !== 'PLAYING') throw new Error('La partida no está disponible para recibir acciones.');
  const seat = Object.values(room.seats).find((candidate) => candidate.playerId === normalizedCommand.playerId);
  if (!seat || seat.ownerUid !== uid) throw new Error('No eres propietario de este asiento.');
  const existing = Object.values(room.commands).find((envelope) => envelope?.command?.commandId === normalizedCommand.commandId && envelope.submittedByUid === uid);
  if (existing || room.commandReceipts?.[normalizedCommand.commandId]) return;
  if (Object.keys(room.commands).length >= COMMAND_SLOTS) throw new Error('La cola de acciones está llena. Espera un instante.');
  const recentByUser = Object.values(room.commands).filter((envelope) => envelope.submittedByUid === uid && submittedAt - envelope.submittedAt < 10_000);
  if (recentByUser.length >= 20) throw new Error('Has enviado demasiadas acciones seguidas.');
  const envelope = { command: normalizedCommand, submittedByUid: uid, submittedAt };
  const start = commandSlotStart(normalizedCommand.commandId);
  for (let slot = 0; slot < COMMAND_SLOTS; slot += 1) {
    const slotKey = `slot-${(start + slot) % COMMAND_SLOTS}`;
    const result = await runTransaction(ref(services.database, `rooms/${code}/commands/${slotKey}`), (current: CommandEnvelope | null) => {
      // Returning undefined for an already stored command makes the
      // transaction a read-only conflict resolution. Returning `current`
      // would issue a write and violate the RTDB `!data.exists()` rule.
      if (current?.command?.commandId === normalizedCommand.commandId && current.submittedByUid === uid) return;
      return current === null ? envelope : undefined;
    }, { applyLocally: false });
    const snapshotEnvelope = result.snapshot.val() as CommandEnvelope | null;
    if (result.committed || (snapshotEnvelope?.command?.commandId === normalizedCommand.commandId && snapshotEnvelope.submittedByUid === uid)) return;
  }
  throw new Error('La cola de acciones se lleno mientras esperabas. Vuelve a intentarlo.');
};

export const endOnlineRoom = async (code: string, uid: string): Promise<void> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado.');
  const result = await runTransaction(ref(services.database, `rooms/${code}`), (value: Room | null) => {
    const room = value ? hydrateRoom(value) : null;
    if (!room || room.status === 'ENDED' || room.hostUid !== uid || room.coordinator.coordinatorId !== uid || room.coordinator.leaseUntil <= serverNow()) return;
    return { ...room, status: 'ENDED', endedAt: serverNow(), commands: {} };
  }, { applyLocally: false });
  if (!result.committed) throw new Error('La sala ya terminó o el lease del coordinador ha caducado.');
};

export const startOnlineGame = async (code: string, uid: string): Promise<void> => {
  const services = firebaseServices();
  const gameSeed = serverNow();
  if (!services) throw new Error('Firebase no está configurado.');
  const result = await runTransaction(ref(services.database, `rooms/${code}`), (value: Room | null) => {
    const room = value ? hydrateRoom(value) : null;
    if (!room || room.status !== 'LOBBY' || room.hostUid !== uid) return;
    const humanSeats = Object.values(room.seats).filter((seat) => seat.number >= 0 && seat.number < room.maxPlayers).sort((a, b) => a.number - b.number);
    const playerIds = humanSeats.map((seat) => seat.playerId);
    if (new Set(playerIds).size !== playerIds.length || new Set(humanSeats.map((seat) => seat.number)).size !== humanSeats.length || humanSeats.some((seat) => !room.players[seat.playerId])) return;
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
    return { ...room, status: 'PLAYING', seats: nextSeats, canonical: createGame(setups, gameSeed, room.characterMode), commandReceipts: {}, commands: {} };
  }, { applyLocally: false });
  if (!result.committed) throw new Error('Solo el host puede iniciar una sala abierta.');
};

export const refreshPresence = async (code: string, playerId: string, uid: string, connectionId: string): Promise<void> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado.');
  const presence = ref(services.database, `rooms/${code}/players/${playerId}`);
  const connection = ref(services.database, `rooms/${code}/presence/${playerId}/${connectionId}`);
  const connectedAt = serverNow();
  await onDisconnect(connection).set({ uid, connected: false, connectedAt, lastSeen: serverTimestamp() });
  // Replace the full record after every reconnect so a partially written or
  // stale presence node can never remain visible as connected.
  await set(connection, { uid, connected: true, connectedAt, lastSeen: serverTimestamp() });
  await update(presence, { connected: true, lastSeen: serverTimestamp(), uid });
};

export const markPresenceOffline = async (code: string, playerId: string, uid: string, connectionId: string): Promise<void> => {
  const services = firebaseServices();
  if (!services) return;
  await update(ref(services.database, `rooms/${code}/presence/${playerId}/${connectionId}`), { uid, connected: false, lastSeen: serverTimestamp() });
};

const configurePresence = async (code: string, playerId: string, uid: string): Promise<string> => {
  const services = firebaseServices()!;
  const connectionId = secureId('connection');
  try {
    await refreshPresence(code, playerId, uid, connectionId);
    return connectionId;
  } catch (error) {
    await remove(ref(services.database, `rooms/${code}/presence/${playerId}/${connectionId}`)).catch(() => undefined);
    throw error;
  }
};
const rollbackLobbySeat = async (code: string, seatNumber: number, uid: string, playerId: string): Promise<void> => {
  const services = firebaseServices();
  if (!services) return;
  const result = await runTransaction(ref(services.database, `rooms/${code}/seats/${seatNumber}`), (seat: Seat | null) => seat?.ownerUid === uid && seat.playerId === playerId ? null : undefined, { applyLocally: false }).catch(() => ({ committed: false }));
  if (!result.committed) return;
  await remove(ref(services.database, `rooms/${code}/players/${playerId}`)).catch(() => undefined);
  await remove(ref(services.database, `seatProofs/${code}/${seatNumber}`)).catch(() => undefined);
};

