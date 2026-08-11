import type { GameState, Winner } from '../../types';

export const determineWinner = (state: GameState): Winner | null => {
  const alive = state.players.filter((player) => player.alive);
  const sheriff = state.players.find((player) => player.role === 'SHERIFF');
  if (!sheriff?.alive) return alive.length === 1 && alive[0]?.role === 'RENEGADE' ? 'RENEGADE' : 'OUTLAWS';
  const threatsRemain = alive.some((player) => player.role === 'OUTLAW' || player.role === 'RENEGADE');
  return threatsRemain ? null : 'LAW';
};
