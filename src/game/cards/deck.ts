import type { Card, CardName, Rank, Suit } from '../../types';
import { CARD_CATALOG } from './catalog';

type CardSpec = readonly [CardName, Rank, Suit];

const repeated = (name: CardName, count: number, suits: readonly Suit[]): CardSpec[] =>
  Array.from({ length: count }, (_, index) => [name, String((index % 9) + 2) as Rank, suits[index % suits.length] ?? 'CLUBS']);

// 80 cartas del juego base. Los IDs se asignan al construir cada partida.
export const BASE_DECK_SPECS: readonly CardSpec[] = [
  ['SCOPE', 'A', 'SPADES'], ['BARREL', 'Q', 'SPADES'], ['BARREL', 'K', 'SPADES'], ['DYNAMITE', '2', 'HEARTS'],
  ['JAIL', '10', 'SPADES'], ['JAIL', '4', 'HEARTS'], ['JAIL', 'J', 'SPADES'], ['MUSTANG', '8', 'HEARTS'], ['MUSTANG', '9', 'HEARTS'],
  ['REMINGTON', 'K', 'CLUBS'], ['REV_CARABINE', 'A', 'CLUBS'], ['SCHOFIELD', 'K', 'SPADES'], ['SCHOFIELD', 'J', 'CLUBS'], ['SCHOFIELD', 'Q', 'CLUBS'],
  ['VOLCANIC', '10', 'SPADES'], ['VOLCANIC', '10', 'CLUBS'], ['WINCHESTER', '8', 'SPADES'],
  ...repeated('BANG', 25, ['DIAMONDS', 'CLUBS', 'HEARTS', 'SPADES']),
  ...repeated('BEER', 6, ['HEARTS']),
  ...repeated('CAT_BALOU', 4, ['HEARTS', 'DIAMONDS']),
  ['DUEL', 'Q', 'DIAMONDS'], ['DUEL', 'J', 'SPADES'], ['DUEL', '8', 'CLUBS'], ['GATLING', '10', 'HEARTS'],
  ['GENERAL_STORE', '9', 'CLUBS'], ['GENERAL_STORE', 'Q', 'SPADES'], ['INDIANS', 'A', 'DIAMONDS'], ['INDIANS', 'K', 'DIAMONDS'],
  ...repeated('MISSED', 12, ['SPADES', 'CLUBS']),
  ['PANIC', '8', 'DIAMONDS'], ['PANIC', 'J', 'HEARTS'], ['PANIC', 'A', 'HEARTS'], ['PANIC', 'Q', 'HEARTS'],
  ['SALOON', '5', 'HEARTS'], ['STAGECOACH', '9', 'SPADES'], ['STAGECOACH', '9', 'SPADES'], ['WELLS_FARGO', '3', 'HEARTS'],
] as const;

export const createDeck = (idPrefix = 'card'): Card[] => BASE_DECK_SPECS.map(([name, rank, suit], index) => ({
  id: `${idPrefix}-${index}`,
  name,
  kind: CARD_CATALOG[name].kind,
  rank,
  suit,
}));
