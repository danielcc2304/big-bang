import type { Card, CardName, CommandFailure, CommandResult, GameCommand, GameLogEntry, GameState, Player, Reaction } from '../../types';
import { CARD_CATALOG } from '../cards/catalog';
import { characterByName } from '../characters/characters';
import { distanceBetween, isInRange } from '../rules/distance';
import { seededRandom } from '../../utils/random';
import { assertGameState } from './invariants';
import { isGameCommand } from './commands';
import {
  damagePlayer, discardFromHand, drawCards, healPlayer, nextLivingPlayerId, peekCards, playerById, refillSuzyIfNeeded, replacePlayer,
} from './helpers';

const fail = (state: GameState, code: string, message: string): CommandFailure => ({ ok: false, state, error: { code, message } });
const isRed = (card: Card): boolean => card.suit === 'HEARTS' || card.suit === 'DIAMONDS';
const hasAllCards = (player: Player, ids: readonly string[]): boolean => ids.every((id) => player.hand.some((card) => card.id === id)) && new Set(ids).size === ids.length;

const SUIT_LABEL: Record<Card['suit'], string> = { SPADES: 'picas', HEARTS: 'corazones', DIAMONDS: 'diamantes', CLUBS: 'tréboles' };
const cardResult = (card: Card): string => `${CARD_CATALOG[card.name].label} (${card.rank} de ${SUIT_LABEL[card.suit]})`;

const drawJudgement = (state: GameState, player: Player, success: (card: Card) => boolean): { readonly state: GameState; readonly card: Card | undefined; readonly lucky: boolean; readonly revealed: readonly Card[] } => {
  const lucky = player.character.name === 'Lucky Duke';
  const draw = drawCards(state, lucky ? 2 : 1);
  const chosen = draw.cards.find(success) ?? draw.cards[0];
  return {
    state: { ...draw.state, discard: [...draw.state.discard, ...draw.cards] },
    card: chosen,
    lucky,
    revealed: draw.cards,
  };
};

const log = (state: GameState, message: string, tone: 'NORMAL' | 'ACTION' | 'DANGER' | 'SYSTEM' = 'NORMAL', effect?: GameLogEntry['effect']): GameState => {
  const revision = state.revision + 1;
  const sequence = state.logs.filter((entry) => entry.revision === revision).length;
  return {
    ...state,
    logs: [...state.logs.slice(-79), { id: `log-${revision}-${sequence}`, revision, message, tone, ...(effect ? { effect } : {}) }],
  };
};

const equipField = (name: CardName): 'weapon' | 'barrel' | 'mustang' | 'scope' | 'jail' | 'dynamite' | null => {
  if (CARD_CATALOG[name].kind === 'WEAPON') return 'weapon';
  return ({ BARREL: 'barrel', MUSTANG: 'mustang', SCOPE: 'scope', JAIL: 'jail', DYNAMITE: 'dynamite' } as const)[name as 'BARREL'] ?? null;
};

const removePlayedCard = (state: GameState, player: Player, card: Card, discard = true): GameState => {
  const next = replacePlayer(state, { ...player, hand: player.hand.filter((candidate) => candidate.id !== card.id) });
  const withDiscard = discard ? { ...next, discard: [...next.discard, card] } : next;
  return refillSuzyIfNeeded(withDiscard, player.id);
};

const createReaction = (state: GameState, type: Reaction['type'], sourceId: string, targetId: string, requiredCards: number, createdAt: number): GameState => ({
  ...state,
  reaction: { id: `reaction-${state.revision + 1}-${targetId}`, type, sourcePlayerId: sourceId, targetPlayerId: targetId, requiredCards, cardsPlayed: 0, createdAt },
  turn: { ...state.turn, phase: 'WAITING_REACTION' },
});

const barrelCheck = (state: GameState, target: Player, requiredSuccesses: number): { readonly state: GameState; readonly successes: number } => {
  const checks = (target.equipment.barrel ? 1 : 0) + (target.character.name === 'Jourdonnais' ? 1 : 0);
  let next = state;
  let successes = 0;
  for (let index = 0; index < checks && successes < requiredSuccesses; index += 1) {
    const draw = drawJudgement(next, target, (card) => card.suit === 'HEARTS');
    const card = draw.card;
    next = draw.state;
    if (card) {
      const success = card.suit === 'HEARTS';
      if (success) successes += 1;
      const source = index === 0 && target.equipment.barrel ? 'el Barril' : 'la habilidad de Jourdonnais';
      const revealed = draw.lucky ? ` revela ${draw.revealed.map(cardResult).join(' y ')} y elige ${cardResult(card)}` : ` desenfunda ${cardResult(card)}`;
      next = log(next, `${target.name}${revealed} con ${source}: ${success ? 'evita un impacto de BANG!' : 'no consigue protegerse'}.`, success ? 'ACTION' : 'DANGER', {
        kind: 'JUDGEMENT', playerId: target.id, card, success, headline: success ? '¡SE SALVA!' : 'EL BARRIL FALLA',
      });
    }
  }
  return { state: next, successes };
};

