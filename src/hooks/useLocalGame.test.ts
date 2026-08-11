import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLocalGame } from './useLocalGame';

const setups = Array.from({ length: 4 }, (_, index) => ({
  id: index === 0 ? 'you' : `bot-${index}`,
  name: index === 0 ? 'Humano' : `Bot ${index}`,
  kind: index === 0 ? 'HUMAN' as const : 'AI' as const,
}));

describe('useLocalGame', () => {
  it('inicia la partida local ofreciendo dos personajes al humano', () => {
    const { result } = renderHook(() => useLocalGame(setups, 20260811));

    expect(result.current.state.turn.phase).toBe('CHARACTER_CHOICE');
    expect(result.current.state.characterDraft?.optionsByPlayer.you).toHaveLength(2);
    expect(result.current.state.characterDraft?.chosenByPlayer.you).toBeUndefined();
    expect(result.current.state.players.find((player) => player.id === 'you')?.hand).toHaveLength(0);
  });
});
