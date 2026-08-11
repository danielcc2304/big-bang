import { describe, expect, it } from 'vitest';
import { createGame } from '../engine';
import { dealRoles, rolesForPlayerCount } from './roles';
import { seededRandom } from '../../utils/random';

describe('reparto de roles', () => {
  it.each([
    [4, { SHERIFF: 1, DEPUTY: 0, OUTLAW: 2, RENEGADE: 1 }],
    [5, { SHERIFF: 1, DEPUTY: 1, OUTLAW: 2, RENEGADE: 1 }],
    [6, { SHERIFF: 1, DEPUTY: 1, OUTLAW: 3, RENEGADE: 1 }],
    [7, { SHERIFF: 1, DEPUTY: 2, OUTLAW: 3, RENEGADE: 1 }],
  ])('reparte correctamente para %i jugadores', (count, expected) => {
    const tally = Object.fromEntries(['SHERIFF', 'DEPUTY', 'OUTLAW', 'RENEGADE'].map((role) => [role, rolesForPlayerCount(count).filter((item) => item === role).length]));
    expect(tally).toEqual(expected);
  });

  it('baraja los roles entre semillas distintas', () => {
    const deals = new Set(Array.from({ length: 12 }, (_, seed) => dealRoles(7, seededRandom(seed + 1)).join(',')));
    expect(deals.size).toBeGreaterThan(2);
  });

  it('da al Sheriff una vida adicional y reparte mano según sus vidas', () => {
    const state = createGame(Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, kind: 'HUMAN' as const })), 9);
    const sheriff = state.players.find((player) => player.role === 'SHERIFF')!;
    expect(sheriff.maxLives).toBe(sheriff.character.lives + 1);
    expect(sheriff.hand).toHaveLength(sheriff.maxLives);
  });
});
