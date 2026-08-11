import type { Character, CharacterMode, Equipment, GameState, Player } from '../../types';
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

export const createGame = (setups: readonly PlayerSetup[], seed = Date.now(), characterMode: CharacterMode = 'OFFICIAL'): GameState => {
  if (setups.length < 4 || setups.length > 7) throw new Error('Se necesitan entre 4 y 7 jugadores.');
  const random = seededRandom(seed);
  const roles = dealRoles(setups.length, random);
  const characters = shuffle(CHARACTERS, random);
  let deck = shuffle(createDeck(`g${seed}`), random);
  const players: Player[] = setups.map((setup, seat) => {
    const role = roles[seat]!;
    const character: Character = characters[seat]!;
    const marker = characterMode === 'OFFICIAL' ? characters[seat + setups.length] ?? null : null;
    const maxLives = character.lives + (role === 'SHERIFF' ? 1 : 0);
    const hand = characterMode === 'OFFICIAL' ? deck.slice(0, maxLives) : [];
    if (characterMode === 'OFFICIAL') deck = deck.slice(maxLives);
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
  const optionsByPlayer = Object.fromEntries(players.map((player) => {
    const first = characters[player.seat * 2]!;
    const second = characters[player.seat * 2 + 1]!;
    return [player.id, [first.name, second.name] as const];
  })) as Record<string, readonly [Character['name'], Character['name']]>;
  return {
    gameId: `game-${seed}`,
    seed,
    revision: 0,
    players,
    deck,
    discard: [],
    turn: { number: 1, currentPlayerId: characterMode === 'DRAFT_TWO' ? players[0]!.id : sheriff.id, phase: characterMode === 'DRAFT_TWO' ? 'CHARACTER_CHOICE' : 'TURN_START', pendingDiscardCount: 0 },
    reaction: null,
    storeState: null,
    multiAction: null,
    characterDraft: characterMode === 'DRAFT_TWO' ? { optionsByPlayer, chosenByPlayer: {} } : null,
    processedCommandIds: [],
    logs: [{ id: 'start', revision: 0, message: `${sheriff.name} es el Sheriff.`, tone: 'SYSTEM' }],
    winner: null,
  };
};