const beginMultiReaction = (state: GameState, createdAt: number): GameState => {
  const action = state.multiAction;
  if (!action) return { ...state, turn: { ...state.turn, phase: 'PLAY' } };
  const targetId = action.targets[action.currentTargetIndex];
  if (!targetId) return { ...state, multiAction: null, reaction: null, turn: { ...state.turn, phase: 'PLAY' } };
  return createReaction(state, action.type, action.sourcePlayerId, targetId, 1, createdAt);
};

const advanceMulti = (state: GameState, createdAt: number): GameState => {
  const action = state.multiAction;
  if (!action) return { ...state, reaction: null, turn: { ...state.turn, phase: 'PLAY' } };
  const nextIndex = action.currentTargetIndex + 1;
  if (nextIndex >= action.targets.length) return { ...state, reaction: null, multiAction: null, turn: { ...state.turn, phase: 'PLAY' } };
  return beginMultiReaction({ ...state, reaction: null, multiAction: { ...action, currentTargetIndex: nextIndex } }, createdAt);
};

const resolveReaction = (state: GameState, command: Extract<GameCommand, { type: 'REACTION' }>): CommandResult => {
  const reaction = state.reaction;
  if (!reaction) return fail(state, 'NO_REACTION', 'No hay una reacción pendiente.');
  if (reaction.targetPlayerId !== command.playerId) return fail(state, 'NOT_YOUR_REACTION', 'La reacción pertenece a otro jugador.');
  const player = playerById(state, command.playerId)!;
  const cardIds = command.payload?.cardIds ?? [];
  if (command.payload?.takeDamage && cardIds.length > 0) return fail(state, 'INVALID_REACTION', 'No puedes responder y recibir daño a la vez.');
  const cards = player.hand.filter((card) => cardIds.includes(card.id));
  if (!hasAllCards(player, cardIds)) return fail(state, 'CARD_NOT_OWNED', 'Alguna carta ya no está en tu mano.');
  const accepted = reaction.type === 'INDIANS' || reaction.type === 'DUEL' ? ['BANG'] : ['MISSED'];
  const valid = cards.every((card) => accepted.includes(card.name) || player.character.name === 'Calamity Janet' && (card.name === 'BANG' || card.name === 'MISSED'));
  if (!valid) return fail(state, 'INVALID_REACTION', 'Esas cartas no resuelven esta reacción.');

  let next = discardFromHand(state, player.id, cards.map((card) => card.id));
  const total = reaction.cardsPlayed + cards.length;
  if (cards.length > 0) {
    const labels = cards.map((card) => CARD_CATALOG[card.name].label).join(' + ');
    const purpose = reaction.type === 'DUEL' ? 'mantiene el Duelo' : reaction.type === 'INDIANS' ? 'rechaza el ataque de los Indios' : reaction.type === 'GATLING' ? 'esquiva la Gatling' : 'esquiva el BANG!';
    next = log(next, `${player.name} juega ${labels} y ${purpose}${total < reaction.requiredCards ? `; aún necesita ${reaction.requiredCards - total}` : ''}.`, 'ACTION', {
      kind: 'REACTION', playerId: player.id, card: cards[0]!, success: total >= reaction.requiredCards, headline: CARD_CATALOG[cards[0]!.name].label.toUpperCase(),
    });
  }
  if (cards.length > 0 && total < reaction.requiredCards) return { ok: true, state: { ...next, reaction: { ...reaction, cardsPlayed: total } } };
  if (cards.length === 0 || total < reaction.requiredCards) {
    next = damagePlayer(next, player.id, 1, reaction.sourcePlayerId);
    const cause = reaction.type === 'DUEL' ? 'se queda sin BANG! en el Duelo' : reaction.type === 'INDIANS' ? 'no responde con BANG! a los Indios' : reaction.type === 'GATLING' ? 'no juega ¡Fallaste! contra la Gatling' : 'no juega ¡Fallaste! contra el BANG!';
    next = log(next, `${player.name} ${cause} y pierde 1 vida.`, 'DANGER');
  }
  if (next.winner) return { ok: true, state: { ...next, reaction: null, multiAction: null, storeState: null, turn: { ...next.turn, phase: 'GAME_OVER' } } };
  if (reaction.type === 'DUEL' && cards.length > 0 && total >= reaction.requiredCards) {
    next = createReaction({ ...next, reaction: null }, 'DUEL', player.id, reaction.sourcePlayerId, 1, command.createdAt);
  } else if (reaction.type === 'GATLING' || reaction.type === 'INDIANS') {
    next = advanceMulti({ ...next, reaction: null }, command.createdAt);
  } else {
    next = { ...next, reaction: null, turn: { ...next.turn, phase: 'PLAY' } };
  }
  return { ok: true, state: next };
};

