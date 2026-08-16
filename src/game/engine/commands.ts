import type { GameCommand, GameState } from '../../types';
import { secureId } from '../../utils/random';
import { CHARACTERS } from '../characters/characters';

type PayloadFor<T extends GameCommand['type']> = Extract<GameCommand, { type: T }>['payload'];

export const command = <T extends GameCommand['type']>(state: GameState, playerId: string, type: T, payload: PayloadFor<T>): Extract<GameCommand, { type: T }> => ({
  commandId: secureId('cmd'),
  playerId,
  type,
  payload,
  expectedRevision: state.revision,
  createdAt: Date.now(),
} as Extract<GameCommand, { type: T }>);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160;
const isStringArray = (value: unknown, max = 32): value is readonly string[] => Array.isArray(value) && value.length <= max && value.every(isString) && new Set(value).size === value.length;
const isEmptyPayload = (value: unknown): value is Record<string, never> => isRecord(value) && Object.keys(value).length === 0;

/** Runtime validation for commands read from an untrusted Realtime Database snapshot. */
export const isGameCommand = (value: unknown): value is GameCommand => {
  if (!isRecord(value) || !isString(value.commandId) || !isString(value.playerId) || typeof value.expectedRevision !== 'number' || !Number.isInteger(value.expectedRevision) || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || !isString(value.type) || !isRecord(value.payload)) return false;
  const payload = value.payload;
  switch (value.type) {
    case 'PLAY_CARD':
      return isString(payload.cardId) && (payload.targetPlayerId === undefined || isString(payload.targetPlayerId)) && (payload.targetCardId === undefined || isString(payload.targetCardId)) && (payload.targetCardChoice === undefined || payload.targetCardChoice === 'RANDOM_HAND');
    case 'DRAW_CARDS': return (payload.firstCardSource === undefined || isString(payload.firstCardSource))
      && (payload.sourcePlayerId === undefined || isString(payload.sourcePlayerId))
      && (payload.drawCardIds === undefined || isStringArray(payload.drawCardIds, 3));
    case 'SELECT_TARGET': return isString(payload.targetPlayerId);
    case 'END_TURN': return isEmptyPayload(payload);
    case 'DISCARD_CARDS': return isStringArray(payload.cardIds);
    case 'REACTION': return (payload.cardIds === undefined || isStringArray(payload.cardIds)) && (payload.takeDamage === undefined || payload.takeDamage === true);
    case 'STORE_PICK': return isString(payload.cardId);
    case 'CHARACTER_CHOICE': return isString(payload.characterName) && CHARACTERS.some((character) => character.name === payload.characterName);
    case 'USE_CHARACTER_ABILITY': return (payload.cardIds === undefined || isStringArray(payload.cardIds, 8)) && (payload.targetPlayerId === undefined || isString(payload.targetPlayerId));
    case 'RESOLVE_TURN_START': return isEmptyPayload(payload);
    default: return false;
  }
};
