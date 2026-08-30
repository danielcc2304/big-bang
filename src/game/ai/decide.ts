import type { Card, GameCommand, GameState, Player } from '../../types';
import { command } from '../engine/commands';
import { peekCards } from '../engine/helpers';
import { characterByName } from '../characters/characters';
import { distanceBetween, isInRange, weaponRange } from '../rules/distance';
import type { AiKnowledge } from './knowledge';

const publicEquipment = (player: Player): readonly Card[] => Object.values(player.equipment).filter((card): card is Card => card !== null);
const drawValue: Partial<Record<Card['name'], number>> = { BANG: 10, MISSED: 9, BEER: 8, VOLCANIC: 8, WINCHESTER: 8, REV_CARABINE: 7, REMINGTON: 6, SCHOFIELD: 5, BARREL: 6, MUSTANG: 5, SCOPE: 5, DYNAMITE: 4, JAIL: 4 };
const CARDINAL_RANGE: Partial<Record<Card['name'], number>> = { VOLCANIC: 1, SCHOFIELD: 2, REMINGTON: 3, REV_CARABINE: 4, WINCHESTER: 5 };
const weaponValue = (card: Card): number => card.kind === 'WEAPON' ? (card.name === 'VOLCANIC' ? 7 : (card.name === 'WINCHESTER' ? 6 : CARDINAL_RANGE[card.name] ?? 2)) : 0;

export const aiDecisionDelay = (state: GameState): number => {
  if (state.turn.phase === 'CHARACTER_CHOICE') return 900;
  if (state.reaction || state.storeState) return 1_100;
  if (state.turn.phase === 'TURN_START' || state.turn.phase === 'DRAW') return 800;
  return 1_450;
};

const targetScore = (state: GameState, actor: Player, target: Player, knowledge: AiKnowledge): number => {
  const aliveCount = state.players.filter((player) => player.alive).length;
  const suspicion = knowledge.suspicions[target.id];
  const outlawLikelihood = suspicion?.outlaw ?? 0;
  const renegadeLikelihood = suspicion?.renegade ?? 0;
  const sheriff = target.role === 'SHERIFF';

  // The Sheriff is public information; every other role must be inferred from
  // public actions instead of reading target.role (which would make the AI
  // omniscient and is the reason every bot used to tunnel the Sheriff).
  if (actor.role === 'OUTLAW') {
    // Outlaws must pressure the Sheriff, but should not waste attacks on a
    // player who public evidence already suggests is another Outlaw.
    return sheriff ? 1_000 : (suspicion?.law ?? 0) * 130 - outlawLikelihood * 95 - renegadeLikelihood * 25 - target.lives * 2;
  }
  if (actor.role === 'RENEGADE') {
    if (sheriff) return aliveCount === 2 ? 1_000 : -250;
    return outlawLikelihood * 135 - renegadeLikelihood * 70 - target.lives * 3;
  }
  if (sheriff) return -1_000;
  // Law players remove the most likely Outlaw, but when evidence is equal
  // they prefer the weakest reachable target instead of always seat 1.
  return outlawLikelihood * 140 + (suspicion?.law ?? 0) * 10 - target.lives * 3 - distanceBetween(state, actor.id, target.id);
};

const chooseTarget = (state: GameState, actor: Player, knowledge: AiKnowledge, range?: number, predicate: (target: Player) => boolean = () => true): Player | undefined =>
  state.players
    .filter((target) => target.alive && target.id !== actor.id && predicate(target) && (range === undefined || distanceBetween(state, actor.id, target.id) <= range))
    .sort((a, b) => targetScore(state, actor, b, knowledge) - targetScore(state, actor, a, knowledge) || a.lives - b.lives)[0];

const canPlayEquipment = (actor: Player, card: Card): boolean => {
  if (card.kind === 'WEAPON') return weaponRange(actor) < (CARDINAL_RANGE[card.name] ?? 1);
  if (card.name === 'BARREL') return !actor.equipment.barrel || actor.character.name === 'Jourdonnais';
  if (card.name === 'MUSTANG') return !actor.equipment.mustang || actor.character.name === 'Paul Regret';
  if (card.name === 'SCOPE') return !actor.equipment.scope || actor.character.name === 'Rose Doolan';
  if (card.name === 'DYNAMITE') return !actor.equipment.dynamite;
  return false;
};

