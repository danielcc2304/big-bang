import { describe, expect, it } from 'vitest';
import { decideAiCommand, initialKnowledge } from '../ai';
import { applyCommand } from './applyCommand';
import { createGame } from './setup';
import { validateGameState } from './invariants';

describe('simulación integral de IA', () => {
  it('mantiene invariantes durante partidas completas con muchas combinaciones', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      let state = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: 'AI' as const })), seed);
      const knowledge = Object.fromEntries(state.players.map((player) => [player.id, initialKnowledge(state, player.id)]));
      for (let step = 0; step < 350 && !state.winner; step += 1) {
        const actorId = state.reaction?.targetPlayerId ?? state.storeState?.currentPlayerId ?? state.turn.currentPlayerId;
        const next = decideAiCommand(state, actorId, knowledge[actorId]!);
        expect(next, `seed ${seed}, paso ${step}`).not.toBeNull();
        const result = applyCommand(state, next!);
        const played = next?.type === 'PLAY_CARD' ? state.players.find((player) => player.id === actorId)?.hand.find((card) => card.id === next.payload.cardId)?.name : '';
        expect(result.ok, result.ok ? '' : `seed ${seed}, paso ${step}, ${next?.type} ${played}: ${result.error.message}`).toBe(true);
        state = result.state;
        expect(validateGameState(state), `seed ${seed}, paso ${step}`).toEqual([]);
      }
    }
  });
});
