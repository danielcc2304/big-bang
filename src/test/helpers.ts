import { expect } from 'vitest';
import type { Card, CardName, CharacterName, GameCommand, GameState, Player, Rank, Role, Suit } from '../types';
import { CARD_CATALOG } from '../game/cards/catalog';
import { CHARACTERS, characterByName } from '../game/characters/characters';
import { applyCommand, createGame } from '../game/engine';

export const makeCard = (name: CardName, id = `test-${name}-${Math.random()}`, suit: Suit = 'CLUBS', rank: Rank = '7'): Card => ({ id, name, kind: CARD_CATALOG[name].kind, suit, rank });

export const testState = (count = 4, seed = 42): GameState => createGame(Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: index === 0 ? 'HUMAN' as const : 'AI' as const })), seed);

export const patchPlayer = (state: GameState, playerId: string, patch: Partial<Player>): GameState => ({ ...state, players: state.players.map((player) => player.id === playerId ? { ...player, ...patch } : player) });

export const setCharacter = (state: GameState, playerId: string, name: CharacterName): GameState => patchPlayer(state, playerId, { character: characterByName(name) });
export const setRole = (state: GameState, playerId: string, role: Role): GameState => patchPlayer(state, playerId, { role });
export const playPhase = (state: GameState, playerId = 'p0'): GameState => ({ ...state, turn: { ...state.turn, currentPlayerId: playerId, phase: 'PLAY', pendingDiscardCount: 0 } });

export const run = (state: GameState, command: GameCommand): GameState => {
  const result = applyCommand(state, command);
  expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
  return result.state;
};

export const findCharacter = (name: CharacterName) => CHARACTERS.find((character) => character.name === name)!;
