import type { GameState, Player } from '../../types';
import { CARD_CATALOG } from '../cards/catalog';

const living = (state: GameState): readonly Player[] => state.players.filter((player) => player.alive).sort((a, b) => a.seat - b.seat);

export const distanceBetween = (state: GameState, sourceId: string, targetId: string): number => {
  const players = living(state);
  const sourceIndex = players.findIndex((player) => player.id === sourceId);
  const targetIndex = players.findIndex((player) => player.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return Number.POSITIVE_INFINITY;
  if (sourceIndex === targetIndex) return 0;
  const clockwise = (targetIndex - sourceIndex + players.length) % players.length;
  const counterClockwise = players.length - clockwise;
  const source = players[sourceIndex];
  const target = players[targetIndex];
  if (!source || !target) return Number.POSITIVE_INFINITY;
  const scope = source.equipment.scope || source.character.name === 'Rose Doolan' ? 1 : 0;
  const mustang = target.equipment.mustang || target.character.name === 'Paul Regret' ? 1 : 0;
  return Math.max(1, Math.min(clockwise, counterClockwise) - scope + mustang);
};

export const weaponRange = (player: Player): number => {
  const weapon = player.equipment.weapon;
  return weapon ? CARD_CATALOG[weapon.name].range ?? 1 : 1;
};

export const isInRange = (state: GameState, sourceId: string, targetId: string, range = weaponRange(state.players.find((p) => p.id === sourceId)!)): boolean =>
  distanceBetween(state, sourceId, targetId) <= range;
