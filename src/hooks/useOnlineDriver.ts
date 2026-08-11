import { useEffect, useMemo } from 'react';
import type { GameCommand, Room } from '../types';
import { acquireCoordinatorLease, applyAuthoritativeCommand, leaseIsValid, renewCoordinatorLease } from '../multiplayer/coordinator';
import { aiDecisionDelay, decideAiCommand, initialKnowledge } from '../game/ai';
import { processReconnectClaims } from '../multiplayer/roomService';
import { command } from '../game/engine';
import { automatedActorId, stateForAutomatedActor } from '../multiplayer/onlineAutomation';

const safely = (operation: Promise<unknown>): void => { void operation.catch(() => undefined); };

export const useOnlineDriver = (code: string, room: Room | null, uid: string): void => {
  const canonical = room?.canonical;
  const aiKnowledge = useMemo(() => canonical ? Object.fromEntries(canonical.players.filter((player) => player.kind === 'AI').map((player) => [player.id, initialKnowledge(canonical, player.id)])) : {}, [canonical]);

  useEffect(() => {
    if (!room) return;
    if (!Object.values(room.seats).some((seat) => seat.ownerUid === uid)) return;
    let acquiring = false;
    const acquireExpiredLease = (): void => {
      if (leaseIsValid(room.coordinator) || acquiring) return;
      acquiring = true;
      void acquireCoordinatorLease(code, uid).catch(() => undefined).finally(() => { acquiring = false; });
    };
    acquireExpiredLease();
    const retry = window.setInterval(acquireExpiredLease, 1_000);
    return () => window.clearInterval(retry);
  }, [code, room, uid]);

  useEffect(() => {
    if (!room || room.coordinator.coordinatorId !== uid || !leaseIsValid(room.coordinator)) return;
    safely(processReconnectClaims(code, uid));
    const timer = window.setInterval(() => safely(renewCoordinatorLease(code, uid, room.coordinator.coordinatorEpoch)), 4_000);
    return () => window.clearInterval(timer);
  }, [code, room, uid]);

  useEffect(() => {
    if (!room?.canonical || room.coordinator.coordinatorId !== uid || !leaseIsValid(room.coordinator)) return;
    const queued = Object.values(room.commands ?? {}).sort((a, b) => a.submittedAt - b.submittedAt)[0];
    if (!queued) return;
    let processing = false;
    const processQueued = (): void => {
      if (processing) return;
      processing = true;
      void applyAuthoritativeCommand(code, queued.command, uid, room.coordinator.coordinatorEpoch).catch(() => undefined).finally(() => { processing = false; });
    };
    processQueued();
    const retry = window.setInterval(processQueued, 700);
    return () => window.clearInterval(retry);
  }, [code, room, uid]);

  useEffect(() => {
    if (!room?.canonical || room.coordinator.coordinatorId !== uid || !leaseIsValid(room.coordinator)) return;
    if (Object.keys(room.commands ?? {}).length > 0) return;
    const state = room.canonical;
    if (!state.winner && (state.turn.phase === 'TURN_START' || state.turn.phase === 'DRAW')) {
      const current = state.players.find((player) => player.id === state.turn.currentPlayerId);
      const automatedDrawActor = state.turn.phase === 'DRAW' && automatedActorId(room) === current?.id;
      if (state.turn.phase === 'DRAW' && current?.kind === 'HUMAN' && current.character.name === 'Pedro Ramirez' && state.discard.length > 0 && !automatedDrawActor) return;
      const automatic = state.turn.phase === 'TURN_START'
        ? command(state, state.turn.currentPlayerId, 'RESOLVE_TURN_START', {})
        : command(state, state.turn.currentPlayerId, 'DRAW_CARDS', { firstCardSource: current?.character.name === 'Pedro Ramirez' && state.discard.length > 0 ? 'DISCARD' : 'DECK' });
      const timer = window.setTimeout(() => safely(applyAuthoritativeCommand(code, automatic, uid, room.coordinator.coordinatorEpoch)), current?.kind === 'AI' ? aiDecisionDelay(state) : 180);
      return () => window.clearTimeout(timer);
    }
    const actorId = automatedActorId(room);
    if (!actorId || state.winner) return;
    const automatedState = stateForAutomatedActor(room, actorId);
    if (!automatedState) return;
    const timer = window.setTimeout(() => {
      const next: GameCommand | null = decideAiCommand(automatedState, actorId, aiKnowledge[actorId] ?? initialKnowledge(automatedState, actorId));
      if (next) safely(applyAuthoritativeCommand(code, next, uid, room.coordinator.coordinatorEpoch));
    }, aiDecisionDelay(automatedState));
    return () => window.clearTimeout(timer);
  }, [aiKnowledge, code, room, uid]);
};
