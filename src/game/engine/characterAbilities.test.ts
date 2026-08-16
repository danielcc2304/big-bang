import { describe, expect, it } from 'vitest';
import { applyCommand } from './applyCommand';
import { command } from './commands';
import { makeCard, patchPlayer, playPhase, run, setCharacter, testState } from '../../test/helpers';

describe('habilidades de personajes', () => {
  it('Suzy Lafayette roba al quedarse sin cartas después de jugar la última', () => {
    let state = playPhase(testState(), 'p0');
    const beer = makeCard('BEER', 'suzy-beer');
    const refill = makeCard('BANG', 'suzy-refill');
    state = setCharacter(state, 'p0', 'Suzy Lafayette');
    state = patchPlayer(state, 'p0', { hand: [beer], lives: 3 });
    state = { ...state, deck: [refill, ...state.deck] };

    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: beer.id }));

    expect(state.players[0]!.hand.map((card) => card.id)).toContain(refill.id);
  });

  it('El Gringo roba como máximo una carta por punto de daño', () => {
    let state = playPhase(testState(), 'p0');
    const bang = makeCard('BANG', 'gringo-bang');
    const hidden = makeCard('MUSTANG', 'gringo-hidden');
    state = setCharacter(state, 'p1', 'El Gringo');
    state = patchPlayer(state, 'p0', { hand: [bang, hidden] });
    state = patchPlayer(state, 'p1', { hand: [], lives: 3 });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: bang.id, targetPlayerId: 'p1' }));
    state = run(state, command(state, 'p1', 'REACTION', { cardIds: [], takeDamage: true }));

    const gringoHand = state.players[1]!.hand;
    expect(gringoHand.length).toBeLessThanOrEqual(1);
    expect(state.players[0]!.hand.some((card) => card.id === hidden.id)).toBe(false);
  });

  it('Sid Ketchum solo cura si entrega exactamente dos cartas y no supera su máximo', () => {
    let state = playPhase(testState(), 'p0');
    state = setCharacter(state, 'p0', 'Sid Ketchum');
    const first = makeCard('BANG', 'sid-first');
    const second = makeCard('MISSED', 'sid-second');
    state = patchPlayer(state, 'p0', { hand: [first, second], lives: 2 });
    const result = applyCommand(state, command(state, 'p0', 'USE_CHARACTER_ABILITY', { cardIds: [first.id, second.id] }));

    expect(result.ok).toBe(true);
    expect(result.state.players[0]!.lives).toBe(3);
    expect(result.state.players[0]!.hand).toHaveLength(0);
  });
});
