import { describe, expect, it } from 'vitest';
import { command } from './commands';
import { applyCommand } from './applyCommand';
import { collectCards, validateGameState } from './invariants';
import { damagePlayer } from './helpers';
import { makeCard, patchPlayer, playPhase, setCharacter, setRole, testState } from '../../test/helpers';
import { determineWinner } from '../rules/victory';
import { electCoordinator } from '../../multiplayer/coordinator';

describe('eliminación, victoria e invariantes', () => {
  it('cualquier jugador que elimina a un Forajido roba tres cartas', () => {
    let state = setRole(testState(), 'p1', 'OUTLAW');
    state = patchPlayer(state, 'p1', { lives: 1 });
    const before = state.players[0]!.hand.length;
    state = damagePlayer(state, 'p1', 1, 'p0');
    expect(state.players[0]!.hand.length).toBe(before + 3);
    expect(state.players[1]!.alive).toBe(false);
  });

  it('el Sheriff que elimina a un Ayudante descarta mano y equipo', () => {
    let state = setCharacter(testState(5), 'p0', 'Bart Cassidy');
    state = setRole(state, 'p0', 'SHERIFF'); state = setRole(state, 'p1', 'DEPUTY');
    state = patchPlayer(state, 'p0', { hand: [makeCard('BANG', 'held')], equipment: { ...state.players[0]!.equipment, weapon: makeCard('VOLCANIC', 'gun') } });
    state = patchPlayer(state, 'p1', { lives: 1 });
    state = damagePlayer(state, 'p1', 1, 'p0');
    expect(state.players[0]!.hand).toHaveLength(0); expect(state.players[0]!.equipment.weapon).toBeNull();
  });

  it('Vulture Sam recibe todas las cartas del eliminado', () => {
    let state = setCharacter(testState(), 'p2', 'Vulture Sam');
    const held = makeCard('BEER', 'spoils'); state = patchPlayer(state, 'p1', { lives: 1, hand: [held] });
    state = damagePlayer(state, 'p1', 1, 'p0');
    expect(state.players[2]!.hand.some((card) => card.id === held.id)).toBe(true);
  });

  it('detecta las tres condiciones de victoria', () => {
    let law = testState();
    law = { ...law, players: law.players.map((player, index) => ({ ...player, role: index === 0 ? 'SHERIFF' : index === 1 ? 'DEPUTY' : index === 2 ? 'OUTLAW' : 'RENEGADE', alive: index < 2 })) };
    expect(determineWinner(law)).toBe('LAW');
    const outlaws = { ...law, players: law.players.map((player, index) => ({ ...player, alive: index !== 0, role: index === 3 ? 'OUTLAW' as const : player.role })) };
    expect(determineWinner(outlaws)).toBe('OUTLAWS');
    const renegade = { ...law, players: law.players.map((player, index) => ({ ...player, alive: index === 3, role: index === 3 ? 'RENEGADE' as const : player.role })) };
    expect(determineWinner(renegade)).toBe('RENEGADE');
  });

  it('un commandId duplicado es idempotente', () => {
    const state = { ...playPhase(testState()), turn: { ...testState().turn, currentPlayerId: 'p0', phase: 'PLAY' as const } };
    const end = command(state, 'p0', 'END_TURN', {});
    const first = applyCommand(state, end); expect(first.ok).toBe(true);
    const second = applyCommand(first.state, end); expect(second.ok).toBe(true); expect(second.state.revision).toBe(first.state.revision);
  });

  it('rechaza un comando con revisión antigua sin mutar el estado', () => {
    const state = playPhase(testState());
    const stale = { ...command(state, 'p0', 'END_TURN', {}), expectedRevision: state.revision - 1 };
    const result = applyCommand(state, stale);
    expect(result.ok).toBe(false); expect(result.state).toBe(state);
  });

  it('mantiene unicidad de cardId y jugador actual vivo', () => {
    const state = testState();
    expect(validateGameState(state)).toEqual([]);
    expect(new Set(collectCards(state).map((card) => card.id)).size).toBe(collectCards(state).length);
    expect(state.players.find((player) => player.id === state.turn.currentPlayerId)?.alive).toBe(true);
  });
});

describe('failover del coordinador', () => {
  it('impide tomar un lease vigente', () => {
    const lease = { coordinatorId: 'host', coordinatorEpoch: 2, leaseUntil: 2_000, heartbeat: 1_000 };
    expect(electCoordinator(lease, 'guest', 1_500)).toBeNull();
  });

  it('adquiere atómicamente un lease vencido e incrementa epoch', () => {
    const lease = { coordinatorId: 'host', coordinatorEpoch: 2, leaseUntil: 2_000, heartbeat: 1_000 };
    const next = electCoordinator(lease, 'guest', 2_001);
    expect(next?.coordinatorId).toBe('guest'); expect(next?.coordinatorEpoch).toBe(3); expect(next!.leaseUntil).toBeGreaterThan(2_001);
  });
});
