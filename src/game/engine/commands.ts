import type { GameCommand, GameState } from '../../types';
import { secureId } from '../../utils/random';

type PayloadFor<T extends GameCommand['type']> = Extract<GameCommand, { type: T }>['payload'];

export const command = <T extends GameCommand['type']>(state: GameState, playerId: string, type: T, payload: PayloadFor<T>): Extract<GameCommand, { type: T }> => ({
  commandId: secureId('cmd'),
  playerId,
  type,
  payload,
  expectedRevision: state.revision,
  createdAt: Date.now(),
} as Extract<GameCommand, { type: T }>);
