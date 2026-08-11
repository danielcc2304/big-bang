import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../game/engine';
import { characterByName } from '../game/characters/characters';
import { CARD_CATALOG } from '../game/cards/catalog';
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

  it('muestra las dos habilidades al jugador que elige personaje', () => {
    const state = createGame(setups, 29, 'DRAFT_TWO');
    render(<GameBoard state={state} viewerId={setups[0]!.id} error={null} dispatch={vi.fn(() => true)} onExit={() => undefined} syncLabel="ONLINE" />);

    expect(screen.getByRole('heading', { name: 'Elige tu pistolero' })).toBeInTheDocument();
    for (const name of state.characterDraft!.optionsByPlayer[setups[0]!.id]!) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
  });

  it('no encola fases automáticas desde un cliente online', () => {
    const state = createGame(setups, 31);
    const dispatch = vi.fn(() => true);
    render(<GameBoard state={{ ...state, turn: { ...state.turn, currentPlayerId: setups[0]!.id } }} viewerId={setups[0]!.id} error={null} dispatch={dispatch} onExit={() => undefined} syncLabel="ONLINE" />);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('destaca públicamente al Sheriff y explica el rol propio', () => {
    const state = createGame(setups, 33);
    const viewer = state.players[0]!;
    const view = render(<GameBoard state={{ ...state, turn: { ...state.turn, currentPlayerId: setups[1]!.id, phase: 'PLAY' } }} viewerId={viewer.id} error={null} dispatch={() => true} onExit={() => undefined} />);

    expect(view.container.querySelectorAll('.sheriff-star')).toHaveLength(1);
    const roleBanner = view.container.querySelector('.viewer-role-banner');
    expect(roleBanner).toHaveTextContent('Tu rol');
    expect(roleBanner).toHaveTextContent(viewer.role === 'SHERIFF' ? 'Sheriff' : viewer.role === 'DEPUTY' ? 'Ayudante' : viewer.role === 'OUTLAW' ? 'Forajido' : 'Renegado');
  });

  it('permite a Pedro Ramírez escoger la carta superior del descarte', () => {
    const base = createGame(setups, 37);
    const discarded = base.deck[0]!;
    const state = {
      ...base,
      deck: base.deck.slice(1),
      discard: [discarded],
      players: base.players.map((player) => player.id === setups[0]!.id ? { ...player, character: characterByName('Pedro Ramirez') } : player),
      turn: { ...base.turn, currentPlayerId: setups[0]!.id, phase: 'DRAW' as const },
    };
    const dispatch = vi.fn(() => true);

    render(<GameBoard state={state} viewerId={setups[0]!.id} error={null} dispatch={dispatch} onExit={() => undefined} syncLabel="ONLINE" />);
    fireEvent.click(screen.getByRole('button', { name: `Tomar ${CARD_CATALOG[discarded.name].label}` }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'DRAW_CARDS', payload: { firstCardSource: 'DISCARD' } }));
  });
});
