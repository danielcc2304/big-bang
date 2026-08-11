import type { Card } from '../types';
import { CARD_CATALOG } from '../game/cards/catalog';

const SUITS: Record<Card['suit'], string> = { SPADES: '♠', HEARTS: '♥', DIAMONDS: '♦', CLUBS: '♣' };

interface CardViewProps {
  readonly card: Card;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}

export const CardView = ({ card, selected = false, disabled = false, onClick }: CardViewProps) => {
  const definition = CARD_CATALOG[card.name];
  const redSuit = card.suit === 'HEARTS' || card.suit === 'DIAMONDS';
  return (
    <button
      className={`playing-card ${definition.kind.toLowerCase()} ${selected ? 'selected' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={`${definition.label}, ${card.rank} de ${SUITS[card.suit]}`}
    >
      <span className="card-inner">
        <span className="card-title">{definition.label}</span>
        <span className="card-art" aria-hidden="true">{definition.icon}</span>
        <span className="card-description">{definition.description}</span>
        <span className="card-footer">
          <span className={`card-suit ${redSuit ? 'red' : ''}`}>{card.rank}{SUITS[card.suit]}</span>
          <span>{definition.kind === 'BROWN' ? 'MARRÓN' : 'AZUL'}</span>
        </span>
      </span>
    </button>
  );
};
