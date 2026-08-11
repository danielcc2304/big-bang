import type { Card, GameCommand, GameState, Player } from '../../types';
import { command } from '../engine/commands';
import { characterByName } from '../characters/characters';
import { distanceBetween, isInRange } from '../rules/distance';
import type { AiKnowledge } from './knowledge';

const publicEquipment = (player: Player): readonly Card[] => Object.values(player.equipment).filter((card): card is Card => card !== null);

export const aiDecisionDelay = (state: GameState): number => {
  if (state.turn.phase === 'CHARACTER_CHOICE') return 900;
  if (state.reaction || state.storeState) return 1_100;
  if (state.turn.phase === 'TURN_START' || state.turn.phase === 'DRAW') return 800;
  return 1_450;
};

const targetScore = (state: GameState, actor: Player, target: Player, knowledge: AiKnowledge): number => {
  if (target.role === 'SHERIFF') {
    if (actor.role === 'OUTLAW') return 100;
    if (actor.role === 'RENEGADE') return state.players.filter((player) => player.alive).length === 2 ? 100 : -100;
    return -100;
  }
  const suspicion = knowledge.suspicions[target.id];
  if (actor.role === 'SHERIFF' || actor.role === 'DEPUTY') return (suspicion?.outlaw ?? 0.3) * 10;
  return actor.role === 'RENEGADE' ? 10 + target.lives + (suspicion?.outlaw ?? 0) * 10 : 1;
};

const chooseTarget = (state: GameState, actor: Player, knowledge: AiKnowledge, range?: number, predicate: (target: Player) => boolean = () => true): Player | undefined =>
  state.players
    .filter((target) => target.alive && target.id !== actor.id && predicate(target) && (range === undefined || distanceBetween(state, actor.id, target.id) <= range))
    .sort((a, b) => targetScore(state, actor, b, knowledge) - targetScore(state, actor, a, knowledge) || a.lives - b.lives)[0];

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
    const value: Partial<Record<Card['name'], number>> = { BEER: 10, MISSED: 9, BANG: 8, WINCHESTER: 7, VOLCANIC: 7, BARREL: 6 };
    const card = [...state.storeState.cards].sort((a, b) => (value[b.name] ?? 2) - (value[a.name] ?? 2))[0];
    return card ? command(state, actor.id, 'STORE_PICK', { cardId: card.id }) : null;
  }
  if (state.turn.currentPlayerId !== actor.id) return null;
  if (state.turn.phase === 'TURN_START') return command(state, actor.id, 'RESOLVE_TURN_START', {});
  if (state.turn.phase === 'DRAW') return command(state, actor.id, 'DRAW_CARDS', { firstCardSource: actor.character.name === 'Pedro Ramirez' && state.discard.length > 0 ? 'DISCARD' : 'DECK' });
  if (state.turn.phase === 'DISCARD') {
    const keepValue: Partial<Record<Card['name'], number>> = { MISSED: 10, BEER: 9, BANG: 8, VOLCANIC: 7, WINCHESTER: 7 };
    const discards = [...actor.hand].sort((a, b) => (keepValue[a.name] ?? 3) - (keepValue[b.name] ?? 3)).slice(0, state.turn.pendingDiscardCount);
    return command(state, actor.id, 'DISCARD_CARDS', { cardIds: discards.map((card) => card.id) });
  }
  if (state.turn.phase !== 'PLAY') return null;

  const beer = actor.hand.find((card) => card.name === 'BEER');
  if (beer && actor.lives < actor.maxLives && state.players.filter((p) => p.alive).length > 2) return command(state, actor.id, 'PLAY_CARD', { cardId: beer.id });
  const drawCard = actor.hand.find((card) => card.name === 'WELLS_FARGO' || card.name === 'STAGECOACH');
  if (drawCard) return command(state, actor.id, 'PLAY_CARD', { cardId: drawCard.id });
  const equipment = actor.hand.find((card) => card.kind === 'WEAPON' || ['BARREL', 'MUSTANG', 'SCOPE', 'DYNAMITE'].includes(card.name));
  if (equipment) return command(state, actor.id, 'PLAY_CARD', { cardId: equipment.id });
  const aliveCount = state.players.filter((player) => player.alive).length;
  const area = actor.hand.find((card) => {
    if (card.name === 'SALOON' || card.name === 'GENERAL_STORE') return true;
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
  if (jail && anyTarget && anyTarget.role !== 'SHERIFF' && !anyTarget.equipment.jail) return command(state, actor.id, 'PLAY_CARD', { cardId: jail.id, targetPlayerId: anyTarget.id });
  const bang = actor.hand.find((card) => card.name === 'BANG' || actor.character.name === 'Calamity Janet' && card.name === 'MISSED');
  const bangTarget = chooseTarget(state, actor, knowledge);
  const unlimitedBang = actor.character.name === 'Willy the Kid' || actor.equipment.weapon?.name === 'VOLCANIC';
  if (bang && bangTarget && (unlimitedBang || actor.bangsPlayedThisTurn === 0) && isInRange(state, actor.id, bangTarget.id)) return command(state, actor.id, 'PLAY_CARD', { cardId: bang.id, targetPlayerId: bangTarget.id });
  return command(state, actor.id, 'END_TURN', {});
};
