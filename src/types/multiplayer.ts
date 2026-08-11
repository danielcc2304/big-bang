import type { GameCommand, GameState } from './game';

export interface Seat {
  readonly number: number;
  readonly playerId: string;
  readonly ownerUid: string | null;
  readonly reconnectHash: string | null;
  readonly isBot: boolean;
  readonly joinedAt: number;
}

export interface OnlinePlayer {
  readonly uid: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly connected: boolean;
  readonly lastSeen: number;
}

export interface CoordinatorLease {
  readonly coordinatorId: string;
  readonly coordinatorEpoch: number;
  readonly leaseUntil: number;
  readonly heartbeat: number;
}

export interface Room {
  readonly code: string;
  readonly status: 'LOBBY' | 'PLAYING' | 'ENDED';
  readonly createdAt: number;
  readonly hostUid: string;
  readonly maxPlayers: 4 | 5 | 6 | 7;
  readonly characterMode: 'OFFICIAL' | 'DRAFT_TWO';
  readonly seats: Readonly<Record<string, Seat>>;
  readonly players: Readonly<Record<string, OnlinePlayer>>;
  readonly coordinator: CoordinatorLease;
  readonly canonical: GameState | null;
  readonly commands: Readonly<Record<string, CommandEnvelope>>;
}

export interface CommandEnvelope {
  readonly command: GameCommand;
  readonly submittedByUid: string;
  readonly submittedAt: number;
}

export interface PendingCommand {
  readonly command: GameCommand;
  readonly status: 'QUEUED' | 'PROCESSING' | 'APPLIED' | 'REJECTED';
  readonly error?: string;
}

export interface ConnectionState {
  readonly connected: boolean;
  readonly syncing: boolean;
  readonly localRevision: number;
  readonly serverRevision: number;
  readonly pingMs: number | null;
  readonly lastUpdateAt: number | null;
  readonly errors: readonly string[];
}
