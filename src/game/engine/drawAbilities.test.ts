import { describe, expect, it } from 'vitest';
import type { GameCommand } from '../../types';
import { applyCommand } from './applyCommand';
import { command } from './commands';
import { makeCard, patchPlayer, setCharacter, testState } from '../../test/helpers';

const drawPhase = () => ({ ...testState(), turn: { ...testState().turn, currentPlayerId: 'p0', phase: 'DRAW' as const } });

describe('habilidades durante la fase de robo', () => {
  it('Pedro Ramírez puede tomar la primera carta del descarte y la segunda del mazo', () => {
    let state = setCharacter(drawPhase(), 'p0', 'Pedro Ramirez');
    const discarded = makeCard('BEER', 'pedro-discard');
    const deckCard = makeCard('BANG', 'pedro-deck');
    state = { ...state, discard: [discarded], deck: [deckCard, ...state.deck] };
    state = patchPlayer(state, 'p0', { hand: [] });

    const result = applyCommand(state, command(state, 'p0', 'DRAW_CARDS', { firstCardSource: 'DISCARD' }));

    expect(result.ok).toBe(true);
    expect(result.state.players[0]!.hand.map((card) => card.id)).toEqual([discarded.id, deckCard.id]);
    expect(result.state.discard).toHaveLength(0);
    expect(result.state.turn.phase).toBe('PLAY');
  });

  it('Pedro Ramírez puede renunciar a su habilidad y robar dos del mazo', () => {
    let state = setCharacter(drawPhase(), 'p0', 'Pedro Ramirez');
    const discarded = makeCard('BEER', 'pedro-kept-discard');
    const first = makeCard('BANG', 'pedro-deck-1'); const second = makeCard('MISSED', 'pedro-deck-2');
    state = { ...state, discard: [discarded], deck: [first, second, ...state.deck] };
    state = patchPlayer(state, 'p0', { hand: [] });

    const result = applyCommand(state, command(state, 'p0', 'DRAW_CARDS', { firstCardSource: 'DECK' }));

    expect(result.ok).toBe(true);
    expect(result.state.players[0]!.hand.map((card) => card.id)).toEqual([first.id, second.id]);
    expect(result.state.discard.at(-1)?.id).toBe(discarded.id);
  });

  it('impide que otro personaje robe del descarte', () => {
    let state = setCharacter(drawPhase(), 'p0', 'Bart Cassidy');
    state = { ...state, discard: [makeCard('BEER', 'protected-discard')] };

    const result = applyCommand(state, command(state, 'p0', 'DRAW_CARDS', { firstCardSource: 'DISCARD' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ABILITY_NOT_AVAILABLE');
  });

  it('impide usar la habilidad de Pedro con el descarte vacío', () => {
    const state = setCharacter({ ...drawPhase(), discard: [] }, 'p0', 'Pedro Ramirez');

    const result = applyCommand(state, command(state, 'p0', 'DRAW_CARDS', { firstCardSource: 'DISCARD' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY_DISCARD');
  });

  it('rechaza una procedencia de robo manipulada', () => {
    const state = setCharacter(drawPhase(), 'p0', 'Pedro Ramirez');
    const malformed = { ...command(state, 'p0', 'DRAW_CARDS', {}), payload: { firstCardSource: 'HAND' } } as unknown as GameCommand;

    const result = applyCommand(state, malformed);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DRAW_SOURCE');
  });
});
