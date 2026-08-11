import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { CardView } from './CardView';

const card = (overrides: Partial<Card>): Card => ({
  id: 'card-1',
  name: 'BANG',
  kind: 'BROWN',
  suit: 'HEARTS',
  rank: 'A',
  ...overrides,
});

describe('CardView', () => {
  it('distingue visualmente una carta de acción', () => {
    render(<CardView card={card({})} />);

    expect(screen.getByText('ACCIÓN')).toBeInTheDocument();
    expect(screen.getByLabelText(/¡BANG!/)).toHaveClass('brown');
  });

  it('muestra el alcance de las armas', () => {
    render(<CardView card={card({ name: 'REMINGTON', kind: 'WEAPON' })} />);

    expect(screen.getByText('ALCANCE 3')).toBeInTheDocument();
    expect(screen.getByText('ARMA')).toBeInTheDocument();
  });
});
