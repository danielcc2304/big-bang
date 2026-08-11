import { describe, expect, it } from 'vitest';
import { applyCommand } from './applyCommand';
import { command } from './commands';
import { makeCard, patchPlayer, playPhase, run, testState } from '../../test/helpers';

describe('cartas de acción y equipo', () => {
  it('Pánico roba una Volcanic equipada a distancia 1', () => {
    let state = playPhase(testState()); const panic = makeCard('PANIC', 'panic'); const volcanic = makeCard('VOLCANIC', 'volcanic');
    state = patchPlayer(state, 'p0', { hand: [panic] }); state = patchPlayer(state, 'p1', { equipment: { ...state.players[1]!.equipment, weapon: volcanic } });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: panic.id, targetPlayerId: 'p1', targetCardId: volcanic.id }));
    expect(state.players[0]!.hand.some((card) => card.id === volcanic.id)).toBe(true);
    expect(state.players[1]!.equipment.weapon).toBeNull();
  });

  it('Pánico sin carta pública roba de la mano sin duplicarla', () => {
    let state = playPhase(testState()); const panic = makeCard('PANIC', 'panic'); const hidden = makeCard('MUSTANG', 'hidden');
    state = patchPlayer(state, 'p0', { hand: [panic] }); state = patchPlayer(state, 'p1', { hand: [hidden] });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: panic.id, targetPlayerId: 'p1' }));
    expect(state.players[0]!.hand.map((card) => card.id)).toContain(hidden.id);
    expect(state.players[1]!.hand.map((card) => card.id)).not.toContain(hidden.id);
  });

  it('Cat Balou descarta una Volcanic equipada', () => {
    let state = playPhase(testState()); const cat = makeCard('CAT_BALOU', 'cat'); const volcanic = makeCard('VOLCANIC', 'volcanic');
    state = patchPlayer(state, 'p0', { hand: [cat] }); state = patchPlayer(state, 'p2', { equipment: { ...state.players[2]!.equipment, weapon: volcanic } });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: cat.id, targetPlayerId: 'p2', targetCardId: volcanic.id }));
    expect(state.discard.some((card) => card.id === volcanic.id)).toBe(true);
    expect(state.players[2]!.equipment.weapon).toBeNull();
  });

  it('Cat Balou permite elegir una carta pública concreta entre varias', () => {
    let state = playPhase(testState()); const cat = makeCard('CAT_BALOU', 'cat-choice'); const volcanic = makeCard('VOLCANIC', 'volcanic-choice'); const barrel = makeCard('BARREL', 'barrel-choice');
    state = patchPlayer(state, 'p0', { hand: [cat] }); state = patchPlayer(state, 'p2', { equipment: { ...state.players[2]!.equipment, weapon: volcanic, barrel } });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: cat.id, targetPlayerId: 'p2', targetCardId: barrel.id }));
    expect(state.players[2]!.equipment.weapon?.id).toBe(volcanic.id);
    expect(state.players[2]!.equipment.barrel).toBeNull();
    expect(state.discard.at(-1)?.id).toBe(barrel.id);
  });

  it('Cat Balou no permite indicar el id de una carta oculta', () => {
    let state = playPhase(testState()); const cat = makeCard('CAT_BALOU', 'cat-hidden'); const hidden = makeCard('MUSTANG', 'hidden-choice');
    state = patchPlayer(state, 'p0', { hand: [cat] }); state = patchPlayer(state, 'p2', { hand: [hidden] });
    const result = applyCommand(state, command(state, 'p0', 'PLAY_CARD', { cardId: cat.id, targetPlayerId: 'p2', targetCardId: hidden.id }));
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(state.players[0]!.hand).toContain(cat);
  });

  it('Cat Balou permite escoger una carta aleatoria de la mano', () => {
    let state = playPhase(testState()); const cat = makeCard('CAT_BALOU', 'cat-random'); const hiddenA = makeCard('MUSTANG', 'hidden-a'); const hiddenB = makeCard('BARREL', 'hidden-b');
    state = patchPlayer(state, 'p0', { hand: [cat] }); state = patchPlayer(state, 'p2', { hand: [hiddenA, hiddenB] });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: cat.id, targetPlayerId: 'p2', targetCardChoice: 'RANDOM_HAND' }));
    expect(state.players[2]!.hand).toHaveLength(1);
    expect(state.discard).toHaveLength(2);
  });

  it('Prisión no puede jugarse sobre el Sheriff', () => {
    let state = playPhase(testState()); const jail = makeCard('JAIL', 'jail');
    state = patchPlayer(state, 'p0', { hand: [jail] }); state = patchPlayer(state, 'p1', { role: 'SHERIFF' });
    expect(applyCommand(state, command(state, 'p0', 'PLAY_CARD', { cardId: jail.id, targetPlayerId: 'p1' })).ok).toBe(false);
  });

  it('Prisión hace perder el turno con un desenfunde que no sea corazones', () => {
    let state = testState(); const jail = makeCard('JAIL', 'jail'); const spade = makeCard('BANG', 'judge', 'SPADES', 'K');
    state = { ...state, deck: [spade, ...state.deck], turn: { number: 1, currentPlayerId: 'p0', phase: 'TURN_START', pendingDiscardCount: 0 } };
    state = patchPlayer(state, 'p0', { equipment: { ...state.players[0]!.equipment, jail } });
    state = run(state, command(state, 'p0', 'RESOLVE_TURN_START', {}));
    expect(state.turn.currentPlayerId).toBe('p1'); expect(state.players[0]!.equipment.jail).toBeNull();
  });

  it('Dinamita explota con picas entre 2 y 9', () => {
    let state = testState(); const dynamite = makeCard('DYNAMITE', 'dynamite'); const spade = makeCard('BANG', 'judge', 'SPADES', '5');
    state = { ...state, deck: [spade, ...state.deck], turn: { ...state.turn, currentPlayerId: 'p0', phase: 'TURN_START' } };
    const before = state.players[0]!.lives;
    state = patchPlayer(state, 'p0', { equipment: { ...state.players[0]!.equipment, dynamite } });
    state = run(state, command(state, 'p0', 'RESOLVE_TURN_START', {}));
    expect(state.players[0]!.lives).toBe(Math.max(0, before - 3));
    expect(state.discard.some((card) => card.id === dynamite.id)).toBe(true);
  });

  it('Almacén entrega exactamente una carta por jugador y vacía el pool', () => {
    let state = playPhase(testState()); const store = makeCard('GENERAL_STORE', 'store');
    state = patchPlayer(state, 'p0', { hand: [store] });
    state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: store.id }));
    const received = new Map(state.players.map((player) => [player.id, player.hand.length]));
    for (const playerId of ['p0', 'p1', 'p2', 'p3']) {
      const cardId = state.storeState!.cards[0]!.id;
      state = run(state, command(state, playerId, 'STORE_PICK', { cardId }));
    }
    expect(state.storeState).toBeNull(); expect(state.turn.phase).toBe('PLAY');
    state.players.forEach((player) => expect(player.hand.length).toBe((received.get(player.id) ?? 0) + 1));
  });

  it('doble STORE_PICK con el mismo commandId solo se aplica una vez', () => {
    let state = playPhase(testState()); const store = makeCard('GENERAL_STORE', 'store');
    state = patchPlayer(state, 'p0', { hand: [store] }); state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: store.id }));
    const pick = command(state, 'p0', 'STORE_PICK', { cardId: state.storeState!.cards[0]!.id });
    const once = run(state, pick); const twice = run(once, pick);
    expect(twice.revision).toBe(once.revision); expect(twice.players[0]!.hand).toHaveLength(once.players[0]!.hand.length);
  });

  it('dos elecciones concurrentes de la misma carta no pueden ganar', () => {
    let state = playPhase(testState()); const store = makeCard('GENERAL_STORE', 'store');
    state = patchPlayer(state, 'p0', { hand: [store] }); state = run(state, command(state, 'p0', 'PLAY_CARD', { cardId: store.id }));
    const cardId = state.storeState!.cards[0]!.id;
    const first = run(state, command(state, 'p0', 'STORE_PICK', { cardId }));
    const stale = applyCommand(first, command(state, 'p1', 'STORE_PICK', { cardId }));
    expect(stale.ok).toBe(false);
    expect(first.players.flatMap((player) => player.hand).filter((card) => card.id === cardId)).toHaveLength(1);
  });

  it('fin de turno abre descarte y exige conservar tantas cartas como vidas', () => {
    let state = playPhase(testState()); const hand = Array.from({ length: 6 }, (_, i) => makeCard('BANG', `h${i}`));
    state = patchPlayer(state, 'p0', { hand, lives: 3 });
    state = run(state, command(state, 'p0', 'END_TURN', {}));
    expect(state.turn.phase).toBe('DISCARD'); expect(state.turn.pendingDiscardCount).toBe(3);
    state = run(state, command(state, 'p0', 'DISCARD_CARDS', { cardIds: hand.slice(3).map((card) => card.id) }));
    expect(state.players[0]!.hand.map((card) => card.id)).toEqual(hand.slice(0, 3).map((card) => card.id));
  });
});
