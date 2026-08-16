import type { GameState } from '../../types';
import { rolesForPlayerCount } from '../rules/roles';

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

export const initialKnowledge = (state: GameState, observerId: string): AiKnowledge => {
  const roles = rolesForPlayerCount(state.players.length);
  // Sheriff is public; all other roles start from the role-count prior and
  // are updated only by public actions observed during the game.
  const observer = state.players.find((player) => player.id === observerId);
  const observerRole = observer?.role;
  const unknownCount = Math.max(1, state.players.length - 1 - (observerRole === 'SHERIFF' ? 0 : 1));
  const remainingOutlaws = roles.filter((role) => role === 'OUTLAW').length - (observerRole === 'OUTLAW' ? 1 : 0);
  const remainingRenegades = roles.filter((role) => role === 'RENEGADE').length - (observerRole === 'RENEGADE' ? 1 : 0);
  const outlawPrior = Math.max(0, remainingOutlaws) / unknownCount;
  const renegadePrior = Math.max(0, remainingRenegades) / unknownCount;
  const sheriff = state.players.find((player) => player.role === 'SHERIFF');
  let suspicions = Object.fromEntries(state.players.filter((player) => player.id !== observerId).map((player) => [player.id, {
    playerId: player.id,
    law: player.role === 'SHERIFF' ? 1 : 0.1,
    outlaw: player.role === 'SHERIFF' ? 0 : outlawPrior,
    renegade: player.role === 'SHERIFF' ? 0 : renegadePrior,
  }])) as Record<string, RoleSuspicion>;
  // Rebuild beliefs from public attack logs so the AI does not play with a
  // fixed target list throughout the whole match.
  if (sheriff) {
    for (const entry of state.logs) {
      for (const attacker of state.players) {
        if (attacker.id === observerId) continue;
        for (const target of state.players) {
          if (target.id === attacker.id) continue;
          const attacked = entry.message.includes(`${attacker.name} juega BANG! contra ${target.name}`)
            || entry.message.includes(`${attacker.name} reta a ${target.name}`);
          if (!attacked) continue;
          const updated = observeAttack({ observerId, suspicions }, attacker.id, target.id, sheriff.id);
          suspicions = { ...updated.suspicions };
        }
      }
    }
  }
  return {
    observerId,
    suspicions,
  };
};

export const observeAttack = (knowledge: AiKnowledge, attackerId: string, targetId: string, sheriffId: string): AiKnowledge => {
  const current = knowledge.suspicions[attackerId];
  if (!current) return knowledge;
  const delta = targetId === sheriffId ? { law: -0.5, outlaw: 0.8 } : { law: 0.15, outlaw: 0.1 };
  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  return {
    ...knowledge,
    suspicions: {
      ...knowledge.suspicions,
      [attackerId]: { ...current, law: clamp(current.law + delta.law), outlaw: clamp(current.outlaw + delta.outlaw) },
    },
  };
};
