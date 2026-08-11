import type { GameState, Room } from '../types';
import { serverNow } from '../firebase/clock';

export const DISCONNECTED_TAKEOVER_MS = 12_000;

const canAutomate = (room: Room, playerId: string, now: number): boolean => {
  const player = room.canonical?.players.find((candidate) => candidate.id === playerId);
  if (!player) return false;
  if (player.kind === 'AI') return true;
  const online = room.players[playerId];
  if (!online) return false;
  const presenceForPlayer = room.presence?.[playerId];
  if (presenceForPlayer === undefined) return !online.connected && now - online.lastSeen >= DISCONNECTED_TAKEOVER_MS;
  const connections = Object.values(presenceForPlayer).filter((connection) => connection.uid === online.uid);
  const hasLiveConnection = connections.some((connection) => connection.connected && now - connection.lastSeen < DISCONNECTED_TAKEOVER_MS);
  if (hasLiveConnection) return false;
  const latestSeen = Math.max(online.lastSeen, ...connections.map((connection) => connection.lastSeen));
  return now - latestSeen >= DISCONNECTED_TAKEOVER_MS;
};

export const automatedActorId = (room: Room, now = serverNow()): string | null => {
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