const resolveTurnStart = (state: GameState, player: Player): GameState => {
  let next = state;
  let current = playerById(next, player.id)!;
  if (current.equipment.dynamite) {
    const dynamite = current.equipment.dynamite;
    const draw = drawJudgement(next, current, (card) => !(card.suit === 'SPADES' && Number(card.rank) >= 2 && Number(card.rank) <= 9));
    const judgement = draw.card;
    let dynamiteRecipient: Player | undefined;
    next = draw.state;
    current = playerById(next, player.id)!;
    next = replacePlayer(next, { ...current, equipment: { ...current.equipment, dynamite: null } });
    const exploded = judgement?.suit === 'SPADES' && Number(judgement.rank) >= 2 && Number(judgement.rank) <= 9;
    if (exploded) {
      next = { ...next, discard: [...next.discard, dynamite] };
      next = damagePlayer(next, player.id, 3, null);
    } else {
      const recipientId = nextLivingPlayerId(next, player.id);
      const recipient = playerById(next, recipientId);
      if (recipient?.alive && !recipient.equipment.dynamite) {
        dynamiteRecipient = recipient;
        next = replacePlayer(next, { ...recipient, equipment: { ...recipient.equipment, dynamite } });
      }
      else next = { ...next, discard: [...next.discard, dynamite] };
    }
    if (judgement) {
      const revealed = draw.lucky ? ` revela ${draw.revealed.map(cardResult).join(' y ')} y elige ${cardResult(judgement)}` : ` desenfunda ${cardResult(judgement)}`;
      next = log(next, `${player.name}${revealed} por la Dinamita: ${exploded ? '¡explota y pierde 3 vidas!' : `se salva${dynamiteRecipient ? ` y la Dinamita pasa a ${dynamiteRecipient.name}` : '; la Dinamita se descarta porque no puede pasar'}`}.`, exploded ? 'DANGER' : 'ACTION', {
        kind: 'JUDGEMENT', playerId: player.id, card: judgement, success: !exploded, headline: exploded ? '¡BOOM!' : 'PASA DE LARGO',
      });
    }
  }
  current = playerById(next, player.id)!;
  if (next.winner) return next;
  if (!current.alive) {
    const nextId = nextLivingPlayerId(next, player.id);
    return { ...next, turn: { number: next.turn.number + 1, currentPlayerId: nextId, phase: 'TURN_START', pendingDiscardCount: 0 } };
  }
  if (current.equipment.jail) {
    const jail = current.equipment.jail;
    const draw = drawJudgement(next, current, (card) => card.suit === 'HEARTS');
    const judgement = draw.card;
    next = { ...draw.state, discard: [...draw.state.discard, jail] };
    current = playerById(next, player.id)!;
    next = replacePlayer(next, { ...current, equipment: { ...current.equipment, jail: null } });
    const escaped = judgement?.suit === 'HEARTS';
    if (judgement) {
      const revealed = draw.lucky ? ` revela ${draw.revealed.map(cardResult).join(' y ')} y elige ${cardResult(judgement)}` : ` desenfunda ${cardResult(judgement)}`;
      next = log(next, `${player.name}${revealed} en Prisión: ${escaped ? 'sale libre y juega su turno' : 'permanece encerrado y pierde el turno'}.`, escaped ? 'ACTION' : 'DANGER', {
      kind: 'JUDGEMENT', playerId: player.id, card: judgement, success: escaped, headline: escaped ? '¡LIBRE!' : 'PIERDE EL TURNO',
      });
    }
    if (!escaped) {
      const nextId = nextLivingPlayerId(next, player.id);
      return { ...next, turn: { number: next.turn.number + 1, currentPlayerId: nextId, phase: 'TURN_START', pendingDiscardCount: 0 } };
    }
  }
  return { ...next, turn: { ...next.turn, phase: 'DRAW' } };
};

