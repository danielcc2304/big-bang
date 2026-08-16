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

  it('Kit Carlson elige dos cartas reales de las tres reveladas', () => {
    let state = fourPlayerRoles();
    state = setCharacter(state, 'p1', 'Kit Carlson');
    state = patchPlayer(state, 'p1', { hand: [], kind: 'AI' });
    state = { ...state, deck: [makeCard('BEER', 'ai-kit-beer'), makeCard('BANG', 'ai-kit-bang'), makeCard('DYNAMITE', 'ai-kit-dynamite'), ...state.deck], turn: { ...state.turn, currentPlayerId: 'p1', phase: 'DRAW' } };

    const decision = decideAiCommand(state, 'p1', initialKnowledge(state, 'p1'));

    expect(decision?.type).toBe('DRAW_CARDS');
    if (decision?.type === 'DRAW_CARDS') expect(decision.payload.drawCardIds).toHaveLength(2);
  });

  it('Jesse Jones elige una mano con cartas para su primer robo', () => {
    let state = fourPlayerRoles();
    state = setCharacter(state, 'p1', 'Jesse Jones');
    state = patchPlayer(state, 'p1', { hand: [] });
    state = patchPlayer(state, 'p0', { hand: [] });
    state = patchPlayer(state, 'p2', { hand: [makeCard('BEER', 'ai-jesse-target')] });
    state = patchPlayer(state, 'p3', { hand: [] });
    state = { ...state, turn: { ...state.turn, currentPlayerId: 'p1', phase: 'DRAW' } };

    const decision = decideAiCommand(state, 'p1', initialKnowledge(state, 'p1'));

    expect(decision).toMatchObject({ type: 'DRAW_CARDS', payload: { firstCardSource: 'PLAYER_HAND', sourcePlayerId: 'p2' } });
  });

  it('Sid Ketchum usa su curación cuando tiene dos cartas y está herido', () => {
    let state = playPhase(fourPlayerRoles(), 'p1');
    state = setCharacter(state, 'p1', 'Sid Ketchum');
    state = patchPlayer(state, 'p1', { lives: 2, hand: [makeCard('BANG', 'sid-bang'), makeCard('MISSED', 'sid-missed')] });

    const decision = decideAiCommand(state, 'p1', initialKnowledge(state, 'p1'));

    expect(decision?.type).toBe('USE_CHARACTER_ABILITY');
    if (decision?.type === 'USE_CHARACTER_ABILITY') expect([...decision.payload.cardIds].sort()).toEqual(['sid-bang', 'sid-missed']);
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

  it('la ley decide por sospechas públicas y no por el rol secreto real', () => {
    let state = playPhase(fourPlayerRoles(), 'p0');
    const duel = makeCard('DUEL', 'suspicion-duel');
    state = patchPlayer(state, 'p0', { hand: [duel], kind: 'AI' });
    const base = initialKnowledge(state, 'p0');
    const knowledge = {
      ...base,
      suspicions: {
        ...base.suspicions,
        p1: { ...base.suspicions.p1!, outlaw: 0.95 },
        p2: { ...base.suspicions.p2!, outlaw: 0.05 },
      },
    };

    const decision = decideAiCommand(state, 'p0', knowledge);

    expect(decision).toMatchObject({ type: 'PLAY_CARD', payload: { cardId: duel.id, targetPlayerId: 'p1' } });
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
