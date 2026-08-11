import { ref, runTransaction } from 'firebase/database';
import type { CommandResult, CoordinatorLease, GameCommand, Room } from '../types';
import { firebaseServices } from '../firebase/client';
import { hydrateGameCommand, hydrateRoom } from './hydrate';
import { applyCommand } from '../game/engine';

export const LEASE_DURATION_MS = 12_000;

export const leaseIsValid = (lease: CoordinatorLease, now = Date.now()): boolean => lease.leaseUntil > now;

export const electCoordinator = (current: CoordinatorLease | null, candidateId: string, now: number): CoordinatorLease | null => {
  if (current && current.leaseUntil > now && current.coordinatorId !== candidateId) return null;
  return {
    coordinatorId: candidateId,
    coordinatorEpoch: (current?.coordinatorEpoch ?? 0) + (current?.coordinatorId === candidateId ? 0 : 1),
    leaseUntil: now + LEASE_DURATION_MS,
    heartbeat: now,
  };
};

export const acquireCoordinatorLease = async (roomCode: string, uid: string, now = Date.now()): Promise<CoordinatorLease | null> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado.');
  const result = await runTransaction(ref(services.database, `rooms/${roomCode}/coordinator`), (current: CoordinatorLease | null) => {
    return electCoordinator(current, uid, now) ?? undefined;
  }, { applyLocally: false });
  return result.committed ? result.snapshot.val() as CoordinatorLease : null;
};

export const renewCoordinatorLease = async (roomCode: string, uid: string, epoch: number, now = Date.now()): Promise<boolean> => {
  const services = firebaseServices();
  if (!services) return false;
  const result = await runTransaction(ref(services.database, `rooms/${roomCode}/coordinator`), (current: CoordinatorLease | null) => {
    if (!current || current.coordinatorId !== uid || current.coordinatorEpoch !== epoch) return;
    return { ...current, leaseUntil: now + LEASE_DURATION_MS, heartbeat: now };
  }, { applyLocally: false });
  return result.committed;
};

export const applyAuthoritativeCommand = async (roomCode: string, command: GameCommand, uid: string, epoch: number, now = Date.now()): Promise<boolean> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado.');
  const result = await runTransaction(ref(services.database, `rooms/${roomCode}`), (value: Room | null) => {
    const room = value ? hydrateRoom(value) : null;
    if (!room?.canonical) return;
    const lease = room.coordinator;
    if (lease.coordinatorId !== uid || lease.coordinatorEpoch !== epoch || lease.leaseUntil <= now) return;
    const hydratedCommand = hydrateGameCommand(command);
    const remainingCommands = Object.fromEntries(Object.entries(room.commands ?? {}).filter(([, envelope]) => envelope.command.commandId !== hydratedCommand.commandId));
    if (room.canonical.processedCommandIds.includes(hydratedCommand.commandId)) return { ...room, commands: remainingCommands };
    const concurrentDraftChoice = hydratedCommand.type === 'CHARACTER_CHOICE' && room.canonical.turn.phase === 'CHARACTER_CHOICE' && !room.canonical.characterDraft?.chosenByPlayer[hydratedCommand.playerId];
    if (room.canonical.revision !== hydratedCommand.expectedRevision && !concurrentDraftChoice) return { ...room, commands: remainingCommands };
    const authoritativeCommand = concurrentDraftChoice ? { ...hydratedCommand, expectedRevision: room.canonical.revision } : hydratedCommand;
    let applied: CommandResult;
    try {
      applied = applyCommand(room.canonical, authoritativeCommand);
    } catch {
      return { ...room, commands: remainingCommands };
    }
    if (!applied.ok) return { ...room, commands: remainingCommands };
    return {
      ...room,
      canonical: applied.state,
      commands: remainingCommands,
    };
  }, { applyLocally: false });
  return result.committed;
};
