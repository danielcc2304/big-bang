import type { Card, Character, CharacterDraftState, Equipment, GameCommand, GameLogEntry, GameState, OnlinePlayer, Player, Room, Seat, StoreState } from '../types';
import { isGameCommand } from '../game/engine/commands';
import { CARD_CATALOG } from '../game/cards/catalog';
import { CHARACTERS } from '../game/characters/characters';
import { validateGameState } from '../game/engine/invariants';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isString = (value: unknown, max = 160): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const isLogTone = (value: unknown): value is GameLogEntry['tone'] => value === 'NORMAL' || value === 'ACTION' || value === 'DANGER' || value === 'SYSTEM';
const requireArray = (value: unknown, name: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`La sala contiene un campo ${name} invalido.`);
  return value;
};

const hydrateCharacter = (value: unknown, name: string): Character => {
  if (!isRecord(value) || !isString(value.name, 64)) throw new Error(`La sala contiene un personaje ${name} invalido.`);
  const character = CHARACTERS.find((candidate) => candidate.name === value.name);
  if (!character) throw new Error(`La sala contiene un personaje ${name} desconocido.`);
  return character;
};

const hydrateCard = (value: unknown, name: string): Card => {
  if (!isRecord(value) || !isString(value.id, 128) || !isString(value.name, 64) || !isString(value.kind, 16) || !isString(value.suit, 16) || !isString(value.rank, 4)) throw new Error(`La sala contiene una carta ${name} invalida.`);
  const definition = CARD_CATALOG[value.name as keyof typeof CARD_CATALOG];
  if (!definition || definition.kind !== value.kind || !['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS'].includes(value.suit) || !['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].includes(value.rank)) throw new Error(`La sala contiene una carta ${name} desconocida.`);
  return { ...value, name: definition.name, kind: definition.kind } as Card;
};

const hydrateCards = (value: unknown, name: string): readonly Card[] => requireArray(value, name).map((card, index) => hydrateCard(card, `${name}[${index}]`));
const hydrateStringArray = (value: unknown, name: string): readonly string[] => requireArray(value, name).map((entry, index) => {
  if (!isString(entry, 160)) throw new Error(`La sala contiene un texto ${name}[${index}] invalido.`);
  return entry;
});

export const hydrateGameCommand = (command: GameCommand): GameCommand => {
  const missingPayloadAllowed = command?.payload == null && (command?.type === 'REACTION' || command?.type === 'DRAW_CARDS' || command?.type === 'END_TURN' || command?.type === 'RESOLVE_TURN_START');
  const candidate = missingPayloadAllowed ? { ...command, payload: {} } : command;
  if (!isGameCommand(candidate)) throw new Error('El comando recibido no tiene un formato válido.');
  if (candidate.type !== 'REACTION') return candidate;
  const payload = candidate.payload;
  return { ...candidate, payload: { cardIds: payload.cardIds ?? [], ...(payload.takeDamage ? { takeDamage: true as const } : {}) } };
};

const hydratePlayer = (value: unknown): Player => {
  if (!isRecord(value) || !isString(value.id, 128) || !isFiniteNumber(value.seat) || !Number.isInteger(value.seat) || value.seat < 0 || !isString(value.name, 80) || (value.kind !== 'HUMAN' && value.kind !== 'AI') || !['SHERIFF', 'DEPUTY', 'OUTLAW', 'RENEGADE'].includes(String(value.role)) || !isFiniteNumber(value.lives) || !Number.isInteger(value.lives) || value.lives < 0 || !isFiniteNumber(value.maxLives) || !Number.isInteger(value.maxLives) || value.maxLives < 0 || typeof value.alive !== 'boolean' || !isFiniteNumber(value.bangsPlayedThisTurn) || !Number.isInteger(value.bangsPlayedThisTurn) || value.bangsPlayedThisTurn < 0) throw new Error('La sala contiene un jugador invalido.');
  const equipmentValue = value.equipment == null ? {} : value.equipment;
  if (!isRecord(equipmentValue)) throw new Error('La sala contiene un equipo invalido.');
  const hand = hydrateCards(value.hand ?? [], `mano de ${value.id}`);
  const equipment = {
    weapon: equipmentValue.weapon == null ? null : hydrateCard(equipmentValue.weapon, `${value.id}.weapon`),
    barrel: equipmentValue.barrel == null ? null : hydrateCard(equipmentValue.barrel, `${value.id}.barrel`),
    mustang: equipmentValue.mustang == null ? null : hydrateCard(equipmentValue.mustang, `${value.id}.mustang`),
    scope: equipmentValue.scope == null ? null : hydrateCard(equipmentValue.scope, `${value.id}.scope`),
    jail: equipmentValue.jail == null ? null : hydrateCard(equipmentValue.jail, `${value.id}.jail`),
    dynamite: equipmentValue.dynamite == null ? null : hydrateCard(equipmentValue.dynamite, `${value.id}.dynamite`),
  } satisfies Equipment;
  return {
    ...value,
    character: hydrateCharacter(value.character, `${value.id}.character`),
    lifeMarkerCharacter: value.lifeMarkerCharacter == null ? null : hydrateCharacter(value.lifeMarkerCharacter, `${value.id}.lifeMarkerCharacter`),
    hand,
    equipment,
  } as Player;
};

const hydrateStoreState = (value: unknown): StoreState | null => {
  if (value == null) return null;
  if (!isRecord(value) || !isString(value.id, 128) || !isFiniteNumber(value.currentIndex) || !Number.isInteger(value.currentIndex) || !isString(value.currentPlayerId, 128)) throw new Error('La sala contiene un Almacen invalido.');
  const pickedByValue = value.pickedBy == null ? {} : value.pickedBy;
  if (!isRecord(pickedByValue) || Object.values(pickedByValue).some((cardId) => !isString(cardId, 128))) throw new Error('La sala contiene elecciones de Almacen invalidas.');
  return {
    ...value,
    cards: hydrateCards(value.cards ?? [], 'storeState.cards'),
    order: hydrateStringArray(value.order ?? [], 'storeState.order'),
    pickedBy: pickedByValue as Readonly<Record<string, string>>,
  } as StoreState;
};

const hydrateCharacterDraft = (value: unknown): CharacterDraftState | null => {
  if (value == null) return null;
  if (!isRecord(value)) throw new Error('La sala contiene una seleccion de personajes invalida.');
  const optionsValue = value.optionsByPlayer == null ? {} : value.optionsByPlayer;
  const chosenValue = value.chosenByPlayer == null ? {} : value.chosenByPlayer;
  if (!isRecord(optionsValue) || !isRecord(chosenValue)) throw new Error('La sala contiene una seleccion de personajes invalida.');
  const optionsByPlayer = Object.fromEntries(Object.entries(optionsValue).map(([playerId, options]) => {
    const values = requireArray(options, `opciones de ${playerId}`);
    if (values.length !== 2 || values.some((option) => !isString(option, 64) || !CHARACTERS.some((character) => character.name === option))) throw new Error(`La sala contiene opciones de personaje invalidas para ${playerId}.`);
    return [playerId, values as CharacterDraftState['optionsByPlayer'][string]];
  }));
  const chosenByPlayer = Object.fromEntries(Object.entries(chosenValue).map(([playerId, choice]) => {
    if (!isString(choice, 64) || !CHARACTERS.some((character) => character.name === choice)) throw new Error(`La sala contiene una eleccion de personaje invalida para ${playerId}.`);
    return [playerId, choice];
  }));
  return { ...value, optionsByPlayer, chosenByPlayer } as CharacterDraftState;
};

export const hydrateGameState = (state: GameState): GameState => {
  if (!isRecord(state) || !isString(state.gameId, 128) || !isFiniteNumber(state.seed) || !isFiniteNumber(state.revision) || !Number.isInteger(state.revision) || !isRecord(state.turn)) throw new Error('El estado canonico de la sala no tiene un formato valido.');
  if (!isFiniteNumber(state.turn.number) || !Number.isInteger(state.turn.number) || state.turn.number < 1 || !isString(state.turn.currentPlayerId, 128) || !['CHARACTER_CHOICE', 'TURN_START', 'DRAW', 'PLAY', 'DISCARD', 'WAITING_REACTION', 'STORE', 'MULTI_ACTION', 'GAME_OVER'].includes(String(state.turn.phase)) || !isFiniteNumber(state.turn.pendingDiscardCount) || !Number.isInteger(state.turn.pendingDiscardCount) || state.turn.pendingDiscardCount < 0) throw new Error('El turno canonico de la sala no tiene un formato valido.');
  const players = requireArray(state.players, 'players');
  const deck = state.deck == null ? [] : hydrateCards(state.deck, 'deck');
  const discard = state.discard == null ? [] : hydrateCards(state.discard, 'discard');
  const processedCommandIds = state.processedCommandIds == null ? [] : hydrateStringArray(state.processedCommandIds, 'processedCommandIds');
  const logsValue = state.logs == null ? [] : requireArray(state.logs, 'logs');
  const logs = logsValue.map((entry, index) => {
    if (!isRecord(entry) || !isString(entry.id, 128) || !isFiniteNumber(entry.revision) || !isString(entry.message, 500) || !isLogTone(entry.tone)) throw new Error(`La sala contiene un registro ${index} invalido.`);
    const effectValue = entry.effect;
    if (effectValue != null && (!isRecord(effectValue) || !['JUDGEMENT', 'REACTION'].includes(String(effectValue.kind)) || !isString(effectValue.playerId, 128) || typeof effectValue.success !== 'boolean' || !isString(effectValue.headline, 80))) throw new Error(`La sala contiene un efecto ${index} invalido.`);
    const effect = effectValue == null ? undefined : {
      kind: effectValue.kind as 'JUDGEMENT' | 'REACTION',
      playerId: effectValue.playerId as string,
      card: hydrateCard(effectValue.card, `logs[${index}].effect.card`),
      success: effectValue.success as boolean,
      headline: effectValue.headline as string,
    };
    return { id: entry.id, revision: entry.revision, message: entry.message, tone: entry.tone, ...(effect ? { effect } : {}) } satisfies GameLogEntry;
  });
  const reaction = state.reaction == null ? null : state.reaction;
  if (reaction && (!isRecord(reaction) || !isString(reaction.id, 128) || !['BANG', 'INDIANS', 'DUEL', 'GATLING'].includes(String(reaction.type)) || !isString(reaction.sourcePlayerId, 128) || !isString(reaction.targetPlayerId, 128) || !isFiniteNumber(reaction.requiredCards) || !Number.isInteger(reaction.requiredCards) || reaction.requiredCards < 1 || !isFiniteNumber(reaction.cardsPlayed) || !Number.isInteger(reaction.cardsPlayed) || reaction.cardsPlayed < 0 || !isFiniteNumber(reaction.createdAt))) throw new Error('La sala contiene una reaccion invalida.');
  const multiAction = state.multiAction == null ? null : state.multiAction;
  if (multiAction && (!isRecord(multiAction) || !isString(multiAction.id, 128) || !['GATLING', 'INDIANS'].includes(String(multiAction.type)) || !isString(multiAction.sourcePlayerId, 128) || !Array.isArray(multiAction.targets) || multiAction.targets.some((target) => !isString(target, 128)) || !isFiniteNumber(multiAction.currentTargetIndex) || !Number.isInteger(multiAction.currentTargetIndex) || multiAction.currentTargetIndex < 0)) throw new Error('La sala contiene una accion multiple invalida.');
  const winner = state.winner == null ? null : state.winner;
  if (winner !== null && !['LAW', 'OUTLAWS', 'RENEGADE'].includes(String(winner))) throw new Error('La sala contiene un ganador invalido.');
  const hydrated: GameState = {
    ...state,
    players: players.map((player) => hydratePlayer(player)),
    deck,
    discard,
    turn: state.turn,
    reaction,
    storeState: hydrateStoreState(state.storeState),
    multiAction,
    characterDraft: hydrateCharacterDraft(state.characterDraft),
    processedCommandIds,
    logs,
    winner,
  };
  const errors = validateGameState(hydrated);
  if (errors.length > 0) throw new Error(`El estado canonico de la sala no es valido. ${errors.join(' ')}`);
  return hydrated;
};

const hydrateSeat = (value: unknown): Seat => {
  if (!isRecord(value) || !isFiniteNumber(value.number) || !Number.isInteger(value.number) || value.number < 0 || value.number > 6 || !isString(value.playerId, 128) || (value.ownerUid != null && !isString(value.ownerUid, 128)) || (value.reconnectHash != null && !isString(value.reconnectHash, 128)) || typeof value.isBot !== 'boolean' || !isFiniteNumber(value.joinedAt)) throw new Error('La sala contiene un asiento invalido.');
  return { ...value, ownerUid: value.ownerUid ?? null, reconnectHash: value.reconnectHash ?? null } as Seat;
};

const hydrateOnlinePlayer = (value: unknown): OnlinePlayer => {
  if (!isRecord(value) || !isString(value.uid, 128) || !isString(value.playerId, 128) || !isString(value.displayName, 80) || typeof value.connected !== 'boolean' || !isFiniteNumber(value.lastSeen)) throw new Error('La sala contiene un jugador online invalido.');
  return { uid: value.uid, playerId: value.playerId, displayName: value.displayName, connected: value.connected, lastSeen: value.lastSeen };
};

type PresenceMap = NonNullable<Room['presence']>;

const hydratePresence = (presence: Room['presence'] | null | undefined): PresenceMap => Object.fromEntries(
  Object.entries(presence ?? {}).map(([playerId, connections]) => [
    playerId,
    Object.fromEntries(Object.entries(connections ?? {}).filter(([, connection]) => connection && typeof connection.uid === 'string').map(([connectionId, connection]) => [
      connectionId,
      {
        ...connection,
        connected: connection.connected !== false,
        connectedAt: Number(connection.connectedAt ?? 0),
        lastSeen: Number(connection.lastSeen ?? 0),
      },
    ])),
  ]),
);

export const hydrateRoom = (room: Room): Room => {
  if (!isRecord(room) || !isString(room.code, 16) || !['LOBBY', 'PLAYING', 'ENDED'].includes(String(room.status)) || !isFiniteNumber(room.createdAt) || !isString(room.hostUid, 128) || ![4, 5, 6, 7].includes(Number(room.maxPlayers)) || !['OFFICIAL', 'DRAFT_TWO'].includes(String(room.characterMode)) || !isRecord(room.coordinator)) throw new Error('La sala recibida no tiene un formato valido.');
  if (!isString(room.coordinator.coordinatorId, 128) || !isFiniteNumber(room.coordinator.coordinatorEpoch) || !Number.isInteger(room.coordinator.coordinatorEpoch) || !isFiniteNumber(room.coordinator.leaseUntil) || !isFiniteNumber(room.coordinator.heartbeat)) throw new Error('La sala contiene un coordinador invalido.');
  // Realtime Database serializes dense numeric keys (such as seat 0, 1, 2...)
  // as an array and removes empty maps. Normalize both valid wire formats.
  const seats = room.seats ?? {};
  const players = room.players ?? {};
  const commands = room.commands ?? {};
  if ((!isRecord(seats) && !Array.isArray(seats)) || !isRecord(players) || !isRecord(commands)) throw new Error('La sala recibida no contiene sus colecciones principales.');
  const receiptsValue = room.commandReceipts == null ? {} : room.commandReceipts;
  if (!isRecord(receiptsValue)) throw new Error('La sala contiene confirmaciones invalidas.');
  const commandReceipts = Object.fromEntries(Object.entries(receiptsValue).filter(([, receipt]) => isRecord(receipt) && isString(receipt.commandId, 128) && isString(receipt.submittedByUid, 128) && ['APPLIED', 'REJECTED'].includes(String(receipt.status)) && isFiniteNumber(receipt.updatedAt)).map(([key, receipt]) => [key, receipt]));
  return {
    ...room,
    seats: Object.fromEntries(Object.entries(seats).filter(([, seat]) => seat != null).map(([key, seat]) => [key, hydrateSeat(seat)])),
    players: Object.fromEntries(Object.entries(players).map(([key, player]) => [key, hydrateOnlinePlayer(player)])),
    canonical: room.canonical ? hydrateGameState(room.canonical) : null,
    commands,
    commandReceipts,
    presence: hydratePresence(room.presence),
  };
};
