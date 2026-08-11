import type { Card, GameState, Player } from '../types';
import { distanceBetween } from '../game/rules/distance';
import { CARD_CATALOG } from '../game/cards/catalog';

interface PlayerPanelProps {
  readonly player: Player;
  readonly state: GameState;
  readonly viewerId: string;
  readonly targetable: boolean;
  readonly onSelect: () => void;
  readonly onInspect: () => void;
}

export const PlayerPanel = ({ player, state, viewerId, targetable, onSelect, onInspect }: PlayerPanelProps) => {
  const active = state.turn.currentPlayerId === player.id;
  const role = player.role === 'SHERIFF' || player.id === viewerId || !player.alive ? player.role : 'SECRET';
  const equipment = Object.values(player.equipment).filter((card): card is Card => card !== null);
  return (
    <article className={`player-panel ${active ? 'active' : ''} ${!player.alive ? 'dead' : ''} ${targetable ? 'targetable' : ''}`}>
      <button className="player-main" onClick={targetable ? onSelect : onInspect} data-testid={`player-${player.id}`}>
        <span className="role-tag">{role === 'SECRET' ? 'ROL SECRETO' : role}</span>
        <span className="player-name">{player.name}</span>
        <span className="character-name">{player.character.name}</span>
        <span className="character-ability">{player.character.ability}</span>
        <span className="life-row" aria-label={`${player.lives} vidas`}>{'♥'.repeat(Math.max(0, player.lives))}<i>{player.lives}/{player.maxLives}</i></span>
        <span className="player-meta">{player.hand.length} cartas · distancia {distanceBetween(state, viewerId, player.id)}</span>
      </button>
      <div className="equipment-row">
        {equipment.length === 0 ? <span className="empty-equip">Sin equipo</span> : equipment.map((card) => <span key={card.id}>{CARD_CATALOG[card.name].label}</span>)}
      </div>
    </article>
  );
};
