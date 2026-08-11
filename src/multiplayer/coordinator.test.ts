import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../types';
import { command, createGame } from '../game/engine';

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
  });
});
