import { describe, expect, it } from 'vitest';
import { createGame } from '../game/engine';
import type { GameState, Room } from '../types';
import { hydrateGameState, hydrateRoom } from './hydrate';

const setups = Array.from({ length: 4 }, (_, index) => ({
  id: index === 0 ? 'human' : `bot-${index}`,
  name: `Player ${index}`,
  kind: index === 0 ? 'HUMAN' as const : 'AI' as const,
}));

describe('Firebase state hydration', () => {
  it('restores values omitted by Realtime Database from a fresh game', () => {
    const game = createGame(setups, 42);
    const firebaseState = {
      ...game,
      discard: undefined,
      reaction: undefined,
      storeState: undefined,
      multiAction: undefined,
      processedCommandIds: undefined,
      winner: undefined,
      players: game.players.map((player) => ({
        ...player,
        equipment: undefined,
      })),
    } as unknown as GameState;

    const hydrated = hydrateGameState(firebaseState);

    expect(hydrated.discard).toEqual([]);
    expect(hydrated.processedCommandIds).toEqual([]);
    expect(hydrated.reaction).toBeNull();
    expect(hydrated.winner).toBeNull();
    expect(hydrated.players[0]?.equipment).toEqual({
      weapon: null,
      barrel: null,
      mustang: null,
      scope: null,
      jail: null,
      dynamite: null,
    });
  });

  it('restores room collections and nullable seat fields', () => {
    const game = createGame(setups, 42);
    const firebaseRoom = {
      code: 'ABC123',
      status: 'PLAYING',
      createdAt: 1,
      hostUid: 'uid-1',
      maxPlayers: 4,
      characterMode: 'OFFICIAL',
      seats: { 0: { number: 0, playerId: 'human', ownerUid: 'uid-1', isBot: false, joinedAt: 1 } },
      players: {},
      coordinator: { coordinatorId: 'uid-1', coordinatorEpoch: 1, leaseUntil: 10, heartbeat: 1 },
      canonical: game,
    } as unknown as Room;

    const hydrated = hydrateRoom(firebaseRoom);

    expect(hydrated.commands).toEqual({});
    expect(hydrated.seats[0]?.reconnectHash).toBeNull();
    expect(hydrated.canonical?.discard).toEqual([]);
  });
});