export const decideAiCommand = (state: GameState, playerId: string, knowledge: AiKnowledge): GameCommand | null => {
  const actor = state.players.find((player) => player.id === playerId);
  if (!actor?.alive || actor.kind !== 'AI') return null;
  if (state.turn.phase === 'CHARACTER_CHOICE' && state.turn.currentPlayerId === actor.id) {
    const options = state.characterDraft?.optionsByPlayer[actor.id];
    const choice = options ? [...options].sort((a, b) => characterByName(b).lives - characterByName(a).lives)[0] : undefined;
    return choice ? command(state, actor.id, 'CHARACTER_CHOICE', { characterName: choice }) : null;
  }
  if (state.reaction?.targetPlayerId === actor.id) {
    const names = state.reaction.type === 'INDIANS' || state.reaction.type === 'DUEL' ? ['BANG'] : ['MISSED'];
    const count = state.reaction.requiredCards - state.reaction.cardsPlayed;
    const cards = actor.hand.filter((card) => names.includes(card.name) || actor.character.name === 'Calamity Janet' && (card.name === 'BANG' || card.name === 'MISSED')).slice(0, count);
    return command(state, actor.id, 'REACTION', { cardIds: cards.map((card) => card.id) });
  }
  if (state.storeState?.currentPlayerId === actor.id) {
    const value: Partial<Record<Card['name'], number>> = { BEER: 10, MISSED: 9, BANG: 8, WINCHESTER: 7, VOLCANIC: 7, BARREL: 6, SCOPE: 5, MUSTANG: 5, DYNAMITE: 4 };
    const card = [...state.storeState.cards].sort((a, b) => (value[b.name] ?? 2) - (value[a.name] ?? 2))[0];
    return card ? command(state, actor.id, 'STORE_PICK', { cardId: card.id }) : null;
  }
  if (state.turn.currentPlayerId !== actor.id) return null;
  if (state.turn.phase === 'TURN_START') return command(state, actor.id, 'RESOLVE_TURN_START', {});
  if (state.turn.phase === 'DRAW') {
    if (actor.character.name === 'Pedro Ramirez' && state.discard.length > 0) return command(state, actor.id, 'DRAW_CARDS', { firstCardSource: 'DISCARD' });
    if (actor.character.name === 'Kit Carlson') {
      const options = peekCards(state, 3);
      const selected = [...options].sort((a, b) => (drawValue[b.name] ?? 2) - (drawValue[a.name] ?? 2)).slice(0, Math.min(2, options.length)).map((card) => card.id);
      return command(state, actor.id, 'DRAW_CARDS', { drawCardIds: selected });
    }
    if (actor.character.name === 'Jesse Jones') {
      const source = chooseTarget(state, actor, knowledge, undefined, (target) => target.hand.length > 0);
      if (source) return command(state, actor.id, 'DRAW_CARDS', { firstCardSource: 'PLAYER_HAND', sourcePlayerId: source.id });
    }
    return command(state, actor.id, 'DRAW_CARDS', { firstCardSource: 'DECK' });
  }
  if (state.turn.phase === 'DISCARD') {
    const keepValue: Partial<Record<Card['name'], number>> = { MISSED: 10, BEER: 9, BANG: 8, VOLCANIC: 7, WINCHESTER: 7 };
    const currentExcess = Math.max(0, actor.hand.length - actor.lives);
    const discards = [...actor.hand].sort((a, b) => (keepValue[a.name] ?? 3) - (keepValue[b.name] ?? 3)).slice(0, currentExcess);
    return command(state, actor.id, 'DISCARD_CARDS', { cardIds: discards.map((card) => card.id) });
  }
  if (state.turn.phase !== 'PLAY') return null;

  if (actor.character.name === 'Sid Ketchum' && actor.lives < actor.maxLives && actor.hand.length >= 2) {
    const discardIds = [...actor.hand].sort((a, b) => (drawValue[a.name] ?? 2) - (drawValue[b.name] ?? 2)).slice(0, 2).map((card) => card.id);
    return command(state, actor.id, 'USE_CHARACTER_ABILITY', { cardIds: discardIds });
  }
  const beer = actor.hand.find((card) => card.name === 'BEER');
  if (beer && actor.lives < actor.maxLives && state.players.filter((p) => p.alive).length > 2) return command(state, actor.id, 'PLAY_CARD', { cardId: beer.id });
  const drawCard = actor.hand.find((card) => card.name === 'WELLS_FARGO' || card.name === 'STAGECOACH');
  if (drawCard) return command(state, actor.id, 'PLAY_CARD', { cardId: drawCard.id });
  const equipment = [...actor.hand]
    .filter((card) => canPlayEquipment(actor, card))
    .sort((left, right) => weaponValue(right) - weaponValue(left) || (drawValue[right.name] ?? 2) - (drawValue[left.name] ?? 2))[0];
  if (equipment) return command(state, actor.id, 'PLAY_CARD', { cardId: equipment.id });
  const aliveCount = state.players.filter((player) => player.alive).length;
  const canBenefitFromSaloon = state.players.some((player) => player.alive && player.lives < player.maxLives);
  const area = actor.hand.find((card) => {
    if (card.name === 'SALOON') return canBenefitFromSaloon;
    if (card.name === 'GENERAL_STORE') return state.deck.length + state.discard.length > 0;
    if (card.name !== 'GATLING' && card.name !== 'INDIANS') return false;
    return actor.role === 'OUTLAW' || actor.role === 'SHERIFF' || actor.role === 'RENEGADE' && aliveCount === 2;
  });
  if (area) return command(state, actor.id, 'PLAY_CARD', { cardId: area.id });
  const panic = actor.hand.find((card) => card.name === 'PANIC');
  const hasTakeableCard = (target: Player): boolean => target.hand.length > 0 || publicEquipment(target).length > 0;
  const nearTarget = chooseTarget(state, actor, knowledge, 1, hasTakeableCard);
  if (panic && nearTarget) {
    const targetCard = nearTarget.hand.length === 0 ? publicEquipment(nearTarget)[0] : undefined;
    return command(state, actor.id, 'PLAY_CARD', { cardId: panic.id, targetPlayerId: nearTarget.id, ...(targetCard ? { targetCardId: targetCard.id } : {}) });
  }
  const cat = actor.hand.find((card) => card.name === 'CAT_BALOU');
  const anyTarget = chooseTarget(state, actor, knowledge);
  if (cat && anyTarget) {
    const targetCard = publicEquipment(anyTarget)[0];
    if (hasTakeableCard(anyTarget)) return command(state, actor.id, 'PLAY_CARD', { cardId: cat.id, targetPlayerId: anyTarget.id, ...(targetCard ? { targetCardId: targetCard.id } : {}) });
  }
  const duel = actor.hand.find((card) => card.name === 'DUEL');
  if (duel && anyTarget) return command(state, actor.id, 'PLAY_CARD', { cardId: duel.id, targetPlayerId: anyTarget.id });
  const jail = actor.hand.find((card) => card.name === 'JAIL');
  const jailTarget = chooseTarget(state, actor, knowledge, undefined, (target) => target.role !== 'SHERIFF' && !target.equipment.jail);
  if (jail && jailTarget) return command(state, actor.id, 'PLAY_CARD', { cardId: jail.id, targetPlayerId: jailTarget.id });
  const bang = actor.hand.find((card) => card.name === 'BANG' || actor.character.name === 'Calamity Janet' && card.name === 'MISSED');
  const bangTarget = chooseTarget(state, actor, knowledge, undefined, (target) => isInRange(state, actor.id, target.id));
  const unlimitedBang = actor.character.name === 'Willy the Kid' || actor.equipment.weapon?.name === 'VOLCANIC';
  if (bang && bangTarget && (unlimitedBang || actor.bangsPlayedThisTurn === 0)) return command(state, actor.id, 'PLAY_CARD', { cardId: bang.id, targetPlayerId: bangTarget.id });
  return command(state, actor.id, 'END_TURN', {});
};