const takeTargetCard = (state: GameState, source: Player, target: Player, cardId: string | undefined, randomHand: boolean, discard: boolean): CommandResult => {
  const equipmentEntries = Object.entries(target.equipment) as [keyof Player['equipment'], Card | null][];
  const equipmentMatch = cardId ? equipmentEntries.find(([, card]) => card?.id === cardId) : undefined;
  if (cardId && !equipmentMatch) return fail(state, 'INVALID_TARGET_CARD', 'Solo puedes elegir una carta pÃºblica del rival.');
  const random = seededRandom(state.seed ^ Math.imul(state.revision + 1, 0x9E3779B1) ^ Math.imul(source.seat + 1, 31) ^ target.seat);
  const handMatch = !cardId && (randomHand || target.hand.length > 0) ? target.hand[Math.floor(random.next() * target.hand.length)] : undefined;
  const card = equipmentMatch?.[1] ?? handMatch;
  if (!card) return fail(state, 'NO_TARGET_CARD', 'El objetivo no tiene esa carta.');
  let updatedTarget = target;
  if (equipmentMatch) updatedTarget = { ...target, equipment: { ...target.equipment, [equipmentMatch[0]]: null } };
  else updatedTarget = { ...target, hand: target.hand.filter((candidate) => candidate.id !== card.id) };
  let next = refillSuzyIfNeeded(replacePlayer(state, updatedTarget), target.id);
  if (discard) next = { ...next, discard: [...next.discard, card] };
  else next = replacePlayer(next, { ...source, hand: [...source.hand, card] });
  return { ok: true, state: next };
};

const playCard = (state: GameState, command: Extract<GameCommand, { type: 'PLAY_CARD' }>): CommandResult => {
  const player = playerById(state, command.playerId)!;
  if (state.turn.currentPlayerId !== player.id || state.turn.phase !== 'PLAY') return fail(state, 'NOT_PLAY_PHASE', 'No puedes jugar cartas ahora.');
  const card = player.hand.find((candidate) => candidate.id === command.payload.cardId);
  if (!card) return fail(state, 'CARD_NOT_OWNED', 'La carta ya no está en tu mano.');
  const target = command.payload.targetPlayerId ? playerById(state, command.payload.targetPlayerId) : undefined;

  if (card.name === 'BANG' || card.name === 'MISSED' && player.character.name === 'Calamity Janet') {
    if (!target?.alive || target.id === player.id) return fail(state, 'INVALID_TARGET', 'Elige otro jugador vivo.');
    const unlimited = player.character.name === 'Willy the Kid' || player.equipment.weapon?.name === 'VOLCANIC';
    if (!unlimited && player.bangsPlayedThisTurn >= 1) return fail(state, 'BANG_LIMIT', 'Solo puedes jugar un BANG! por turno.');
    if (!isInRange(state, player.id, target.id)) return fail(state, 'OUT_OF_RANGE', 'El objetivo está fuera de alcance.');
    let next = removePlayedCard(state, player, card);
    const updated = playerById(next, player.id)!;
    next = replacePlayer(next, { ...updated, bangsPlayedThisTurn: updated.bangsPlayedThisTurn + 1 });
    const requiredSuccesses = player.character.name === 'Slab the Killer' ? 2 : 1;
    const check = barrelCheck(next, target, requiredSuccesses);
    const required = requiredSuccesses - check.successes;
    next = required <= 0 ? check.state : createReaction(check.state, 'BANG', player.id, target.id, required, command.createdAt);
    return { ok: true, state: log(next, `${player.name} juega BANG! contra ${target.name}.`, 'ACTION') };
  }

  if (card.name === 'BEER') {
    if (player.lives >= player.maxLives || state.players.filter((p) => p.alive).length <= 2) return fail(state, 'BEER_NOT_USEFUL', 'No puedes usar Cerveza ahora.');
    return { ok: true, state: log(healPlayer(removePlayedCard(state, player, card), player.id, 1), `${player.name} recupera una vida.`) };
  }
  if (card.name === 'SALOON') {
    let next = removePlayedCard(state, player, card);
    next.players.filter((p) => p.alive).forEach((p) => { next = healPlayer(next, p.id, 1); });
    return { ok: true, state: log(next, `${player.name} invita a todos al Saloon.`, 'ACTION') };
  }
  if (card.name === 'STAGECOACH' || card.name === 'WELLS_FARGO') {
    let next = removePlayedCard(state, player, card);
    const draw = drawCards(next, card.name === 'STAGECOACH' ? 2 : 3);
    const updated = playerById(draw.state, player.id)!;
    next = replacePlayer(draw.state, { ...updated, hand: [...updated.hand, ...draw.cards] });
    return { ok: true, state: log(next, `${player.name} roba ${draw.cards.length} cartas.`) };
  }
  if (card.name === 'PANIC' || card.name === 'CAT_BALOU') {
    if (!target?.alive || target.id === player.id) return fail(state, 'INVALID_TARGET', 'Elige otro jugador.');
    if (card.name === 'PANIC' && distanceBetween(state, player.id, target.id) > 1) return fail(state, 'OUT_OF_RANGE', 'Pánico solo alcanza distancia 1.');
    const targetCardId = command.payload.targetCardId;
    const publicTarget = targetCardId && (Object.values(target.equipment) as readonly (Card | null)[]).some((candidate) => candidate?.id === targetCardId);
    if (targetCardId && !publicTarget) return fail(state, 'INVALID_TARGET_CARD', 'Solo puedes elegir una carta pública del rival.');
    if (!targetCardId && target.hand.length === 0) return fail(state, 'NO_TARGET_CARD', 'El objetivo no tiene cartas en la mano.');
    const withoutAction = removePlayedCard(state, player, card);
    const result = takeTargetCard(withoutAction, playerById(withoutAction, player.id)!, playerById(withoutAction, target.id)!, command.payload.targetCardId, command.payload.targetCardChoice === 'RANDOM_HAND', card.name === 'CAT_BALOU');
    return result.ok ? { ok: true, state: log(result.state, `${player.name} usa ${CARD_CATALOG[card.name].label} sobre ${target.name}.`, 'ACTION') } : result;
  }
  if (card.name === 'DUEL') {
    if (!target?.alive || target.id === player.id) return fail(state, 'INVALID_TARGET', 'Elige otro jugador vivo.');
    const next = createReaction(removePlayedCard(state, player, card), 'DUEL', player.id, target.id, 1, command.createdAt);
    return { ok: true, state: log(next, `${player.name} reta a ${target.name} a un duelo.`, 'ACTION') };
  }
  if (card.name === 'GATLING' || card.name === 'INDIANS') {
    const targets = state.players.filter((p) => p.alive && p.id !== player.id).sort((a, b) => a.seat - b.seat).map((p) => p.id);
    let next = removePlayedCard(state, player, card);
    next = { ...next, multiAction: { id: `multi-${state.revision + 1}`, type: card.name, sourcePlayerId: player.id, targets, currentTargetIndex: 0 }, turn: { ...next.turn, phase: 'MULTI_ACTION' } };
    next = beginMultiReaction(next, command.createdAt);
    return { ok: true, state: log(next, `${player.name} juega ${CARD_CATALOG[card.name].label}.`, 'ACTION') };
  }
  if (card.name === 'GENERAL_STORE') {
    const alive = state.players.filter((p) => p.alive).sort((a, b) => a.seat - b.seat);
    const startIndex = alive.findIndex((p) => p.id === player.id);
    const order = [...alive.slice(startIndex), ...alive.slice(0, startIndex)].map((p) => p.id);
    let next = removePlayedCard(state, player, card);
    const draw = drawCards(next, alive.length);
    if (draw.cards.length === 0) return { ok: true, state: log({ ...draw.state, turn: { ...draw.state.turn, phase: 'PLAY' } }, `${player.name} abre el Almacén, pero no quedan cartas para repartir.`, 'ACTION') };
    const storeOrder = order.slice(0, draw.cards.length);
    next = { ...draw.state, storeState: { id: `store-${state.revision + 1}`, cards: draw.cards, order: storeOrder, currentIndex: 0, currentPlayerId: storeOrder[0]!, pickedBy: {} }, turn: { ...draw.state.turn, phase: 'STORE' } };
    return { ok: true, state: log(next, `${player.name} abre el Almacén.`, 'ACTION') };
  }

  const field = equipField(card.name);
  if (field) {
    const owner = field === 'jail' ? target : player;
    if (!owner?.alive) return fail(state, 'INVALID_TARGET', 'Elige un objetivo válido.');
    if (field === 'jail' && (owner.id === player.id || owner.role === 'SHERIFF')) return fail(state, 'INVALID_JAIL_TARGET', 'Prisión no puede jugarse sobre ti ni sobre el Sheriff.');
    if (field === 'dynamite' && owner.equipment.dynamite) return fail(state, 'ALREADY_EQUIPPED', 'Ya tienes una Dinamita.');
    const previous = owner.equipment[field];
    let next = removePlayedCard(state, player, card, false);
    const currentOwner = playerById(next, owner.id)!;
    next = replacePlayer(next, { ...currentOwner, equipment: { ...currentOwner.equipment, [field]: card } });
    if (previous) next = { ...next, discard: [...next.discard, previous] };
    return { ok: true, state: log(next, `${player.name} pone en juego ${CARD_CATALOG[card.name].label}.`) };
  }
  return fail(state, 'UNSUPPORTED_CARD', 'Esta carta no puede jugarse en este momento.');
};

