import { describe, expect, it } from 'vitest';
import { applyCommand } from './applyCommand';
import { command } from './commands';
import { makeCard, patchPlayer, playPhase, run, setCharacter, testState } from '../../test/helpers';

describe('combate y personajes', () => {
  it('resuelve BANG! con Fallaste! sin perder vidas', () => {
    let state = setCharacter(playPhase(testState()), 'p0', 'Bart Cassidy');
    const bang = makeCard('BANG', 'bang'); const missed = makeCard('MISSED', 'missed');
    state = patchPlayer(state, 'p0', { hand: [bang] }); state = patchPlayer(state, 'p1', { hand: [missed] });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: bang.id, targetPlayerId: 'p1' }));
    const lives = state.players[1]!.lives;
    state = run(state, command(state, 'p1', 'REACTION', { cardIds: [missed.id] }));
    expect(state.players[1]!.lives).toBe(lives);
    expect(state.reaction).toBeNull();
  });

  it('Slab the Killer exige dos Fallaste!', () => {
    let state = setCharacter(playPhase(testState()), 'p0', 'Slab the Killer');
    const bang = makeCard('BANG', 'bang'); const m1 = makeCard('MISSED', 'm1'); const m2 = makeCard('MISSED', 'm2');
    state = patchPlayer(state, 'p0', { hand: [bang] }); state = patchPlayer(state, 'p1', { hand: [m1, m2] });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: bang.id, targetPlayerId: 'p1' }));
    expect(state.reaction?.requiredCards).toBe(2);
    state = run(state, command(state, 'p1', 'REACTION', { cardIds: [m1.id, m2.id] }));
    expect(state.reaction).toBeNull();
  });

  it('Calamity Janet usa BANG! como Fallaste!', () => {
    let state = setCharacter(playPhase(testState()), 'p1', 'Calamity Janet');
    const attack = makeCard('BANG', 'attack'); const response = makeCard('BANG', 'response');
    state = patchPlayer(state, 'p0', { hand: [attack] }); state = patchPlayer(state, 'p1', { hand: [response] });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: attack.id, targetPlayerId: 'p1' }));
    state = run(state, command(state, 'p1', 'REACTION', { cardIds: [response.id] }));
    expect(state.players[1]!.hand).toHaveLength(0);
  });

  it('Willy the Kid puede jugar varios BANG! en el mismo turno', () => {
    let state = setCharacter(playPhase(testState()), 'p0', 'Willy the Kid');
    const b1 = makeCard('BANG', 'b1'); const b2 = makeCard('BANG', 'b2');
    state = patchPlayer(state, 'p0', { hand: [b1, b2] });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: b1.id, targetPlayerId: 'p1' }));
    state = run(state, command(state, 'p1', 'REACTION', { cardIds: [] }));
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: b2.id, targetPlayerId: 'p1' }));
    expect(state.reaction?.targetPlayerId).toBe('p1');
  });

  it('Volcanic equipada permite varios BANG! y sigue siendo una carta en juego', () => {
    let state = playPhase(testState());
    const volcanic = makeCard('VOLCANIC', 'volcanic'); const b1 = makeCard('BANG', 'b1'); const b2 = makeCard('BANG', 'b2');
    state = patchPlayer(state, 'p0', { hand: [b1, b2], equipment: { ...state.players[0]!.equipment, weapon: volcanic } });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: b1.id, targetPlayerId: 'p1' }));
    state = run(state, command(state, 'p1', 'REACTION', { cardIds: [] }));
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: b2.id, targetPlayerId: 'p1' }));
    expect(state.players[0]!.equipment.weapon?.id).toBe('volcanic');
  });

  it('rechaza el segundo BANG! sin Willy ni Volcanic', () => {
    let state = setCharacter(playPhase(testState()), 'p0', 'Bart Cassidy');
    const b1 = makeCard('BANG', 'b1'); const b2 = makeCard('BANG', 'b2');
    state = patchPlayer(state, 'p0', { hand: [b1, b2] });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: b1.id, targetPlayerId: 'p1' }));
    state = run(state, command(state, 'p1', 'REACTION', { cardIds: [] }));
    const result = applyCommand(state, command(state, 'p0', 'PLAY_CARD', { cardId: b2.id, targetPlayerId: 'p1' }));
    expect(result.ok).toBe(false);
  });

  it('Barril con corazones evita BANG!', () => {
    let state = playPhase(testState());
    const bang = makeCard('BANG', 'bang'); const barrel = makeCard('BARREL', 'barrel'); const heart = makeCard('BEER', 'heart', 'HEARTS');
    state = { ...state, deck: [heart, ...state.deck] };
    state = patchPlayer(state, 'p0', { hand: [bang] }); state = patchPlayer(state, 'p1', { equipment: { ...state.players[1]!.equipment, barrel } });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: bang.id, targetPlayerId: 'p1' }));
    expect(state.reaction).toBeNull();
    expect(state.discard.some((card) => card.id === heart.id)).toBe(true);
  });

  it('Duelo alterna BANG! hasta que alguien falla', () => {
    let state = playPhase(testState());
    const duel = makeCard('DUEL', 'duel'); const response = makeCard('BANG', 'response');
    state = patchPlayer(state, 'p0', { hand: [duel] }); state = patchPlayer(state, 'p1', { hand: [response] });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: duel.id, targetPlayerId: 'p1' }));
    state = run(state, command(state, 'p1', 'REACTION', { cardIds: [response.id] }));
    expect(state.reaction?.targetPlayerId).toBe('p0');
    const lives = state.players[0]!.lives;
    state = run(state, command(state, 'p0', 'REACTION', { cardIds: [] }));
    expect(state.players[0]!.lives).toBe(lives - 1);
  });

  it.each(['INDIANS', 'GATLING'] as const)('%s persiste y avanza por cada objetivo', (name) => {
    let state = playPhase(testState()); const area = makeCard(name, name);
    state = patchPlayer(state, 'p0', { hand: [area] });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: area.id }));
    expect(state.multiAction?.targets).toHaveLength(3);
    for (const target of ['p1', 'p2', 'p3']) state = run(state, command(state, target, 'REACTION', { cardIds: [] }));
    expect(state.multiAction).toBeNull(); expect(state.turn.phase).toBe('PLAY');
  });
});
