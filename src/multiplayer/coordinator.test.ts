import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameCommand, Room } from '../types';
import { applyCommand, command, createGame } from '../game/engine';

const repositoryMocks = vi.hoisted(() => ({
  getRoomSnapshot: vi.fn(),
  applyRoomStateRecord: vi.fn(),
  acquireLeaseRecord: vi.fn(),
  renewLeaseRecord: vi.fn(),
}));

vi.mock('./supabaseRepository', () => repositoryMocks);

import { applyAuthoritativeCommand, removeMalformedCommand } from './coordinator';

const makeRoom = (canonical: ReturnType<typeof createGame>, commands: Readonly<Record<string, unknown>> = {}): Room => ({
  code: 'ABC123',
  status: 'PLAYING',
  createdAt: 1,
  hostUid: 'host',
  maxPlayers: 4,
  characterMode: 'OFFICIAL',
  seats: {},
  players: {},
  canonical,
  commands: commands as Room['commands'],
  commandReceipts: {},
  presence: {},
  coordinator: { coordinatorId: 'host', coordinatorEpoch: 2, leaseUntil: 10_000, heartbeat: 1 },
  transportVersion: 4,
});

describe('coordinador online sobre Supabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.applyRoomStateRecord.mockResolvedValue({ applied: true });
  });

  it('retira un comando obsoleto para que no bloquee la cola', async () => {
    const canonical = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const })), 41);
    const stale = { ...command(canonical, canonical.turn.currentPlayerId, 'RESOLVE_TURN_START', {}), expectedRevision: canonical.revision - 1 };
    const room = makeRoom(canonical, { 'slot-0': { command: stale, submittedByUid: 'host', submittedAt: 1 } });
    repositoryMocks.getRoomSnapshot.mockResolvedValue(room);

    await expect(applyAuthoritativeCommand('ABC123', stale, 'host', 2, 100)).resolves.toBe(true);
    const next = repositoryMocks.applyRoomStateRecord.mock.calls[0]![3] as Room;
    expect(next.canonical?.revision).toBe(canonical.revision);
    expect(next.commands).toEqual({});
    expect(next.commandReceipts?.[stale.commandId]?.status).toBe('REJECTED');
  });

  it('rebasa elecciones simultáneas sobre la revisión canónica actual', async () => {
    const initial = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const })), 42, 'DRAFT_TWO');
    const first = command(initial, 'p0', 'CHARACTER_CHOICE', { characterName: initial.characterDraft!.optionsByPlayer.p0![0] });
    const concurrent = command(initial, 'p1', 'CHARACTER_CHOICE', { characterName: initial.characterDraft!.optionsByPlayer.p1![1] });
    const firstResult = applyCommand(initial, first);
    if (!firstResult.ok) throw new Error(firstResult.error.message);
    repositoryMocks.getRoomSnapshot.mockResolvedValue(makeRoom({ ...firstResult.state, turn: { ...firstResult.state.turn, phase: 'CHARACTER_CHOICE' } }, { 'slot-0': { command: concurrent, submittedByUid: 'guest', submittedAt: 1 } }));

    await expect(applyAuthoritativeCommand('ABC123', concurrent, 'host', 2, 100)).resolves.toBe(true);
    const next = repositoryMocks.applyRoomStateRecord.mock.calls[0]![3] as Room;
    expect(next.canonical?.revision).toBe(2);
    expect(next.canonical?.characterDraft?.chosenByPlayer.p1).toBe(concurrent.payload.characterName);
  });

  it('descarta un comando malformado sin dejar bloqueada la cola', async () => {
    const canonical = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const })), 43, 'DRAFT_TWO');
    const malformed = { ...command(canonical, 'p0', 'CHARACTER_CHOICE', { characterName: canonical.characterDraft!.optionsByPlayer.p0![0] }), payload: undefined } as unknown as GameCommand;
    repositoryMocks.getRoomSnapshot.mockResolvedValue(makeRoom(canonical, { 'slot-0': { command: malformed, submittedByUid: 'guest', submittedAt: 1 } }));

    await expect(applyAuthoritativeCommand('ABC123', malformed, 'host', 2, 100)).resolves.toBe(true);
    const next = repositoryMocks.applyRoomStateRecord.mock.calls[0]![3] as Room;
    expect(next.commands).toEqual({});
  });

  it('borra por slot los comandos corruptos que no tienen commandId', async () => {
    const canonical = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const })), 431, 'DRAFT_TWO');
    const malformed = { ...command(canonical, 'p0', 'CHARACTER_CHOICE', { characterName: canonical.characterDraft!.optionsByPlayer.p0![0] }), commandId: undefined, payload: undefined } as unknown as GameCommand;
    repositoryMocks.getRoomSnapshot.mockResolvedValue({ ...makeRoom(canonical, { 'slot-7': { command: malformed, submittedByUid: 'guest', submittedAt: 1 } }), coordinator: { coordinatorId: 'host', coordinatorEpoch: 2, leaseUntil: Date.now() + 10_000, heartbeat: Date.now() } });

    await expect(removeMalformedCommand('ABC123', 'slot-7', 'host', 2)).resolves.toBe(true);
    expect(repositoryMocks.applyRoomStateRecord.mock.calls[0]![5]).toBe('slot-7');
  });

  it('normaliza una reacción vacía serializada y aplica el daño', async () => {
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
    const oldClientCommand = { ...command(attacked.state, 'p1', 'REACTION', { cardIds: [] }), payload: undefined } as unknown as GameCommand;
    repositoryMocks.getRoomSnapshot.mockResolvedValue(makeRoom(attacked.state, { 'slot-0': { command: oldClientCommand, submittedByUid: 'guest', submittedAt: 1 } }));

    await expect(applyAuthoritativeCommand('ABC123', oldClientCommand, 'host', 2, 100)).resolves.toBe(true);
    const next = repositoryMocks.applyRoomStateRecord.mock.calls[0]![3] as Room;
    expect(next.canonical?.players[1]!.lives).toBe(attacked.state.players[1]!.lives - 1);
    expect(next.canonical?.reaction).toBeNull();
  });

  it('confirma un comando aplicado para que el cliente pueda cerrar su estado pendiente', async () => {
    const canonical = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const })), 45);
    const nextCommand = command(canonical, canonical.turn.currentPlayerId, 'RESOLVE_TURN_START', {});
    repositoryMocks.getRoomSnapshot.mockResolvedValue(makeRoom(canonical, { 'slot-0': { command: nextCommand, submittedByUid: 'guest', submittedAt: 1 } }));

    await expect(applyAuthoritativeCommand('ABC123', nextCommand, 'host', 2, 100)).resolves.toBe(true);
    const next = repositoryMocks.applyRoomStateRecord.mock.calls[0]![3] as Room;
    expect(next.commandReceipts?.[nextCommand.commandId]).toMatchObject({ status: 'APPLIED', submittedByUid: 'guest', revision: canonical.revision + 1 });
  });
});
