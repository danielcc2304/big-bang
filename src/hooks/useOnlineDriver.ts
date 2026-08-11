import { useEffect, useMemo } from 'react';
import type { GameCommand, Room } from '../types';
import { acquireCoordinatorLease, applyAuthoritativeCommand, leaseIsValid, renewCoordinatorLease } from '../multiplayer/coordinator';
import { decideAiCommand, initialKnowledge } from '../game/ai';
import { processReconnectClaims } from '../multiplayer/roomService';

export const useOnlineDriver = (code: string, room: Room | null, uid: string): void => {
  const canonical = room?.canonical;
  const aiKnowledge = useMemo(() => canonical ? Object.fromEntries(canonical.players.filter((player) => player.kind === 'AI').map((player) => [player.id, initialKnowledge(canonical, player.id)])) : {}, [canonical]);

  useEffect(() => {
    if (!room) return;
    const lease = room.coordinator;
    if (!leaseIsValid(lease) && Object.values(room.seats).some((seat) => seat.ownerUid === uid)) void acquireCoordinatorLease(code, uid);
  }, [code, room, uid]);

  useEffect(() => {
    if (!room || room.coordinator.coordinatorId !== uid || !leaseIsValid(room.coordinator)) return;
    void processReconnectClaims(code, uid);
    const timer = window.setInterval(() => void renewCoordinatorLease(code, uid, room.coordinator.coordinatorEpoch), 4_000);
    return () => window.clearInterval(timer);
  }, [code, room, uid]);

  useEffect(() => {
    if (!room?.canonical || room.coordinator.coordinatorId !== uid || !leaseIsValid(room.coordinator)) return;
    const queued = Object.values(room.commands ?? {}).sort((a, b) => a.submittedAt - b.submittedAt)[0];
    if (queued) { void applyAuthoritativeCommand(code, queued.command, uid, room.coordinator.coordinatorEpoch); return; }
    const state = room.canonical;
    const actorId = state.reaction?.targetPlayerId ?? state.storeState?.currentPlayerId ?? state.turn.currentPlayerId;
    const actor = state.players.find((player) => player.id === actorId);
    if (actor?.kind !== 'AI' || state.winner) return;
    const timer = window.setTimeout(() => {
      const next: GameCommand | null = decideAiCommand(state, actor.id, aiKnowledge[actor.id] ?? initialKnowledge(state, actor.id));
      if (next) void applyAuthoritativeCommand(code, next, uid, room.coordinator.coordinatorEpoch);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [aiKnowledge, code, room, uid]);
};