const handleCommand = (state: GameState, command: GameCommand): CommandResult => {
  const player = playerById(state, command.playerId);
  if (!player) return fail(state, 'UNKNOWN_PLAYER', 'El jugador no existe.');
  if (!player.alive && command.type !== 'CHARACTER_CHOICE') return fail(state, 'PLAYER_DEAD', 'Un jugador eliminado no puede actuar.');

  switch (command.type) {
    case 'PLAY_CARD': return playCard(state, command);
    case 'RESOLVE_TURN_START':
      if (state.turn.currentPlayerId !== player.id || state.turn.phase !== 'TURN_START') return fail(state, 'NOT_TURN_START', 'No hay inicio de turno que resolver.');
      return { ok: true, state: resolveTurnStart(state, player) };
    case 'DRAW_CARDS': {
      if (state.turn.currentPlayerId !== player.id || state.turn.phase !== 'DRAW') return fail(state, 'NOT_DRAW_PHASE', 'No puedes robar ahora.');
      const firstCardSource = command.payload.firstCardSource ?? 'DECK';
      const drawCardIds = command.payload.drawCardIds ?? [];
      if (!['DECK', 'DISCARD', 'PLAYER_HAND'].includes(firstCardSource)) return fail(state, 'INVALID_DRAW_SOURCE', 'La procedencia del robo no es válida.');
      if (firstCardSource === 'DISCARD' && player.character.name !== 'Pedro Ramirez') return fail(state, 'ABILITY_NOT_AVAILABLE', 'Solo Pedro Ramírez puede robar del descarte.');
      if (firstCardSource === 'DISCARD' && state.discard.length === 0) return fail(state, 'EMPTY_DISCARD', 'No hay ninguna carta en el descarte.');
      if (firstCardSource === 'PLAYER_HAND' && player.character.name !== 'Jesse Jones') return fail(state, 'ABILITY_NOT_AVAILABLE', 'Solo Jesse Jones puede robar de la mano de otro jugador.');
      if (firstCardSource === 'PLAYER_HAND' && !command.payload.sourcePlayerId) return fail(state, 'DRAW_SOURCE_REQUIRED', 'Jesse debe elegir a un jugador del que robar.');
      if (player.character.name === 'Kit Carlson' && firstCardSource !== 'DECK') return fail(state, 'INVALID_DRAW_SOURCE', 'Kit Carlson solo puede ordenar las cartas del mazo.');
      if (player.character.name !== 'Kit Carlson' && drawCardIds.length > 0) return fail(state, 'ABILITY_NOT_AVAILABLE', 'La elección de cartas solo está disponible para Kit Carlson.');

      if (player.character.name === 'Kit Carlson') {
        const revealed = peekCards(state, 3);
        const selected = revealed.filter((card) => drawCardIds.includes(card.id));
        const required = Math.min(2, revealed.length);
        if (required === 0) return fail(state, 'EMPTY_DECK', 'No hay cartas para robar.');
        if (drawCardIds.length !== required || selected.length !== required) return fail(state, 'KIT_CHOICE_REQUIRED', `Kit Carlson debe elegir ${required} cartas entre las ${revealed.length} reveladas.`);
        const draw = drawCards(state, revealed.length);
        const returned = draw.cards.filter((card) => !drawCardIds.includes(card.id));
        const ordered = [...selected, ...draw.cards.filter((card) => drawCardIds.includes(card.id) && !selected.some((chosen) => chosen.id === card.id))];
        const current = playerById(draw.state, player.id)!;
        const next = replacePlayer({ ...draw.state, deck: [...returned, ...draw.state.deck] }, { ...current, hand: [...current.hand, ...ordered] });
        return { ok: true, state: log({ ...next, turn: { ...next.turn, phase: 'PLAY' } }, `${player.name} mira ${revealed.length} cartas, elige ${ordered.length} y devuelve ${revealed.length - ordered.length} al mazo.`, 'ACTION') };
      }

      const discardedCard = firstCardSource === 'DISCARD' ? state.discard.at(-1) : undefined;
      let draw = firstCardSource === 'DISCARD'
        ? (() => {
            const withoutDiscard = { ...state, discard: state.discard.slice(0, -1) };
            const second = drawCards(withoutDiscard, 1);
            return { state: second.state, cards: [discardedCard!, ...second.cards] };
          })()
        : firstCardSource === 'PLAYER_HAND'
          ? (() => {
              const source = state.players.find((candidate) => candidate.id === command.payload.sourcePlayerId && candidate.id !== player.id && candidate.alive);
              if (!source || source.hand.length === 0) return { state, cards: [] as readonly Card[] };
              const random = seededRandom(state.seed ^ Math.imul(state.revision + 1, 0x9E3779B1) ^ source.seat);
              const card = source.hand[Math.floor(random.next() * source.hand.length)];
              if (!card) return { state, cards: [] as readonly Card[] };
              const withoutCard = refillSuzyIfNeeded(replacePlayer(state, { ...source, hand: source.hand.filter((candidate) => candidate.id !== card.id) }), source.id);
              const second = drawCards(withoutCard, 1);
              return { state: second.state, cards: [card, ...second.cards] };
            })()
          : drawCards(state, 2);
      if (firstCardSource === 'PLAYER_HAND' && draw.cards.length === 0) return fail(state, 'INVALID_DRAW_SOURCE', 'Ese jugador no tiene cartas que Jesse pueda robar.');
      let count = draw.cards.length;
      const blackJackReveal = player.character.name === 'Black Jack' ? draw.cards[1] : undefined;
      if (blackJackReveal && isRed(blackJackReveal)) {
        const bonus = drawCards(draw.state, 1);
        draw = { state: bonus.state, cards: [...draw.cards, ...bonus.cards] };
        count = draw.cards.length;
      }
      const current = playerById(draw.state, player.id)!;
      const next = replacePlayer(draw.state, { ...current, hand: [...current.hand, ...draw.cards] });
      const message = firstCardSource === 'DISCARD'
        ? `${player.name} roba la última carta del descarte y ${Math.max(0, count - 1)} del mazo.`
        : firstCardSource === 'PLAYER_HAND'
          ? `${player.name} roba una carta de la mano de ${state.players.find((candidate) => candidate.id === command.payload.sourcePlayerId)?.name ?? 'otro jugador'} y ${Math.max(0, count - 1)} del mazo.`
        : `${player.name} roba ${count} cartas.`;
      let logged = log({ ...next, turn: { ...next.turn, phase: 'PLAY' } }, message);
      if (blackJackReveal) {
        const bonus = isRed(blackJackReveal);
        logged = log(logged, `Black Jack muestra ${cardResult(blackJackReveal)}: ${bonus ? 'es roja y roba una carta extra' : 'no es roja y no recibe carta extra'}.`, bonus ? 'ACTION' : 'NORMAL', {
          kind: 'JUDGEMENT', playerId: player.id, card: blackJackReveal, success: bonus, headline: bonus ? 'CARTA EXTRA' : 'SIN BONIFICACIÓN',
        });
      }
      return { ok: true, state: logged };
    }
    case 'END_TURN': {
      if (state.turn.currentPlayerId !== player.id || state.turn.phase !== 'PLAY') return fail(state, 'NOT_YOUR_TURN', 'No puedes terminar el turno ahora.');
      const excess = Math.max(0, player.hand.length - player.lives);
      if (excess > 0) return { ok: true, state: { ...state, turn: { ...state.turn, phase: 'DISCARD', pendingDiscardCount: excess } } };
      const nextId = nextLivingPlayerId(state, player.id);
      return { ok: true, state: { ...state, turn: { number: state.turn.number + 1, currentPlayerId: nextId, phase: 'TURN_START', pendingDiscardCount: 0 }, players: state.players.map((p) => p.id === nextId ? { ...p, bangsPlayedThisTurn: 0 } : p) } };
    }
    case 'DISCARD_CARDS': {
      if (state.turn.currentPlayerId !== player.id || state.turn.phase !== 'DISCARD') return fail(state, 'NOT_DISCARD_PHASE', 'No hay descarte pendiente.');
      const currentExcess = Math.max(0, player.hand.length - player.lives);
      if (command.payload.cardIds.length !== currentExcess || !hasAllCards(player, command.payload.cardIds)) return fail(state, 'WRONG_DISCARD_COUNT', `Descarta exactamente ${currentExcess} cartas.`);
      let discarded = discardFromHand(state, player.id, command.payload.cardIds);
      const remaining = playerById(discarded, player.id)!;
      if (remaining.hand.length > remaining.lives) return fail(state, 'HAND_LIMIT_NOT_MET', 'La mano todavía supera el límite de vidas.');
      discarded = log(discarded, `${player.name} descarta ${command.payload.cardIds.length} carta(s) y termina con ${remaining.hand.length}, su límite actual de mano.`, 'NORMAL');
      const nextId = nextLivingPlayerId(discarded, player.id);
      return { ok: true, state: { ...discarded, turn: { number: state.turn.number + 1, currentPlayerId: nextId, phase: 'TURN_START', pendingDiscardCount: 0 }, players: discarded.players.map((p) => p.id === nextId ? { ...p, bangsPlayedThisTurn: 0 } : p) } };
    }
    case 'REACTION': return resolveReaction(state, command);
    case 'STORE_PICK': {
      const store = state.storeState;
      if (!store || state.turn.phase !== 'STORE') return fail(state, 'NO_STORE', 'El Almacén no está activo.');
      if (store.pickedBy[player.id]) return fail(state, 'ALREADY_PICKED', 'Ya elegiste una carta de este Almacén.');
      if (store.currentPlayerId !== player.id) return fail(state, 'NOT_STORE_TURN', 'Ahora elige otro jugador.');
      const card = store.cards.find((candidate) => candidate.id === command.payload.cardId);
      if (!card) return fail(state, 'CARD_TAKEN', 'Esa carta ya no está disponible.');
      const updated = { ...player, hand: [...player.hand, card] };
      let next = replacePlayer(state, updated);
      const nextIndex = store.currentIndex + 1;
      const done = nextIndex >= store.order.length;
      next = { ...next, storeState: done ? null : { ...store, cards: store.cards.filter((candidate) => candidate.id !== card.id), currentIndex: nextIndex, currentPlayerId: store.order[nextIndex]!, pickedBy: { ...store.pickedBy, [player.id]: card.id } }, turn: { ...next.turn, phase: done ? 'PLAY' : 'STORE' } };
      return { ok: true, state: log(next, `${player.name} elige ${CARD_CATALOG[card.name].label} del Almacén.`) };
    }
    case 'USE_CHARACTER_ABILITY': {
      if (state.turn.currentPlayerId !== player.id || state.turn.phase !== 'PLAY' || state.reaction || state.storeState) return fail(state, 'NOT_PLAY_PHASE', 'No puedes usar la habilidad ahora.');
      if (player.character.name !== 'Sid Ketchum') return fail(state, 'ABILITY_NOT_ACTIVE', 'Este personaje no tiene una habilidad activa.');
      const ids = command.payload.cardIds ?? [];
      if (ids.length !== 2 || !hasAllCards(player, ids) || player.lives >= player.maxLives) return fail(state, 'INVALID_ABILITY', 'Descarta dos cartas para recuperar una vida.');
      return { ok: true, state: healPlayer(discardFromHand(state, player.id, ids), player.id, 1) };
    }
    case 'CHARACTER_CHOICE': {
      if (state.turn.phase !== 'CHARACTER_CHOICE') return fail(state, 'NOT_CHARACTER_CHOICE', 'La elección de personaje ya terminó.');
      const draft = state.characterDraft;
      if (!draft) return fail(state, 'NO_CHARACTER_DRAFT', 'No hay una selección de personajes activa.');
      if (draft.chosenByPlayer[player.id]) return fail(state, 'CHARACTER_ALREADY_CHOSEN', 'Ya elegiste personaje.');
      const options = draft.optionsByPlayer[player.id];
      if (!options?.includes(command.payload.characterName)) return fail(state, 'CHARACTER_NOT_OFFERED', 'Ese personaje no está entre tus dos opciones.');
      const chosen = characterByName(command.payload.characterName);
      const maxLives = chosen.lives + (player.role === 'SHERIFF' ? 1 : 0);
      const chosenByPlayer = { ...draft.chosenByPlayer, [player.id]: chosen.name };
      let next = replacePlayer(state, { ...player, character: chosen, maxLives, lives: maxLives });
      const pending = next.players.find((candidate) => !chosenByPlayer[candidate.id]);
      if (pending) return { ok: true, state: { ...next, characterDraft: { ...draft, chosenByPlayer }, turn: { ...next.turn, currentPlayerId: pending.id } } };

      let deck = next.deck;
      const players = next.players.map((candidate) => {
        const hand = deck.slice(0, candidate.maxLives);
        deck = deck.slice(candidate.maxLives);
        return { ...candidate, hand };
      });
      const sheriff = players.find((candidate) => candidate.role === 'SHERIFF')!;
      next = { ...next, players, deck, characterDraft: null, turn: { number: 1, currentPlayerId: sheriff.id, phase: 'TURN_START', pendingDiscardCount: 0 } };
      return { ok: true, state: log(next, 'La cuadrilla ha elegido sus personajes.', 'SYSTEM') };
    }
    case 'SELECT_TARGET': return fail(state, 'SELECTION_IS_CLIENT_SIDE', 'La selección se incluye en el comando de carta.');
  }
};

