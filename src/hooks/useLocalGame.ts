import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameCommand, GameState } from '../types';
import { decideAiCommand, initialKnowledge } from '../game/ai';
import { applyCommand, createGame, type PlayerSetup } from '../game/engine';

export interface LocalGameController {
  readonly state: GameState;
  readonly error: string | null;
  readonly dispatch: (command: GameCommand) => boolean;
}

export const useLocalGame = (setups: readonly PlayerSetup[], seed: number): LocalGameController => {
  const [state, setState] = useState(() => createGame(setups, seed));
  const [error, setError] = useState<string | null>(null);
  const knowledge = useMemo(() => Object.fromEntries(setups.filter((setup) => setup.kind === 'AI').map((setup) => [setup.id, initialKnowledge(state, setup.id)])), [setups, state]);

  const dispatch = useCallback((nextCommand: GameCommand): boolean => {
    let accepted = false;
    setState((current) => {
      const result = applyCommand(current, nextCommand);
      accepted = result.ok;
      setError(result.ok ? null : result.error.message);
      return result.state;
    });
    return accepted;
  }, []);

  useEffect(() => {
    const reactionActor = state.reaction?.targetPlayerId;
    const storeActor = state.storeState?.currentPlayerId;
    const activeId = reactionActor ?? storeActor ?? state.turn.currentPlayerId;
    const active = state.players.find((player) => player.id === activeId);
    if (state.winner || active?.kind !== 'AI') return;
    const timer = window.setTimeout(() => {
      const aiCommand = decideAiCommand(state, active.id, knowledge[active.id] ?? initialKnowledge(state, active.id));
      if (aiCommand) dispatch(aiCommand);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [dispatch, knowledge, state]);

  return { state, error, dispatch };
};
