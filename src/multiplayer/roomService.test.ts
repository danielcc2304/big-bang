import { beforeEach, describe, expect, it, vi } from 'vitest';

const repositoryMocks = vi.hoisted(() => ({
  joinRoomRecord: vi.fn(),
  saveSeatProof: vi.fn(),
  updatePresence: vi.fn(),
  claimReconnect: vi.fn(),
  getRoomSnapshot: vi.fn(),
  enqueueCommandRecord: vi.fn(),
}));

vi.mock('../supabase/client', () => ({ ensureAnonymousUser: vi.fn(() => Promise.resolve({ id: 'tablet-user-1234567890' })) }));
vi.mock('../supabase/clock', () => ({ serverNow: vi.fn(() => 1_000), syncServerClock: vi.fn(() => Promise.resolve()) }));
vi.mock('./supabaseRepository', () => repositoryMocks);
vi.mock('./identity', () => ({
  createReconnectToken: vi.fn(() => 'reconnect-token'),
  hashReconnectToken: vi.fn(() => Promise.resolve('a'.repeat(64))),
  saveReconnectToken: vi.fn(),
  loadReconnectToken: vi.fn(() => 'stored-token'),
}));

import { joinRoom } from './roomService';

describe('joinRoom con Supabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.joinRoomRecord.mockResolvedValue({ existing: false, playerId: 'player-tablet-use', seat: 1 });
    repositoryMocks.saveSeatProof.mockResolvedValue(undefined);
    repositoryMocks.updatePresence.mockResolvedValue(undefined);
  });

  it('reserva un asiento de forma atómica y guarda la prueba de recuperación', async () => {
    const identity = await joinRoom('abc123', 'Tablet');

    expect(identity.playerId).toBe('player-tablet-use');
    expect(repositoryMocks.joinRoomRecord).toHaveBeenCalledWith('ABC123', 'player-tablet-use', 'Tablet', 1_000);
    expect(repositoryMocks.saveSeatProof).toHaveBeenCalledWith('ABC123', 1, 'a'.repeat(64));
    expect(repositoryMocks.updatePresence).toHaveBeenCalledWith('ABC123', 'player-tablet-use', expect.any(String), 1_000);
  });

  it('no permite consumir un segundo asiento con la misma identidad anónima', async () => {
    repositoryMocks.joinRoomRecord.mockResolvedValue({ existing: true, playerId: 'player-tablet-use', seat: 0 });

    const identity = await joinRoom('abc123', 'Tablet');

    expect(identity.playerId).toBe('player-tablet-use');
    expect(repositoryMocks.saveSeatProof).not.toHaveBeenCalled();
    expect(repositoryMocks.joinRoomRecord).toHaveBeenCalledTimes(1);
  });
});
