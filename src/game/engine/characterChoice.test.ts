import { describe, expect, it } from 'vitest';
import { applyCommand, command, createGame } from '.';
import { CHARACTERS } from '../characters/characters';

const setups = Array.from({ length: 4 }, (_, index) => ({
  id: `p${index}`,
  name: `P${index}`,
  kind: index === 0 ? 'HUMAN' as const : 'AI' as const,
}));

describe('variante de elección entre dos personajes', () => {
  it('ofrece dos opciones únicas por jugador y empieza tras elegir todos', () => {
    let state = createGame(setups, 2026, 'DRAFT_TWO');

    expect(state.turn.phase).toBe('CHARACTER_CHOICE');
    expect(state.players.every((player) => player.hand.length === 0)).toBe(true);
    const offered = Object.values(state.characterDraft!.optionsByPlayer).flat();
    expect(offered).toHaveLength(8);
    expect(new Set(offered)).toHaveLength(8);

    for (const player of state.players) {
      expect(state.turn.currentPlayerId).toBe(player.id);
      const choice = state.characterDraft!.optionsByPlayer[player.id]![1];
      const result = applyCommand(state, command(state, player.id, 'CHARACTER_CHOICE', { characterName: choice }));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }

    expect(state.characterDraft).toBeNull();
    expect(state.turn.phase).toBe('TURN_START');
    expect(state.players.every((player) => player.hand.length === player.maxLives)).toBe(true);
  });

  it('rechaza personajes que no están entre las opciones privadas', () => {
    const state = createGame(setups, 2027, 'DRAFT_TWO');
    const player = state.players[0]!;
    const offered = state.characterDraft!.optionsByPlayer[player.id]!;
    const unavailable = CHARACTERS.map((candidate) => candidate.name).find((name) => !offered.includes(name))!;
    const result = applyCommand(state, command(state, player.id, 'CHARACTER_CHOICE', { characterName: unavailable }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CHARACTER_NOT_OFFERED');
  });
});
