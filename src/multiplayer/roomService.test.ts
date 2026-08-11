import { beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({
  get: vi.fn(),
  onDisconnectUpdate: vi.fn(),
  ref: vi.fn((_database: unknown, path: string) => path),
  runTransaction: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
}));

vi.mock('firebase/database', () => ({
  get: databaseMocks.get,
  onDisconnect: vi.fn(() => ({ update: databaseMocks.onDisconnectUpdate })),
  onValue: vi.fn(),
  push: vi.fn(() => ({ key: 'command-key' })),
  ref: databaseMocks.ref,
  runTransaction: databaseMocks.runTransaction,
  serverTimestamp: vi.fn(() => 1234),
  set: databaseMocks.set,
  update: databaseMocks.update,
}));

vi.mock('../firebase/client', () => ({
  ensureAnonymousUser: vi.fn(() => Promise.resolve({ uid: 'tablet-user-1234567890' })),
  firebaseServices: vi.fn(() => ({ database: {} })),
}));

vi.mock('./identity', () => ({
  createReconnectToken: vi.fn(() => 'reconnect-token'),
  hashReconnectToken: vi.fn(() => Promise.resolve('a'.repeat(64))),
  saveReconnectToken: vi.fn(),
}));

import { joinRoom } from './roomService';

describe('joinRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.get.mockResolvedValue({
      val: () => ({
        code: 'ABC123',
        status: 'LOBBY',
        createdAt: 1,
        hostUid: 'host-user',
        maxPlayers: 4,
        characterMode: 'OFFICIAL',
        seats: {
          0: {
            number: 0,
            playerId: 'player-host',
            ownerUid: 'host-user',
            reconnectHash: null,
            isBot: false,
            joinedAt: 1,
          },
        },
        players: {},
        coordinator: {
          coordinatorId: 'host-user',
          coordinatorEpoch: 1,
          leaseUntil: Date.now() + 10_000,
          heartbeat: Date.now(),
        },
        canonical: null,
        commands: {},
      }),
    });
    databaseMocks.set.mockResolvedValue(undefined);
    databaseMocks.update.mockResolvedValue(undefined);
    databaseMocks.onDisconnectUpdate.mockResolvedValue(undefined);
  });

  it('reserva un asiento hijo compatible con las reglas de Firebase', async () => {
    databaseMocks.runTransaction.mockImplementation((path: string, updateSeat: (seat: unknown) => unknown) => {
      const nextSeat = updateSeat(path.endsWith('/0') ? { ownerUid: 'host-user' } : null);
      return Promise.resolve({
        committed: nextSeat !== undefined,
        snapshot: { val: () => nextSeat },
      });
    });

    const identity = await joinRoom('abc123', 'Tablet');

    expect(identity.playerId).toBe('player-tablet-use');
    expect(databaseMocks.runTransaction).toHaveBeenNthCalledWith(
      1,
      'rooms/ABC123/seats/0',
      expect.any(Function),
      { applyLocally: false },
    );
    expect(databaseMocks.runTransaction).toHaveBeenNthCalledWith(
      2,
      'rooms/ABC123/seats/1',
      expect.any(Function),
      { applyLocally: false },
    );
    expect(databaseMocks.set).toHaveBeenCalledWith(
      'seatProofs/ABC123/1',
      'a'.repeat(64),
    );
  });
});
