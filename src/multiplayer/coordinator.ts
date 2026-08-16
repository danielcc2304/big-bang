import { ref, runTransaction } from 'firebase/database';
import type { CommandEnvelope, CommandReceipt, CommandResult, CoordinatorLease, GameCommand, Room } from '../types';
import { firebaseServices } from '../firebase/client';
import { hydrateGameCommand, hydrateRoom } from './hydrate';
import { applyCommand } from '../game/engine';
import { serverNow } from '../firebase/clock';

export const LEASE_DURATION_MS = 12_000;
const MAX_RECEIPTS = 200;

export const leaseIsValid = (lease: CoordinatorLease, now = serverNow()): boolean => lease.leaseUntil > now;

export const electCoordinator = (current: CoordinatorLease | null, candidateId: string, now: number): CoordinatorLease | null => {
  const currentIsActive = current !== null && current.leaseUntil > now;
  if (currentIsActive && current.coordinatorId !== candidateId) return null;
  // A lease reacquired after expiry must advance the epoch even when the same
  // browser wins again. Otherwise an in-flight transaction from the previous
  // lease could become valid again after the pause and mutate the room.
  const keepsActiveLease = currentIsActive && current?.coordinatorId === candidateId;
  return {
    coordinatorId: candidateId,
    coordinatorEpoch: (current?.coordinatorEpoch ?? 0) + (keepsActiveLease ? 0 : 1),
    leaseUntil: now + LEASE_DURATION_MS,
    heartbeat: now,
  };
};

export const acquireCoordinatorLease = async (roomCode: string, uid: string, fixedNow?: number): Promise<CoordinatorLease | null> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado.');
  const result = await runTransaction(ref(services.database, `rooms/${roomCode}/coordinator`), (current: CoordinatorLease | null) => {
    // Firebase can retry this callback. Read the clock on every attempt so an old
    // attempt cannot install a lease that is already expired.
    return electCoordinator(current, uid, fixedNow ?? serverNow()) ?? undefined;
  }, { applyLocally: false });
  return result.committed ? result.snapshot.val() as CoordinatorLease : null;
};

export const renewCoordinatorLease = async (roomCode: string, uid: string, epoch: number, fixedNow?: number): Promise<boolean> => {
  const services = firebaseServices();
  if (!services) return false;
  const result = await runTransaction(ref(services.database, `rooms/${roomCode}/coordinator`), (current: CoordinatorLease | null) => {
    if (!current || current.coordinatorId !== uid || current.coordinatorEpoch !== epoch) return;
    const now = fixedNow ?? serverNow();
    if (current.leaseUntil <= now) return;
    return { ...current, leaseUntil: now + LEASE_DURATION_MS, heartbeat: now };
  }, { applyLocally: false });
  return result.committed;
};

const receiptFor = (room: Room, commandId: string, coordinatorUid: string, status: CommandReceipt['status'], updatedAt: number, error?: string, revision?: number): CommandReceipt | null => {
  const envelope = Object.values(room.commands ?? {}).find((candidate) => candidate?.command?.commandId === commandId);
  if (!envelope) return null;
  return {
    commandId,
    submittedByUid: envelope.submittedByUid || coordinatorUid,
    status,
    updatedAt,
    ...(revision === undefined ? {} : { revision }),
    ...(error ? { error } : {}),
  };
};

const withReceipt = (room: Room, receipt: CommandReceipt | null): Room => {
  if (!receipt) return room;
  const all = { ...(room.commandReceipts ?? {}), [receipt.commandId]: receipt };
  const entries = Object.entries(all).sort(([, left], [, right]) => left.updatedAt - right.updatedAt).slice(-MAX_RECEIPTS);
  return { ...room, commandReceipts: Object.fromEntries(entries) };
};

const removeCommand = (room: Room, commandId: string): Readonly<Record<string, CommandEnvelope>> => Object.fromEntries(
  Object.entries(room.commands ?? {}).filter(([key, envelope]) => key !== commandId && envelope?.command?.commandId !== commandId),
);

const sanitizedCommands = (room: Room): Readonly<Record<string, CommandEnvelope>> => Object.fromEntries(
  Object.entries(room.commands ?? {}).filter(([, envelope]) => {
    if (!envelope || typeof envelope.submittedByUid !== 'string' || typeof envelope.submittedAt !== 'number' || !Number.isFinite(envelope.submittedAt)) return false;
    try { hydrateGameCommand(envelope.command); return true; } catch { return false; }
  }),
);

