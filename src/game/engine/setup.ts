import type { Character, Equipment, GameState, Player } from '../../types';
import { CHARACTERS } from '../characters/characters';
import { createDeck } from '../cards/deck';
import { dealRoles } from '../rules/roles';
import { seededRandom, shuffle } from '../../utils/random';

export interface PlayerSetup {
  readonly id: string;
  readonly name: string;
  readonly kind: 'HUMAN' | 'AI';
}

const emptyEquipment = (): Equipment => ({ weapon: null, barrel: null, mustang: null, scope: null, jail: null, dynamite: null });

export const createGame = (setups: readonly PlayerSetup[], seed = Date.now()): GameState => {
  if (setups.length < 4 || setups.length > 7) throw new Error('Se necesitan entre 4 y 7 jugadores.');
  const random = seededRandom(seed);
  const roles = dealRoles(setups.length, random);
  const characters = shuffle(CHARACTERS, random);
  let deck = shuffle(createDeck(`g${seed}`), random);
  const players: Player[] = setups.map((setup, seat) => {
    const role = roles[seat]!;
    const character: Character = characters[seat]!;
    const marker = characters[seat + setups.length] ?? null;
    const maxLives = character.lives + (role === 'SHERIFF' ? 1 : 0);
    const hand = deck.slice(0, maxLives);
    deck = deck.slice(maxLives);
    return {
      ...setup,
      seat,
      role,
      character,
      lifeMarkerCharacter: marker,
      lives: maxLives,
      maxLives,
      alive: true,
      hand,
      equipment: emptyEquipment(),
      bangsPlayedThisTurn: 0,
    };
  });
  const sheriff = players.find((player) => player.role === 'SHERIFF')!;
  return {
    gameId: `game-${seed}`,
    seed,
    revision: 0,
    players,
    deck,
    discard: [],
    turn: { number: 1, currentPlayerId: sheriff.id, phase: 'TURN_START', pendingDiscardCount: 0 },
    reaction: null,
    storeState: null,
    multiAction: null,
    processedCommandIds: [],
    logs: [{ id: 'start', revision: 0, message: `${sheriff.name} es el Sheriff.`, tone: 'SYSTEM' }],
    winner: null,
  };
};
