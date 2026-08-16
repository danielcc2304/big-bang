import { beforeEach, describe, expect, it, vi } from 'vitest';
import { command, createGame } from '../game/engine';
import type { CommandEnvelope } from '../types';

const databaseMocks = vi.hoisted(() => ({
  get: vi.fn(),
  onDisconnectSet: vi.fn(),
  ref: vi.fn((_database: unknown, path: string) => path),
  runTransaction: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
}));

vi.mock('firebase/database', () => ({
  get: databaseMocks.get,
  onDisconnect: vi.fn(() => ({ set: databaseMocks.onDisconnectSet })),
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
  loadReconnectToken: vi.fn(() => 'stored-token'),
}));

import { enqueueCommand, joinRoom, markPresenceOffline, refreshPresence } from './roomService';

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
    databaseMocks.onDisconnectSet.mockResolvedValue(undefined);
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
    expect(databaseMocks.onDisconnectSet).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'tablet-user-1234567890',
      connected: false,
      lastSeen: 1234,
    }));
    expect(databaseMocks.onDisconnectSet.mock.invocationCallOrder[0]).toBeLessThan(
      databaseMocks.set.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('no permite que el mismo usuario anónimo consuma un segundo asiento', async () => {
    databaseMocks.get.mockResolvedValue({
      val: () => ({
        code: 'ABC123', status: 'LOBBY', createdAt: 1, hostUid: 'host-user', maxPlayers: 4, characterMode: 'OFFICIAL',
        seats: { 0: { number: 0, playerId: 'player-tablet-use', ownerUid: 'tablet-user-1234567890', reconnectHash: null, isBot: false, joinedAt: 1 } },
        players: { 'player-tablet-use': { uid: 'tablet-user-1234567890', playerId: 'player-tablet-use', displayName: 'Tablet', connected: false, lastSeen: 1 } },
        coordinator: { coordinatorId: 'host-user', coordinatorEpoch: 1, leaseUntil: Date.now() + 10_000, heartbeat: Date.now() }, canonical: null, commands: {},
      }),
    });

    const identity = await joinRoom('abc123', 'Tablet');

    expect(identity.playerId).toBe('player-tablet-use');
    expect(databaseMocks.runTransaction).not.toHaveBeenCalled();
  });

  it('normaliza el reloj del cliente y coloca cada comando en una ranura transaccional', async () => {
    const setups = Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'HUMAN' as const }));
    const canonical = createGame(setups, 99);
    const room = {
      code: 'ABC123', status: 'PLAYING', createdAt: 1, hostUid: 'uid-p0', maxPlayers: 4, characterMode: 'OFFICIAL',
      seats: Object.fromEntries(setups.map((setup, index) => [index, { number: index, playerId: setup.id, ownerUid: `uid-${setup.id}`, reconnectHash: null, isBot: false, joinedAt: 1 }])),
      players: Object.fromEntries(setups.map((setup) => [setup.id, { uid: `uid-${setup.id}`, playerId: setup.id, displayName: setup.name, connected: true, lastSeen: 1 }])),
      canonical, commands: {}, commandReceipts: {}, coordinator: { coordinatorId: 'uid-p0', coordinatorEpoch: 1, leaseUntil: Date.now() + 10_000, heartbeat: Date.now() },
    };
    databaseMocks.get.mockResolvedValue({ val: () => room });
    const next = command(canonical, 'p0', 'RESOLVE_TURN_START', {});
    let captured: CommandEnvelope | undefined;
    databaseMocks.runTransaction.mockImplementation((_path: string, updater: (current: null) => unknown) => {
      captured = updater(null) as CommandEnvelope;
      return Promise.resolve({ committed: true, snapshot: { val: () => captured } });
    });

    await enqueueCommand('ABC123', { ...next, createdAt: 0 }, 'uid-p0');

    expect(captured?.command.commandId).toBe(next.commandId);
    expect(captured?.command.createdAt).toBe(captured?.submittedAt);
    expect(captured?.command.createdAt).toBeGreaterThan(0);
    expect(databaseMocks.runTransaction).toHaveBeenCalledWith(expect.stringMatching(/^rooms\/ABC123\/commands\/slot-\d+$/), expect.any(Function), { applyLocally: false });
  });

  it('rearma la presencia y marca la conexión como offline al abandonar la sala', async () => {
    await refreshPresence('ABC123', 'p0', 'uid-p0', 'connection-1');
    await markPresenceOffline('ABC123', 'p0', 'uid-p0', 'connection-1');

    expect(databaseMocks.onDisconnectSet).toHaveBeenCalledWith(expect.objectContaining({ uid: 'uid-p0', connected: false, lastSeen: 1234 }));
    expect(databaseMocks.set).toHaveBeenNthCalledWith(1, 'rooms/ABC123/presence/p0/connection-1', expect.objectContaining({ uid: 'uid-p0', connected: true, lastSeen: 1234 }));
    expect(databaseMocks.update).toHaveBeenNthCalledWith(1, 'rooms/ABC123/players/p0', expect.objectContaining({ uid: 'uid-p0', connected: true, lastSeen: 1234 }));
    expect(databaseMocks.update).toHaveBeenNthCalledWith(2, 'rooms/ABC123/presence/p0/connection-1', expect.objectContaining({ uid: 'uid-p0', connected: false, lastSeen: 1234 }));
  });
});

