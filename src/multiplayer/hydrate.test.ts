import { describe, expect, it } from 'vitest';
import { applyCommand, command, createGame } from '../game/engine';
import { decideAiCommand, initialKnowledge } from '../game/ai';
import { makeCard, patchPlayer, playPhase, run, testState } from '../test/helpers';
import type { GameState, Room } from '../types';
import { hydrateGameState, hydrateRoom } from './hydrate';

const setups = Array.from({ length: 4 }, (_, index) => ({
  id: index === 0 ? 'human' : `bot-${index}`,
  name: `Player ${index}`,
  kind: index === 0 ? 'HUMAN' as const : 'AI' as const,
}));

describe('Supabase state hydration', () => {
  it('conserva los efectos públicos de desenfunde al viajar por el transporte online', () => {
    const game = createGame(setups, 41);
    const card = game.deck[0]!;
    const withEffect = {
      ...game,
      logs: [...game.logs, { id: 'judgement-online', revision: 1, message: 'El Barril salva al jugador.', tone: 'ACTION' as const, effect: { kind: 'JUDGEMENT' as const, playerId: 'human', card, success: true, headline: '¡SE SALVA!' } }],
    };

    const hydrated = hydrateGameState(JSON.parse(JSON.stringify(withEffect)) as GameState);

    expect(hydrated.logs.at(-1)?.effect).toEqual(withEffect.logs.at(-1)?.effect);
  });

  it('mantiene el Barril equipado y operativo tras hidratar el estado online', () => {
    let game = createGame(setups, 43);
    const bang = makeCard('BANG', 'online-barrel-bang');
    const barrel = makeCard('BARREL', 'online-barrel');
    const heart = makeCard('BEER', 'online-barrel-heart', 'HEARTS');
    game = {
      ...game,
      deck: [heart, ...game.deck],
      turn: { ...game.turn, currentPlayerId: 'human', phase: 'PLAY' },
      players: game.players.map((player) => player.id === 'human'
        ? { ...player, hand: [bang] }
        : player.id === 'bot-1'
          ? { ...player, equipment: { ...player.equipment, barrel } }
          : player),
    };

    const hydrated = hydrateGameState(JSON.parse(JSON.stringify(game)) as GameState);
    const result = applyCommand(hydrated, command(hydrated, 'human', 'PLAY_CARD', { cardId: bang.id, targetPlayerId: 'bot-1' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.reaction).toBeNull();
    expect(result.state.players.find((player) => player.id === 'bot-1')?.equipment.barrel?.id).toBe(barrel.id);
    expect(result.state.logs.some((entry) => entry.effect?.card.id === heart.id && entry.effect.success)).toBe(true);
  });

  it('restores values omitted by a partial realtime payload from a fresh game', () => {
    const game = createGame(setups, 42);
    const remoteState = {
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

    const hydrated = hydrateGameState(remoteState);

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

  it('normalizes numeric seat arrays and restores omitted room collections', () => {
    const game = createGame(setups, 42);
    const remoteRoom = {
      code: 'ABC123',
      status: 'PLAYING',
      createdAt: 1,
      hostUid: 'uid-1',
      maxPlayers: 4,
      characterMode: 'OFFICIAL',
      // Some realtime transports return dense integer-keyed objects as arrays.
      seats: [{ number: 0, playerId: 'human', ownerUid: 'uid-1', isBot: false, joinedAt: 1 }],
      players: {},
      coordinator: { coordinatorId: 'uid-1', coordinatorEpoch: 1, leaseUntil: 10, heartbeat: 1 },
      canonical: game,
    } as unknown as Room;

    const hydrated = hydrateRoom(remoteRoom);

    expect(hydrated.commands).toEqual({});
    expect(Array.isArray(hydrated.seats)).toBe(false);
    expect(hydrated.seats[0]?.reconnectHash).toBeNull();
    expect(hydrated.canonical?.discard).toEqual([]);
  });

  it('restores empty Almacén picks so online AI can continue', () => {
    let game = playPhase(testState());
    const store = makeCard('GENERAL_STORE', 'online-store');
    game = patchPlayer(game, 'p0', { kind: 'AI', hand: [store] });
    game = run(game, command(game, 'p0', 'PLAY_CARD', { cardId: store.id }));
    const remoteState = {
      ...game,
      storeState: { ...game.storeState!, pickedBy: undefined },
    } as unknown as GameState;

    const hydrated = hydrateGameState(remoteState);
    const aiCommand = decideAiCommand(hydrated, 'p0', initialKnowledge(hydrated, 'p0'));

    expect(hydrated.storeState?.pickedBy).toEqual({});
    expect(aiCommand?.type).toBe('STORE_PICK');
    expect(applyCommand(hydrated, aiCommand!).ok).toBe(true);
  });
});
