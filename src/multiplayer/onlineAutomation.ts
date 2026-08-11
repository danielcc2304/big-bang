import type { GameState, Room } from '../types';

export const DISCONNECTED_TAKEOVER_MS = 12_000;

const canAutomate = (room: Room, playerId: string, now: number): boolean => {
  const player = room.canonical?.players.find((candidate) => candidate.id === playerId);
  if (!player) return false;
  if (player.kind === 'AI') return true;
  const online = room.players[playerId];
  return Boolean(online && !online.connected && now - online.lastSeen >= DISCONNECTED_TAKEOVER_MS);
};

export const automatedActorId = (room: Room, now = Date.now()): string | null => {
  const state = room.canonical;
  if (!state || state.winner) return null;
  if (state.reaction) return canAutomate(room, state.reaction.targetPlayerId, now) ? state.reaction.targetPlayerId : null;
  if (state.storeState) return canAutomate(room, state.storeState.currentPlayerId, now) ? state.storeState.currentPlayerId : null;
  if (state.turn.phase === 'CHARACTER_CHOICE') {
    return state.players.find((player) => !state.characterDraft?.chosenByPlayer[player.id] && canAutomate(room, player.id, now))?.id ?? null;
  }
  return canAutomate(room, state.turn.currentPlayerId, now) ? state.turn.currentPlayerId : null;
};

export const stateForAutomatedActor = (room: Room, playerId: string): GameState | null => {
  const state = room.canonical;
  const player = state?.players.find((candidate) => candidate.id === playerId);
  if (!state || !player) return null;
  if (player.kind === 'AI') return state;
  return { ...state, players: state.players.map((candidate) => candidate.id === playerId ? { ...candidate, kind: 'AI' } : candidate) };
};
