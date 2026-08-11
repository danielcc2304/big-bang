import { describe, expect, it } from 'vitest';
import type { Room } from '../types';
import { createGame } from '../game/engine';
import { automatedActorId, DISCONNECTED_TAKEOVER_MS, stateForAutomatedActor } from './onlineAutomation';

const roomWithHuman = (connected: boolean, lastSeen: number): Room => {
  const canonical = createGame(Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, kind: index === 0 ? 'HUMAN' as const : 'AI' as const })), 71);
  return {
    code: 'ABC123', status: 'PLAYING', createdAt: 1, hostUid: 'host', maxPlayers: 4, characterMode: 'OFFICIAL', seats: {}, commands: {}, canonical,
    coordinator: { coordinatorId: 'host', coordinatorEpoch: 1, leaseUntil: 99_999, heartbeat: 1 },
    players: { p0: { uid: 'guest', playerId: 'p0', displayName: 'P0', connected, lastSeen } },
  };
};

describe('automatización de jugadores desconectados', () => {
  it('respeta el periodo de gracia y después cede el turno a la IA', () => {
    const now = 50_000;
    const initial = roomWithHuman(false, now - DISCONNECTED_TAKEOVER_MS + 1);
    const room: Room = { ...initial, canonical: { ...initial.canonical!, turn: { ...initial.canonical!.turn, currentPlayerId: 'p0', phase: 'PLAY' } } };
    expect(automatedActorId(room, now)).toBeNull();

    const expiredRoom: Room = { ...room, players: { p0: { ...room.players.p0!, lastSeen: now - DISCONNECTED_TAKEOVER_MS } } };
    expect(automatedActorId(expiredRoom, now)).toBe('p0');
    expect(stateForAutomatedActor(expiredRoom, 'p0')?.players[0]?.kind).toBe('AI');
  });

  it('no toma el control de un humano conectado', () => {
    const initial = roomWithHuman(true, 1);
    const room: Room = { ...initial, canonical: { ...initial.canonical!, turn: { ...initial.canonical!.turn, currentPlayerId: 'p0', phase: 'PLAY' } } };
    expect(automatedActorId(room, 99_999)).toBeNull();
  });
});
