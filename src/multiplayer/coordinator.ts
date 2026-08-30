import type { CommandEnvelope, CommandReceipt, CommandResult, CoordinatorLease, GameCommand, Room } from '../types';
import { applyCommand } from '../game/engine';
import { hydrateGameCommand } from './hydrate';
import { serverNow } from '../supabase/clock';
import {
  acquireLeaseRecord,
  applyRoomStateRecord,
  getRoomSnapshot,
  renewLeaseRecord,
} from './supabaseRepository';

export const LEASE_DURATION_MS = 12_000;
const MAX_RECEIPTS = 200;

export const leaseIsValid = (lease: CoordinatorLease, now = serverNow()): boolean => lease.leaseUntil > now;

export const electCoordinator = (current: CoordinatorLease | null, candidateId: string, now: number): CoordinatorLease | null => {
  if (current && current.leaseUntil > now && current.coordinatorId !== candidateId) return null;
  return {
    coordinatorId: candidateId,
    coordinatorEpoch: (current?.coordinatorEpoch ?? 0) + (current?.coordinatorId === candidateId ? 0 : 1),
    leaseUntil: now + LEASE_DURATION_MS,
    heartbeat: now,
  };
};

export const acquireCoordinatorLease = async (roomCode: string, _uid: string, _fixedNow?: number): Promise<CoordinatorLease | null> => {
  void _uid;
  void _fixedNow;
  const result = await acquireLeaseRecord(roomCode);
  return result.acquired && result.lease ? result.lease : null;
};