export const applyAuthoritativeCommand = async (roomCode: string, command: GameCommand, uid: string, epoch: number, fixedNow?: number): Promise<boolean> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado.');
  const result = await runTransaction(ref(services.database, `rooms/${roomCode}`), (value: Room | null) => {
    const room = value ? hydrateRoom(value) : null;
    const now = fixedNow ?? serverNow();
    if (!room?.canonical || room.status === 'ENDED') return;
    const lease = room.coordinator;
    if (lease.coordinatorId !== uid || lease.coordinatorEpoch !== epoch || lease.leaseUntil <= now) return;
    const safeRoom = { ...room, commands: sanitizedCommands(room) };
    const rawCommandId = typeof (command as unknown as { readonly commandId?: unknown })?.commandId === 'string' ? (command as unknown as { readonly commandId: string }).commandId : '';
    let hydratedCommand: GameCommand;
    try {
      hydratedCommand = hydrateGameCommand(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'El comando recibido estaba corrupto.';
      return withReceipt({ ...safeRoom, commands: removeCommand(safeRoom, rawCommandId) }, receiptFor(room, rawCommandId, uid, 'REJECTED', now, message));
    }
    const remainingCommands = removeCommand(safeRoom, hydratedCommand.commandId);
    const base = { ...safeRoom, commands: remainingCommands };
    const queuedEnvelope = Object.values(safeRoom.commands ?? {}).find((envelope) => envelope?.command?.commandId === hydratedCommand.commandId);
    if (queuedEnvelope && now - queuedEnvelope.submittedAt > 60_000) {
      return withReceipt(base, receiptFor(room, hydratedCommand.commandId, uid, 'REJECTED', now, 'La acción caducó mientras esperaba en la cola.'));
    }
    if (room.canonical.processedCommandIds.includes(hydratedCommand.commandId)) {
      return withReceipt(base, receiptFor(room, hydratedCommand.commandId, uid, 'APPLIED', now, undefined, room.canonical.revision));
    }
    const concurrentDraftChoice = hydratedCommand.type === 'CHARACTER_CHOICE' && room.canonical.turn.phase === 'CHARACTER_CHOICE' && !room.canonical.characterDraft?.chosenByPlayer[hydratedCommand.playerId];
    if (room.canonical.revision !== hydratedCommand.expectedRevision && !concurrentDraftChoice) {
      return withReceipt(base, receiptFor(room, hydratedCommand.commandId, uid, 'REJECTED', now, `La partida avanzó hasta la revisión ${room.canonical.revision}.`));
    }
    const authoritativeCommand = concurrentDraftChoice ? { ...hydratedCommand, expectedRevision: room.canonical.revision } : hydratedCommand;
    let applied: CommandResult;
    try {
      applied = applyCommand(room.canonical, authoritativeCommand);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'El comando no se pudo procesar.';
      return withReceipt(base, receiptFor(room, hydratedCommand.commandId, uid, 'REJECTED', now, message));
    }
    if (!applied.ok) return withReceipt(base, receiptFor(room, hydratedCommand.commandId, uid, 'REJECTED', now, applied.error.message));
    const next = { ...base, canonical: applied.state };
    return withReceipt(next, receiptFor(room, hydratedCommand.commandId, uid, 'APPLIED', now, undefined, applied.state.revision));
  }, { applyLocally: false });
  return result.committed;
};

export const removeMalformedCommand = async (roomCode: string, commandId: string, uid: string, epoch: number): Promise<boolean> => {
  const services = firebaseServices();
  if (!services) return false;
  const result = await runTransaction(ref(services.database, `rooms/${roomCode}`), (value: Room | null) => {
    const room = value ? hydrateRoom(value) : null;
    const now = serverNow();
    if (!room?.canonical || room.status === 'ENDED' || room.coordinator.coordinatorId !== uid || room.coordinator.coordinatorEpoch !== epoch || room.coordinator.leaseUntil <= now) return;
    const safeRoom = { ...room, commands: sanitizedCommands(room) };
    const entry = Object.entries(room.commands ?? {}).find(([key, candidate]) => key === commandId || candidate?.command?.commandId === commandId);
    const envelope = entry?.[1];
    const receipt: CommandReceipt | null = envelope ? {
      commandId: typeof envelope.command?.commandId === 'string' ? envelope.command.commandId : commandId,
      submittedByUid: typeof envelope.submittedByUid === 'string' ? envelope.submittedByUid : uid,
      status: 'REJECTED',
      updatedAt: now,
      error: 'La acción recibida estaba corrupta.',
    } : null;
    return withReceipt({ ...safeRoom, commands: removeCommand(safeRoom, commandId) }, receipt);
  }, { applyLocally: false });
  return result.committed;
};

