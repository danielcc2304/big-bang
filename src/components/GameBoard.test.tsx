import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createGame } from '../game/engine';
import { GameBoard } from './GameBoard';

const setups = Array.from({ length: 4 }, (_, index) => ({
  id: `player-${index}`,
  name: `Jugador ${index + 1}`,
  kind: index === 0 ? 'HUMAN' as const : 'AI' as const,
}));

describe('GameBoard', () => {
  it('muestra el nombre de la última carta descartada', () => {
    const base = createGame(setups, 17);
    const discarded = base.deck.find((card) => card.name === 'CAT_BALOU')!;
    const state = {
      ...base,
      deck: base.deck.filter((card) => card.id !== discarded.id),
      discard: [discarded],
      turn: { ...base.turn, currentPlayerId: setups[1]!.id, phase: 'PLAY' as const },
    };

    render(<GameBoard state={state} viewerId={setups[0]!.id} error={null} dispatch={() => true} onExit={() => undefined} />);

    expect(screen.getByLabelText('Último descarte: La Ingenua Explosiva')).toHaveTextContent('La Ingenua Explosiva');
  });
});