export const renewCoordinatorLease = async (roomCode: string, _uid: string, epoch: number, _fixedNow?: number): Promise<boolean> => {
  void _uid;
  void _fixedNow;
  return renewLeaseRecord(roomCode, epoch);
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

const removeCommand = (room: Room, identifier: string): Readonly<Record<string, CommandEnvelope>> => Object.fromEntries(
  Object.entries(room.commands ?? {}).filter(([slotKey, envelope]) => slotKey !== identifier && envelope?.command?.commandId !== identifier),
);

const sanitizedCommands = (room: Room): Readonly<Record<string, CommandEnvelope>> => Object.fromEntries(
  Object.entries(room.commands ?? {}).filter(([, envelope]) => {
    if (!envelope || typeof envelope.submittedByUid !== 'string' || typeof envelope.submittedAt !== 'number' || !Number.isFinite(envelope.submittedAt)) return false;
    try { hydrateGameCommand(envelope.command); return true; } catch { return false; }
  }),
);

const queuedSlot = (room: Room, identifier: string): string | null => Object.entries(room.commands ?? {}).find(([slotKey, envelope]) => slotKey === identifier || envelope?.command?.commandId === identifier)?.[0] ?? null;

export const applyAuthoritativeCommand = async (roomCode: string, command: GameCommand, uid: string, epoch: number, fixedNow?: number): Promise<boolean> => {
  const room = await getRoomSnapshot(roomCode);
  const now = fixedNow ?? serverNow();
  if (!room?.canonical || room.status === 'ENDED' || room.coordinator.coordinatorId !== uid || room.coordinator.coordinatorEpoch !== epoch || room.coordinator.leaseUntil <= now) return false;
  const safeRoom: Room = { ...room, commands: sanitizedCommands(room) };
  const rawCommandId = typeof (command as unknown as { readonly commandId?: unknown })?.commandId === 'string' ? (command as unknown as { readonly commandId: string }).commandId : '';
  let hydratedCommand: GameCommand;
  try {
    hydratedCommand = hydrateGameCommand(command);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'El comando recibido estaba corrupto.';
    const next = { ...safeRoom, commands: removeCommand(safeRoom, rawCommandId) };
    const receipt = receiptFor(room, rawCommandId, uid, 'REJECTED', now, message);
    const result = await applyRoomStateRecord(roomCode, room.transportVersion ?? 0, epoch, withReceipt(next, receipt), rawCommandId || null, queuedSlot(room, rawCommandId), receipt);
    return result.applied;
  }
  const remainingCommands = removeCommand(safeRoom, hydratedCommand.commandId);
  const base = { ...safeRoom, commands: remainingCommands };
  const queuedEnvelope = Object.values(safeRoom.commands ?? {}).find((envelope) => envelope?.command?.commandId === hydratedCommand.commandId);
  if (queuedEnvelope && now - queuedEnvelope.submittedAt > 60_000) {
    const receipt = receiptFor(room, hydratedCommand.commandId, uid, 'REJECTED', now, 'La acción caducó mientras esperaba en la cola.');
    const result = await applyRoomStateRecord(roomCode, room.transportVersion ?? 0, epoch, withReceipt(base, receipt), hydratedCommand.commandId, queuedSlot(room, hydratedCommand.commandId), receipt);
    return result.applied;
  }
  if (room.canonical.processedCommandIds.includes(hydratedCommand.commandId)) {
    const receipt = receiptFor(room, hydratedCommand.commandId, uid, 'APPLIED', now, undefined, room.canonical.revision);
    const result = await applyRoomStateRecord(roomCode, room.transportVersion ?? 0, epoch, withReceipt(base, receipt), hydratedCommand.commandId, queuedSlot(room, hydratedCommand.commandId), receipt);
    return result.applied;
  }
  const concurrentDraftChoice = hydratedCommand.type === 'CHARACTER_CHOICE' && room.canonical.turn.phase === 'CHARACTER_CHOICE' && !room.canonical.characterDraft?.chosenByPlayer[hydratedCommand.playerId];
  if (room.canonical.revision !== hydratedCommand.expectedRevision && !concurrentDraftChoice) {
    const receipt = receiptFor(room, hydratedCommand.commandId, uid, 'REJECTED', now, `La partida avanzó hasta la revisión ${room.canonical.revision}.`);
    const result = await applyRoomStateRecord(roomCode, room.transportVersion ?? 0, epoch, withReceipt(base, receipt), hydratedCommand.commandId, queuedSlot(room, hydratedCommand.commandId), receipt);
    return result.applied;
  }
  const authoritativeCommand = concurrentDraftChoice ? { ...hydratedCommand, expectedRevision: room.canonical.revision } : hydratedCommand;
  let applied: CommandResult;
  try {
    applied = applyCommand(room.canonical, authoritativeCommand);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'El comando no se pudo procesar.';
    const receipt = receiptFor(room, hydratedCommand.commandId, uid, 'REJECTED', now, message);
    const result = await applyRoomStateRecord(roomCode, room.transportVersion ?? 0, epoch, withReceipt(base, receipt), hydratedCommand.commandId, queuedSlot(room, hydratedCommand.commandId), receipt);
    return result.applied;
  }
  if (!applied.ok) {
    const receipt = receiptFor(room, hydratedCommand.commandId, uid, 'REJECTED', now, applied.error.message);
    const result = await applyRoomStateRecord(roomCode, room.transportVersion ?? 0, epoch, withReceipt(base, receipt), hydratedCommand.commandId, queuedSlot(room, hydratedCommand.commandId), receipt);
    return result.applied;
  }
  const receipt = receiptFor(room, hydratedCommand.commandId, uid, 'APPLIED', now, undefined, applied.state.revision);
  const next = withReceipt({ ...base, canonical: applied.state }, receipt);
  const result = await applyRoomStateRecord(roomCode, room.transportVersion ?? 0, epoch, next, hydratedCommand.commandId, queuedSlot(room, hydratedCommand.commandId), receipt);
  return result.applied;
};

export const removeMalformedCommand = async (roomCode: string, commandId: string, uid: string, epoch: number): Promise<boolean> => {
  const room = await getRoomSnapshot(roomCode);
  const now = serverNow();
  if (!room?.canonical || room.status === 'ENDED' || room.coordinator.coordinatorId !== uid || room.coordinator.coordinatorEpoch !== epoch || room.coordinator.leaseUntil <= now) return false;
  const safeRoom = { ...room, commands: sanitizedCommands(room) };
  const entry = Object.entries(room.commands ?? {}).find(([slotKey, candidate]) => slotKey === commandId || candidate?.command?.commandId === commandId);
  const envelope = entry?.[1];
  const actualCommandId = typeof envelope?.command?.commandId === 'string' ? envelope.command.commandId : null;
  const receipt: CommandReceipt | null = envelope && actualCommandId ? { commandId: actualCommandId, submittedByUid: envelope.submittedByUid, status: 'REJECTED', updatedAt: now, error: 'La acción recibida estaba corrupta.' } : null;
  const next = withReceipt({ ...safeRoom, commands: removeCommand(safeRoom, commandId) }, receipt);
  const result = await applyRoomStateRecord(roomCode, room.transportVersion ?? 0, epoch, next, actualCommandId, entry?.[0] ?? null, actualCommandId ? receipt : null);
  return result.applied;
};