export const applyCommand = (state: GameState, command: GameCommand): CommandResult => {
  if (!isGameCommand(command)) return fail(state, 'INVALID_COMMAND', 'El comando recibido no tiene un formato válido.');
  if (state.processedCommandIds.includes(command.commandId)) return { ok: true, state };
  if (command.expectedRevision !== state.revision) return fail(state, 'STALE_REVISION', `La partida avanzó de la revisión ${command.expectedRevision} a la ${state.revision}.`);
  if (state.winner) return fail(state, 'GAME_OVER', 'La partida ya ha terminado.');
  const result = handleCommand(state, command);
  if (!result.ok) return result;
  let resolvedState = result.state;
  const currentAfterCommand = playerById(resolvedState, resolvedState.turn.currentPlayerId);
  if (!resolvedState.winner && currentAfterCommand && !currentAfterCommand.alive) {
    const nextId = nextLivingPlayerId(resolvedState, currentAfterCommand.id);
    resolvedState = {
      ...resolvedState,
      reaction: null,
      multiAction: null,
      storeState: null,
      turn: { number: resolvedState.turn.number + 1, currentPlayerId: nextId, phase: 'TURN_START', pendingDiscardCount: 0 },
    };
  }
  const next: GameState = {
    ...resolvedState,
    revision: state.revision + 1,
    processedCommandIds: [...state.processedCommandIds.slice(-199), command.commandId],
  };
  try {
    assertGameState(next);
    return { ok: true, state: next };
  } catch (error) {
    return fail(state, 'INVARIANT_VIOLATION', error instanceof Error ? error.message : 'Estado inválido.');
  }
};
