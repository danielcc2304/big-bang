import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameCommand, Room } from '../types';
import { applyCommand, command, createGame } from '../game/engine';

const databaseMocks = vi.hoisted(() => ({
  ref: vi.fn((_database: unknown, path: string) => path),
  runTransaction: vi.fn(),
}));

vi.mock('firebase/database', () => ({
  ref: databaseMocks.ref,
  runTransaction: databaseMocks.runTransaction,
}));

vi.mock('../firebase/client', () => ({
  firebaseServices: vi.fn(() => ({ database: {} })),
}));

import { applyAuthoritativeCommand } from './coordinator';

describe('coordinador online', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retira un comando obsoleto para que no bloquee toda la cola', async () => {
    const canonical = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const })), 41);
    const stale = { ...command(canonical, canonical.turn.currentPlayerId, 'RESOLVE_TURN_START', {}), expectedRevision: canonical.revision - 1 };
    const room = {
      code: 'ABC123', status: 'PLAYING', createdAt: 1, hostUid: 'host', maxPlayers: 4, characterMode: 'OFFICIAL',
      seats: {}, players: {}, canonical, commands: { queued: { command: stale, submittedByUid: 'host', submittedAt: 1 } },
      coordinator: { coordinatorId: 'host', coordinatorEpoch: 2, leaseUntil: 10_000, heartbeat: 1 },
    } satisfies Room;
    let updated: Room | undefined;
    databaseMocks.runTransaction.mockImplementation((_path: string, updater: (value: Room) => Room | undefined) => {
      updated = updater(room);
      return Promise.resolve({ committed: updated !== undefined, snapshot: { val: () => updated } });
    });

    await expect(applyAuthoritativeCommand('ABC123', stale, 'host', 2, 100)).resolves.toBe(true);
    expect(updated?.canonical?.revision).toBe(canonical.revision);
    expect(updated?.commands).toEqual({});
    expect(updated?.commandReceipts?.[stale.commandId]?.status).toBe('REJECTED');
  });

  it('rebasa elecciones simultáneas sobre la revisión canónica actual', async () => {
    const initial = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const })), 42, 'DRAFT_TWO');
    const first = command(initial, 'p0', 'CHARACTER_CHOICE', { characterName: initial.characterDraft!.optionsByPlayer.p0![0] });
    const concurrent = command(initial, 'p1', 'CHARACTER_CHOICE', { characterName: initial.characterDraft!.optionsByPlayer.p1![1] });
    const firstResult = applyCommand(initial, first);
    if (!firstResult.ok) throw new Error(firstResult.error.message);
    const room = {
      code: 'ABC123', status: 'PLAYING', createdAt: 1, hostUid: 'host', maxPlayers: 4, characterMode: 'DRAFT_TWO',
      seats: {}, players: {}, canonical: firstResult.state, commands: { queued: { command: concurrent, submittedByUid: 'guest', submittedAt: 1 } },
      coordinator: { coordinatorId: 'host', coordinatorEpoch: 2, leaseUntil: 10_000, heartbeat: 1 },
    } satisfies Room;
    let updated: Room | undefined;
    databaseMocks.runTransaction.mockImplementation((_path: string, updater: (value: Room) => Room | undefined) => {
      updated = updater(room);
      return Promise.resolve({ committed: updated !== undefined, snapshot: { val: () => updated } });
    });

    await expect(applyAuthoritativeCommand('ABC123', concurrent, 'host', 2, 100)).resolves.toBe(true);
    expect(updated?.canonical?.revision).toBe(2);
    expect(updated?.canonical?.characterDraft?.chosenByPlayer.p1).toBe(concurrent.payload.characterName);
  });

  it('descarta un comando malformado sin dejar bloqueada la cola', async () => {
    const canonical = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const })), 43, 'DRAFT_TWO');
    const malformed = { ...command(canonical, 'p0', 'CHARACTER_CHOICE', { characterName: canonical.characterDraft!.optionsByPlayer.p0![0] }), payload: undefined } as unknown as GameCommand;
    const room = {
      code: 'ABC123', status: 'PLAYING', createdAt: 1, hostUid: 'host', maxPlayers: 4, characterMode: 'DRAFT_TWO', seats: {}, players: {}, canonical,
      commands: { queued: { command: malformed, submittedByUid: 'guest', submittedAt: 1 } },
      coordinator: { coordinatorId: 'host', coordinatorEpoch: 2, leaseUntil: 10_000, heartbeat: 1 },
    } satisfies Room;
    let updated: Room | undefined;
    databaseMocks.runTransaction.mockImplementation((_path: string, updater: (value: Room) => Room | undefined) => {
      updated = updater(room);
      return Promise.resolve({ committed: updated !== undefined, snapshot: { val: () => updated } });
    });

    await expect(applyAuthoritativeCommand('ABC123', malformed, 'host', 2, 100)).resolves.toBe(true);
    expect(updated?.commands).toEqual({});
  });

  it('recupera una reacción vacía serializada por Firebase y aplica el daño', async () => {
    const initial = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const })), 44);
    const bang = initial.deck.find((card) => card.name === 'BANG')!;
    const weapon = initial.deck.find((card) => card.name === 'WINCHESTER')!;
    const playable = {
      ...initial,
      deck: initial.deck.filter((card) => card.id !== bang.id && card.id !== weapon.id),
      players: initial.players.map((player) => player.id === 'p0' ? { ...player, hand: [bang], equipment: { ...player.equipment, weapon } } : player),
      turn: { ...initial.turn, currentPlayerId: 'p0', phase: 'PLAY' as const },
    };
    const attacked = applyCommand(playable, command(playable, 'p0', 'PLAY_CARD', { cardId: bang.id, targetPlayerId: 'p1' }));
    if (!attacked.ok) throw new Error(attacked.error.message);
    const livesBefore = attacked.state.players[1]!.lives;
    const oldClientCommand = { ...command(attacked.state, 'p1', 'REACTION', { cardIds: [] }), payload: undefined } as unknown as GameCommand;
    const room = {
      code: 'ABC123', status: 'PLAYING', createdAt: 1, hostUid: 'host', maxPlayers: 4, characterMode: 'OFFICIAL', seats: {}, players: {}, canonical: attacked.state,
      commands: { queued: { command: oldClientCommand, submittedByUid: 'guest', submittedAt: 1 } },
      coordinator: { coordinatorId: 'host', coordinatorEpoch: 2, leaseUntil: 10_000, heartbeat: 1 },
    } satisfies Room;
    let updated: Room | undefined;
    databaseMocks.runTransaction.mockImplementation((_path: string, updater: (value: Room) => Room | undefined) => {
      updated = updater(room);
      return Promise.resolve({ committed: updated !== undefined, snapshot: { val: () => updated } });
    });

    await expect(applyAuthoritativeCommand('ABC123', oldClientCommand, 'host', 2, 100)).resolves.toBe(true);
    expect(updated?.canonical?.players[1]!.lives).toBe(livesBefore - 1);
    expect(updated?.canonical?.reaction).toBeNull();
    expect(updated?.commands).toEqual({});
  });

  it('confirma un comando aplicado para que el cliente pueda cerrar su estado pendiente', async () => {
    const canonical = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const })), 45);
    const next = command(canonical, canonical.turn.currentPlayerId, 'RESOLVE_TURN_START', {});
    const room = {
      code: 'ABC123', status: 'PLAYING', createdAt: 1, hostUid: 'host', maxPlayers: 4, characterMode: 'OFFICIAL', seats: {}, players: {}, canonical, commands: { queued: { command: next, submittedByUid: 'guest', submittedAt: 1 } },
      coordinator: { coordinatorId: 'host', coordinatorEpoch: 2, leaseUntil: 10_000, heartbeat: 1 },
    } satisfies Room;
    let updated: Room | undefined;
    databaseMocks.runTransaction.mockImplementation((_path: string, updater: (value: Room) => Room) => {
      updated = updater(room);
      return Promise.resolve({ committed: updated !== undefined, snapshot: { val: () => updated } });
    });

    await expect(applyAuthoritativeCommand('ABC123', next, 'host', 2, 100)).resolves.toBe(true);
    expect(updated?.commandReceipts?.[next.commandId]).toMatchObject({ status: 'APPLIED', submittedByUid: 'guest', revision: canonical.revision + 1 });
  });
});
