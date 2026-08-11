import { describe, expect, it } from 'vitest';
import { makeCard, patchPlayer, playPhase, setCharacter, setRole, testState } from '../../test/helpers';
import { decideAiCommand } from './decide';
import { initialKnowledge } from './knowledge';

const fourPlayerRoles = () => {
  let state = testState();
  state = setRole(state, 'p0', 'SHERIFF');
  state = setRole(state, 'p1', 'OUTLAW');
  state = setRole(state, 'p2', 'OUTLAW');
  return setRole(state, 'p3', 'RENEGADE');
};

describe('estrategia de objetivos de la IA', () => {
  it('recalcula el descarte con la mano y las vidas actuales', () => {
    let state = playPhase(fourPlayerRoles(), 'p1');
    const hand = Array.from({ length: 6 }, (_, index) => makeCard('BANG', `discard-${index}`));
    state = patchPlayer(state, 'p1', { hand, lives: 3 });
    state = { ...state, turn: { ...state.turn, phase: 'DISCARD', pendingDiscardCount: 1 } };

    const decision = decideAiCommand(state, 'p1', initialKnowledge(state, 'p1'));

    expect(decision).toMatchObject({ type: 'DISCARD_CARDS' });
    expect(decision?.type === 'DISCARD_CARDS' && decision.payload.cardIds).toHaveLength(3);
  });

  it('Pedro Ramírez toma la carta superior del descarte durante su robo', () => {
    let state = fourPlayerRoles();
    const discarded = makeCard('BEER', 'ai-pedro-discard');
    state = { ...state, discard: [discarded], turn: { ...state.turn, currentPlayerId: 'p3', phase: 'DRAW' } };
    state = setCharacter(state, 'p3', 'Pedro Ramirez');

    const decision = decideAiCommand(state, 'p3', initialKnowledge(state, 'p3'));

    expect(decision).toMatchObject({ type: 'DRAW_CARDS', payload: { firstCardSource: 'DISCARD' } });
  });

  it('el Renegado evita atacar al Sheriff mientras haya más rivales', () => {
    let state = playPhase(fourPlayerRoles(), 'p3');
    const duel = makeCard('DUEL', 'renegade-balance-duel');
    state = patchPlayer(state, 'p3', { hand: [duel] });

    const decision = decideAiCommand(state, 'p3', initialKnowledge(state, 'p3'));

    expect(decision).toMatchObject({ type: 'PLAY_CARD', payload: { cardId: duel.id, targetPlayerId: 'p1' } });
  });

  it('el Renegado ataca al Sheriff cuando solo quedan los dos', () => {
    let state = playPhase(fourPlayerRoles(), 'p3');
    const duel = makeCard('DUEL', 'renegade-final-duel');
    state = patchPlayer(state, 'p1', { alive: false });
    state = patchPlayer(state, 'p2', { alive: false });
    state = patchPlayer(state, 'p3', { hand: [duel] });

    const decision = decideAiCommand(state, 'p3', initialKnowledge(state, 'p3'));

    expect(decision).toMatchObject({ type: 'PLAY_CARD', payload: { cardId: duel.id, targetPlayerId: 'p0' } });
  });

  it('los Forajidos mantienen al Sheriff como objetivo prioritario', () => {
    let state = playPhase(fourPlayerRoles(), 'p1');
    const duel = makeCard('DUEL', 'outlaw-duel');
    state = patchPlayer(state, 'p1', { hand: [duel] });

    const decision = decideAiCommand(state, 'p1', initialKnowledge(state, 'p1'));

    expect(decision).toMatchObject({ type: 'PLAY_CARD', payload: { cardId: duel.id, targetPlayerId: 'p0' } });
  });

  it.each(['DEPUTY', 'RENEGADE'] as const)('%s evita ataques globales que dañarían al Sheriff', (role) => {
    let state = playPhase(fourPlayerRoles(), 'p1');
    const gatling = makeCard('GATLING', `${role.toLowerCase()}-gatling`);
    state = setRole(state, 'p1', role);
    state = patchPlayer(state, 'p1', { hand: [gatling] });

    const decision = decideAiCommand(state, 'p1', initialKnowledge(state, 'p1'));

    expect(decision).toMatchObject({ type: 'END_TURN' });
  });

  it('el Renegado puede usar ataques globales en el duelo final', () => {
    let state = playPhase(fourPlayerRoles(), 'p3');
    const gatling = makeCard('GATLING', 'renegade-final-gatling');
    state = patchPlayer(state, 'p1', { alive: false });
    state = patchPlayer(state, 'p2', { alive: false });
    state = patchPlayer(state, 'p3', { hand: [gatling] });

    const decision = decideAiCommand(state, 'p3', initialKnowledge(state, 'p3'));

    expect(decision).toMatchObject({ type: 'PLAY_CARD', payload: { cardId: gatling.id } });
  });
});
