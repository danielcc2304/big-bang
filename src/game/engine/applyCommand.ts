import type { Card, CardName, CommandFailure, CommandResult, GameCommand, GameState, Player, Reaction } from '../../types';
import { CARD_CATALOG } from '../cards/catalog';
import { characterByName } from '../characters/characters';
import { distanceBetween, isInRange } from '../rules/distance';
import { assertGameState } from './invariants';
import {
  damagePlayer, discardFromHand, drawCards, healPlayer, nextLivingPlayerId, playerById, replacePlayer,
} from './helpers';

const fail = (state: GameState, code: string, message: string): CommandFailure => ({ ok: false, state, error: { code, message } });
const isRed = (card: Card): boolean => card.suit === 'HEARTS' || card.suit === 'DIAMONDS';
const hasAllCards = (player: Player, ids: readonly string[]): boolean => ids.every((id) => player.hand.some((card) => card.id === id)) && new Set(ids).size === ids.length;

const log = (state: GameState, message: string, tone: 'NORMAL' | 'ACTION' | 'DANGER' | 'SYSTEM' = 'NORMAL'): GameState => ({
  ...state,
  logs: [...state.logs.slice(-79), { id: `log-${state.revision + 1}-${state.logs.length}`, revision: state.revision + 1, message, tone }],
});

const equipField = (name: CardName): 'weapon' | 'barrel' | 'mustang' | 'scope' | 'jail' | 'dynamite' | null => {
  if (CARD_CATALOG[name].kind === 'WEAPON') return 'weapon';
  return ({ BARREL: 'barrel', MUSTANG: 'mustang', SCOPE: 'scope', JAIL: 'jail', DYNAMITE: 'dynamite' } as const)[name as 'BARREL'] ?? null;
};

const removePlayedCard = (state: GameState, player: Player, card: Card, discard = true): GameState => {
  const next = replacePlayer(state, { ...player, hand: player.hand.filter((candidate) => candidate.id !== card.id) });
  return discard ? { ...next, discard: [...next.discard, card] } : next;
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
    const draw = drawCards(next, 1);
    const card = draw.cards[0];
    next = card ? { ...draw.state, discard: [...draw.state.discard, card] } : draw.state;
    if (card?.suit === 'HEARTS') successes += 1;
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
  const cards = player.hand.filter((card) => command.payload.cardIds.includes(card.id));
  if (!hasAllCards(player, command.payload.cardIds)) return fail(state, 'CARD_NOT_OWNED', 'Alguna carta ya no está en tu mano.');
  const accepted = reaction.type === 'INDIANS' || reaction.type === 'DUEL' ? ['BANG'] : ['MISSED'];
  const valid = cards.every((card) => accepted.includes(card.name) || player.character.name === 'Calamity Janet' && (card.name === 'BANG' || card.name === 'MISSED'));
  if (!valid) return fail(state, 'INVALID_REACTION', 'Esas cartas no resuelven esta reacción.');

  let next = discardFromHand(state, player.id, cards.map((card) => card.id));
  const total = reaction.cardsPlayed + cards.length;
  if (cards.length > 0 && total < reaction.requiredCards) return { ok: true, state: { ...next, reaction: { ...reaction, cardsPlayed: total } } };
  if (cards.length === 0 || total < reaction.requiredCards) next = damagePlayer(next, player.id, 1, reaction.sourcePlayerId);
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
    const draw = drawCards(next, 1);
    const judgement = draw.cards[0];
    next = judgement ? { ...draw.state, discard: [...draw.state.discard, judgement] } : draw.state;
    current = playerById(next, player.id)!;
    next = replacePlayer(next, { ...current, equipment: { ...current.equipment, dynamite: null } });
    if (judgement?.suit === 'SPADES' && Number(judgement.rank) >= 2 && Number(judgement.rank) <= 9) {
      next = { ...next, discard: [...next.discard, dynamite] };
      next = damagePlayer(next, player.id, 3, null);
    } else {
      const recipientId = nextLivingPlayerId(next, player.id);
      const recipient = playerById(next, recipientId);
      if (recipient?.alive && !recipient.equipment.dynamite) next = replacePlayer(next, { ...recipient, equipment: { ...recipient.equipment, dynamite } });
      else next = { ...next, discard: [...next.discard, dynamite] };
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
    const draw = drawCards(next, 1);
    const judgement = draw.cards[0];
    next = judgement ? { ...draw.state, discard: [...draw.state.discard, judgement, jail] } : { ...draw.state, discard: [...draw.state.discard, jail] };
    current = playerById(next, player.id)!;
    next = replacePlayer(next, { ...current, equipment: { ...current.equipment, jail: null } });
    if (judgement?.suit !== 'HEARTS') {
      const nextId = nextLivingPlayerId(next, player.id);
      return { ...next, turn: { number: next.turn.number + 1, currentPlayerId: nextId, phase: 'TURN_START', pendingDiscardCount: 0 } };
    }
  }
  return { ...next, turn: { ...next.turn, phase: 'DRAW' } };
};

const takeTargetCard = (state: GameState, source: Player, target: Player, cardId: string | undefined, discard: boolean): CommandResult => {
  const equipmentEntries = Object.entries(target.equipment) as [keyof Player['equipment'], Card | null][];
  const equipmentMatch = cardId ? equipmentEntries.find(([, card]) => card?.id === cardId) : undefined;
  const handMatch = cardId ? target.hand.find((card) => card.id === cardId) : target.hand[0];
  const card = equipmentMatch?.[1] ?? handMatch;
  if (!card) return fail(state, 'NO_TARGET_CARD', 'El objetivo no tiene esa carta.');
  let updatedTarget = target;
  if (equipmentMatch) updatedTarget = { ...target, equipment: { ...target.equipment, [equipmentMatch[0]]: null } };
  else updatedTarget = { ...target, hand: target.hand.filter((candidate) => candidate.id !== card.id) };
  let next = replacePlayer(state, updatedTarget);
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
    const withoutAction = removePlayedCard(state, player, card);
    const result = takeTargetCard(withoutAction, playerById(withoutAction, player.id)!, playerById(withoutAction, target.id)!, command.payload.targetCardId, card.name === 'CAT_BALOU');
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
    next = { ...draw.state, storeState: { id: `store-${state.revision + 1}`, cards: draw.cards, order, currentIndex: 0, currentPlayerId: order[0]!, pickedBy: {} }, turn: { ...next.turn, phase: 'STORE' } };
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
      let count = command.payload.count ?? 2;
      let draw = drawCards(state, count);
      if (player.character.name === 'Black Jack' && draw.cards[1] && isRed(draw.cards[1])) {
        const bonus = drawCards(draw.state, 1);
        draw = { state: bonus.state, cards: [...draw.cards, ...bonus.cards] };
        count += 1;
      }
      const current = playerById(draw.state, player.id)!;
      const next = replacePlayer(draw.state, { ...current, hand: [...current.hand, ...draw.cards] });
      return { ok: true, state: log({ ...next, turn: { ...next.turn, phase: 'PLAY' } }, `${player.name} roba ${count} cartas.`) };
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
      if (command.payload.cardIds.length !== state.turn.pendingDiscardCount || !hasAllCards(player, command.payload.cardIds)) return fail(state, 'WRONG_DISCARD_COUNT', `Descarta exactamente ${state.turn.pendingDiscardCount} cartas.`);
      const discarded = discardFromHand(state, player.id, command.payload.cardIds);
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
