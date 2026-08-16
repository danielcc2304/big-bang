import { useEffect, useMemo, useRef } from 'react';
import type { GameCommand, Room } from '../types';
import { acquireCoordinatorLease, applyAuthoritativeCommand, leaseIsValid, removeMalformedCommand, renewCoordinatorLease } from '../multiplayer/coordinator';
import { aiDecisionDelay, decideAiCommand, initialKnowledge } from '../game/ai';
import { processReconnectClaims } from '../multiplayer/roomService';
import { command } from '../game/engine';
import { hydrateGameCommand } from '../multiplayer/hydrate';
import { automatedActorId, stateForAutomatedActor } from '../multiplayer/onlineAutomation';

const safely = (operation: Promise<unknown>, label: string): void => {
  void operation.catch((error: unknown) => console.error(`[online] ${label}`, error));
};

export const useOnlineDriver = (code: string, room: Room | null, uid: string): void => {
  const roomRef = useRef<Room | null>(room);
  roomRef.current = room;
  const canonical = room?.canonical;
  const status = room?.status;
  const coordinatorId = room?.coordinator.coordinatorId;
  const coordinatorEpoch = room?.coordinator.coordinatorEpoch;
  const ownedSeat = room ? Object.values(room.seats).some((seat) => seat.ownerUid === uid) : false;
  const commandCount = Object.keys(room?.commands ?? {}).length;
  const queued = useMemo(() => {
    const entries = Object.entries(room?.commands ?? {}).sort(([, left], [, right]) => (left?.submittedAt ?? 0) - (right?.submittedAt ?? 0));
    const [key, envelope] = entries[0] ?? [];
    return key ? { key, envelope } : null;
  }, [room?.commands]);
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  const automationTimerRef = useRef<number | null>(null);
  const automationKeyRef = useRef<string | null>(null);
  const automationAttemptAtRef = useRef(0);
  const automationInFlightRef = useRef(false);
  const aiKnowledge = useMemo(() => canonical ? Object.fromEntries(canonical.players.filter((player) => player.kind === 'AI').map((player) => [player.id, initialKnowledge(canonical, player.id)])) : {}, [canonical]);
  const aiKnowledgeRef = useRef(aiKnowledge);
  aiKnowledgeRef.current = aiKnowledge;

  useEffect(() => {
    const initialRoom = roomRef.current;
    if (!initialRoom || status === 'ENDED' || !ownedSeat) return;
    let acquiring = false;
    const acquireExpiredLease = (): void => {
      const latest = roomRef.current;
      if (!latest || leaseIsValid(latest.coordinator) || acquiring) return;
      acquiring = true;
      void acquireCoordinatorLease(code, uid).catch((error: unknown) => console.error('[online] acquire coordinator lease', error)).finally(() => { acquiring = false; });
    };
    acquireExpiredLease();
    const retry = window.setInterval(acquireExpiredLease, 1_000);
    return () => window.clearInterval(retry);
  }, [code, ownedSeat, status, uid]);

  useEffect(() => {
    const initialRoom = roomRef.current;
    if (!initialRoom || status === 'ENDED' || coordinatorId !== uid || coordinatorEpoch === undefined || !leaseIsValid(initialRoom.coordinator)) return;
    safely(processReconnectClaims(code, uid), 'process reconnect claims');
    const epoch = coordinatorEpoch;
    const timer = window.setInterval(() => safely(renewCoordinatorLease(code, uid, epoch), 'renew coordinator lease'), 4_000);
    const claimsTimer = window.setInterval(() => safely(processReconnectClaims(code, uid), 'process reconnect claims'), 1_500);
    return () => { window.clearInterval(timer); window.clearInterval(claimsTimer); };
  }, [code, coordinatorEpoch, coordinatorId, status, uid]);

  useEffect(() => {
    const initialRoom = roomRef.current;
    const currentQueued = queuedRef.current;
    const currentCanonical = initialRoom?.canonical;
    if (!initialRoom || status === 'ENDED' || !currentCanonical || coordinatorId !== uid || coordinatorEpoch === undefined || !leaseIsValid(initialRoom.coordinator) || !currentQueued) return;
    let processing = false;
    const processQueued = (): void => {
      if (processing) return;
      processing = true;
      const candidate = currentQueued.envelope?.command;
      let normalized: GameCommand | null = null;
      if (candidate) {
        try { normalized = hydrateGameCommand(candidate); } catch { normalized = null; }
      }
      const operation = normalized
        ? applyAuthoritativeCommand(code, normalized, uid, coordinatorEpoch)
        : removeMalformedCommand(code, currentQueued.key, uid, coordinatorEpoch);
      void operation.catch((error: unknown) => console.error('[online] process queued command', error)).finally(() => { processing = false; });
    };
    processQueued();
    const retry = window.setInterval(processQueued, 700);
    return () => window.clearInterval(retry);
  }, [canonical?.revision, code, commandCount, coordinatorEpoch, coordinatorId, queued?.envelope?.command?.commandId, queued?.key, status, uid]);

  useEffect(() => {
    const clearAutomation = (): void => {
      if (automationTimerRef.current !== null) {
        window.clearTimeout(automationTimerRef.current);
        automationTimerRef.current = null;
      }
      automationKeyRef.current = null;
      automationAttemptAtRef.current = 0;
      automationInFlightRef.current = false;
    };
    const scheduleAutomation = (): void => {
      const latestRoom = roomRef.current;
      const state = latestRoom?.canonical;
      if (automationInFlightRef.current) return;
      if (!latestRoom || status === 'ENDED' || !state || coordinatorId !== uid || coordinatorEpoch === undefined || !leaseIsValid(latestRoom.coordinator) || Object.keys(latestRoom.commands ?? {}).length > 0 || state.winner) {
        clearAutomation();
        return;
      }
      let automatic: GameCommand | null = null;
      let delay = 0;
      if (state.turn.phase === 'TURN_START' || state.turn.phase === 'DRAW') {
        const current = state.players.find((player) => player.id === state.turn.currentPlayerId);
        const automatedDrawActor = state.turn.phase === 'DRAW' && automatedActorId(latestRoom) === current?.id;
        const humanNeedsDrawChoice = state.turn.phase === 'DRAW' && current?.kind === 'HUMAN' && !automatedDrawActor && (
          current.character.name === 'Pedro Ramirez' && state.discard.length > 0
          || current.character.name === 'Kit Carlson'
          || current.character.name === 'Jesse Jones' && state.players.some((player) => player.id !== current.id && player.alive && player.hand.length > 0)
        );
        if (humanNeedsDrawChoice) return;
        automatic = state.turn.phase === 'TURN_START'
          ? command(state, state.turn.currentPlayerId, 'RESOLVE_TURN_START', {})
          : command(state, state.turn.currentPlayerId, 'DRAW_CARDS', { firstCardSource: current?.character.name === 'Pedro Ramirez' && state.discard.length > 0 ? 'DISCARD' : 'DECK' });
        delay = current?.kind === 'AI' ? aiDecisionDelay(state) : 180;
      } else {
        const actorId = automatedActorId(latestRoom);
        if (!actorId) return;
        const automatedState = stateForAutomatedActor(latestRoom, actorId);
        if (!automatedState) return;
        const key = `${automatedState.revision}:${automatedState.turn.phase}:${automatedState.reaction?.id ?? ''}:${automatedState.storeState?.id ?? ''}:${actorId}`;
        if (automationKeyRef.current === key && Date.now() - automationAttemptAtRef.current < 3_000) return;
        automatic = decideAiCommand(automatedState, actorId, aiKnowledgeRef.current[actorId] ?? initialKnowledge(automatedState, actorId));
        if (!automatic) return;
        delay = aiDecisionDelay(automatedState);
      }
      const key = `${state.revision}:${state.turn.phase}:${state.reaction?.id ?? ''}:${state.storeState?.id ?? ''}:${automatic.playerId}:${automatic.type}`;
      if (automationKeyRef.current === key && Date.now() - automationAttemptAtRef.current < 3_000) return;
      automationKeyRef.current = key;
      automationAttemptAtRef.current = Date.now();
      const epoch = coordinatorEpoch;
      automationTimerRef.current = window.setTimeout(() => {
        automationTimerRef.current = null;
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.status === 'ENDED' || currentRoom.coordinator.coordinatorId !== uid || currentRoom.coordinator.coordinatorEpoch !== epoch || !leaseIsValid(currentRoom.coordinator) || Object.keys(currentRoom.commands ?? {}).length > 0) {
          automationKeyRef.current = null;
          return;
        }
        automationInFlightRef.current = true;
        void applyAuthoritativeCommand(code, automatic, uid, epoch)
          .catch((error: unknown) => console.error('[online] automatic game command', error))
          .finally(() => { automationInFlightRef.current = false; });
      }, delay);
    };
    scheduleAutomation();
    const poll = window.setInterval(scheduleAutomation, 1_000);
    return () => { window.clearInterval(poll); clearAutomation(); };
  }, [code, coordinatorEpoch, coordinatorId, status, uid]);
};
