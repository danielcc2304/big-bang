import type { GameState } from '../../types';

export interface RoleSuspicion {
  readonly playerId: string;
  readonly law: number;
  readonly outlaw: number;
  readonly renegade: number;
}

export interface AiKnowledge {
  readonly observerId: string;
  readonly suspicions: Readonly<Record<string, RoleSuspicion>>;
}

export const initialKnowledge = (state: GameState, observerId: string): AiKnowledge => ({
  observerId,
  suspicions: Object.fromEntries(state.players.filter((player) => player.id !== observerId).map((player) => [player.id, {
    playerId: player.id,
    law: player.role === 'SHERIFF' ? 1 : 0,
    outlaw: 0,
    renegade: player.role === 'SHERIFF' ? 0 : 0.2,
  }])),
});

export const observeAttack = (knowledge: AiKnowledge, attackerId: string, targetId: string, sheriffId: string): AiKnowledge => {
  const current = knowledge.suspicions[attackerId];
  if (!current) return knowledge;
  const delta = targetId === sheriffId ? { law: -0.5, outlaw: 0.8 } : { law: 0.15, outlaw: 0.1 };
  return { ...knowledge, suspicions: { ...knowledge.suspicions, [attackerId]: { ...current, law: current.law + delta.law, outlaw: current.outlaw + delta.outlaw } } };
};
