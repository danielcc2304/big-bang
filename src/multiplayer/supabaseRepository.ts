import type { CommandEnvelope, CommandReceipt, GameCommand, OnlinePlayer, PresenceConnection, Room } from '../types';
import { hydrateRoom } from './hydrate';
import { serverNow } from '../supabase/clock';
import { requireSupabaseClient } from '../supabase/client';

type JsonRecord = Record<string, unknown>;

interface RoomRow {
  readonly state: unknown;
  readonly version: number | string;
}

interface CommandRow {
  readonly slot_key: string;
  readonly command_id: string;
  readonly command: unknown;
  readonly submitted_by_uid: string;
  readonly submitted_at: number | string;
}

interface ReceiptRow {
  readonly command_id: string;
  readonly submitted_by_uid: string;
  readonly status: CommandReceipt['status'];
  readonly updated_at: number | string;
  readonly revision: number | string | null;
  readonly error: string | null;
}

interface PresenceRow {
  readonly player_id: string;
  readonly connection_id: string;
  readonly uid: string;
  readonly connected: boolean;
  readonly connected_at: number | string;
  readonly last_seen: number | string;
}

interface RpcEnvelope {
  readonly [key: string]: unknown;
}

const asRecord = (value: unknown): JsonRecord => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {});
const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const normalizeCode = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

const throwPostgrest = (error: { readonly message?: string; readonly code?: string } | null, fallback: string): never => {
  if (!error) throw new Error(fallback);
  const messages: Record<string, string> = {
    authentication_required: 'La sesión anónima de Supabase no está disponible.',
    room_unavailable: 'La sala no existe o ya ha empezado.',
    room_full: 'La sala está completa.',
    seat_not_owned: 'No eres propietario de ese asiento.',
    command_queue_full: 'La cola de acciones está llena. Espera un instante.',
    command_rate_limited: 'Has enviado demasiadas acciones seguidas.',
    invalid_reconnect_token: 'La clave de recuperación no es válida para esta sala.',
    seat_still_connected: 'Ese asiento sigue conectado en otro dispositivo.',
    version_conflict: 'La sala ha cambiado. Sincronizando el estado más reciente.',
    lease_invalid: 'El coordinador de la sala ha cambiado. Reintentando.',
  };
  const key = messages[error.code ?? ''] ? error.code : messages[error.message ?? ''] ? error.message : undefined;
  throw new Error(key ? messages[key] : `${fallback}${error.message ? ` ${error.message}` : ''}`);
};

const callRpc = async <T extends RpcEnvelope>(name: string, args: Record<string, unknown>): Promise<T> => {
  const response = await requireSupabaseClient().rpc(name, args) as unknown as { readonly data: unknown; readonly error: { readonly message?: string; readonly code?: string } | null };
  const { data, error } = response;
  if (error) throwPostgrest(error, `Supabase rechazó la operación ${name}.`);
  return asRecord(data) as T;
};

const tableRows = async <T>(table: string, code: string): Promise<T[]> => {
  const response = await requireSupabaseClient().from(table).select('*').eq('room_code', normalizeCode(code)) as unknown as { readonly data: unknown; readonly error: { readonly message?: string; readonly code?: string } | null };
  const { data, error } = response;
  if (error) throwPostgrest(error, `No se pudo leer ${table}.`);
  return (Array.isArray(data) ? data : []) as T[];
};

const mergePresence = (room: Room, rows: PresenceRow[]): Room => {
  const presence = rows.reduce<Record<string, Record<string, PresenceConnection>>>((result, row) => {
    const byPlayer = result[row.player_id] ?? {};
    byPlayer[row.connection_id] = {
      uid: row.uid,
      connected: row.connected,
      connectedAt: asNumber(row.connected_at),
      lastSeen: asNumber(row.last_seen),
    };
    result[row.player_id] = byPlayer;
    return result;
  }, {});
  const now = serverNow();
  const players = Object.fromEntries(Object.entries(room.players).map(([playerId, player]) => {
    const connections = Object.values(presence[playerId] ?? {}).filter((connection) => connection.uid === player.uid);
    if (connections.length === 0) {
      return [playerId, { ...player, connected: player.connected && now - player.lastSeen < 12_000 } satisfies OnlinePlayer];
    }
    const latestSeen = Math.max(player.lastSeen, ...connections.map((connection) => connection.lastSeen));
    const connected = connections.some((connection) => connection.connected && now - connection.lastSeen < 12_000);
    return [playerId, { ...player, connected, lastSeen: latestSeen } satisfies OnlinePlayer];
  }));
  return { ...room, players, presence };
};

export const getRoomSnapshot = async (rawCode: string): Promise<Room | null> => {
  const code = normalizeCode(rawCode);
  const client = requireSupabaseClient();
  const { data: roomRow, error } = await client.from('rooms').select('state,version').eq('code', code).maybeSingle();
  if (error) throwPostgrest(error, 'No se pudo abrir la sala.');
  if (!roomRow) return null;
  const row = roomRow as RoomRow;
  const [commands, receipts, presenceRows] = await Promise.all([
    tableRows<CommandRow>('room_commands', code),
    tableRows<ReceiptRow>('room_command_receipts', code),
    tableRows<PresenceRow>('room_presence', code),
  ]);
  const state = asRecord(row.state) as unknown as Room;
  const commandMap: Record<string, CommandEnvelope> = Object.fromEntries(commands.map((entry) => [
    entry.slot_key,
    { command: entry.command as GameCommand, submittedByUid: entry.submitted_by_uid, submittedAt: asNumber(entry.submitted_at) },
  ]));
  const receiptMap: Record<string, CommandReceipt> = Object.fromEntries(receipts.map((entry) => [
    entry.command_id,
    {
      commandId: entry.command_id,
      submittedByUid: entry.submitted_by_uid,
      status: entry.status,
      updatedAt: asNumber(entry.updated_at),
      ...(entry.revision === null ? {} : { revision: asNumber(entry.revision) }),
      ...(entry.error === null ? {} : { error: entry.error }),
    } satisfies CommandReceipt,
  ]));
  const hydrated = hydrateRoom({
    ...state,
    commands: commandMap,
    commandReceipts: receiptMap,
    presence: state.presence ?? {},
    transportVersion: asNumber(row.version),
  });
  return mergePresence(hydrated, presenceRows);
};

export const subscribeToRoom = (rawCode: string, onChange: () => void, onError: (error: Error) => void): (() => void) => {
  const code = normalizeCode(rawCode);
  const client = requireSupabaseClient();
  const channel = client
    .channel(`room:${code}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_code=eq.${code}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_presence', filter: `room_code=eq.${code}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_commands', filter: `room_code=eq.${code}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_command_receipts', filter: `room_code=eq.${code}` }, onChange)
    .subscribe((status) => {
      const channelStatus = String(status);
      if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') onError(new Error('Supabase perdió el canal en tiempo real.'));
    });
  return () => { void client.removeChannel(channel); };
};

export const createRoomRecord = async (code: string, state: Room, playerId: string, displayName: string, joinedAt: number): Promise<boolean> => {
  const result = await callRpc<{ readonly created?: unknown }>('create_room', {
    p_code: normalizeCode(code),
    p_state: state,
    p_player_id: playerId,
    p_display_name: displayName,
    p_joined_at: joinedAt,
  });
  return result.created === true;
};

export const joinRoomRecord = async (code: string, playerId: string, displayName: string, joinedAt: number): Promise<{ readonly existing: boolean; readonly playerId: string; readonly seat: number }> => {
  const result = await callRpc<{ readonly existing?: unknown; readonly playerId?: unknown; readonly seat?: unknown }>('join_room', {
    p_code: normalizeCode(code), p_player_id: playerId, p_display_name: displayName, p_joined_at: joinedAt,
  });
  if (typeof result.playerId !== 'string' || !Number.isInteger(result.seat)) throw new Error('Supabase devolvió un asiento inválido.');
  return { existing: result.existing === true, playerId: result.playerId, seat: Number(result.seat) };
};

export const saveSeatProof = async (code: string, seat: number, proofHash: string): Promise<void> => {
  await callRpc('upsert_seat_proof', { p_code: normalizeCode(code), p_seat_number: seat, p_proof_hash: proofHash });
};

export const updatePresence = async (code: string, playerId: string, connectionId: string, now: number): Promise<void> => {
  await callRpc('upsert_presence', { p_code: normalizeCode(code), p_player_id: playerId, p_connection_id: connectionId, p_now: now });
};

export const setPresenceOffline = async (code: string, playerId: string, connectionId: string, now: number): Promise<void> => {
  await callRpc('mark_presence_offline', { p_code: normalizeCode(code), p_player_id: playerId, p_connection_id: connectionId, p_now: now });
};

export const claimReconnect = async (code: string, proofHash: string): Promise<{ readonly playerId: string; readonly seat: number }> => {
  const result = await callRpc<{ readonly playerId?: unknown; readonly seat?: unknown }>('claim_reconnect', { p_code: normalizeCode(code), p_proof_hash: proofHash });
  if (typeof result.playerId !== 'string' || !Number.isInteger(result.seat)) throw new Error('Supabase no confirmó el asiento recuperado.');
  return { playerId: result.playerId, seat: Number(result.seat) };
};

export const acquireLeaseRecord = async (code: string): Promise<{ readonly acquired: boolean; readonly lease?: Room['coordinator']; readonly version?: number }> => {
  const result = await callRpc<{ readonly acquired?: unknown; readonly lease?: unknown; readonly version?: unknown }>('acquire_coordinator_lease', { p_code: normalizeCode(code), p_duration_ms: 12_000 });
  return { acquired: result.acquired === true, ...(result.lease ? { lease: result.lease as Room['coordinator'] } : {}), ...(result.version === undefined ? {} : { version: asNumber(result.version) }) };
};

export const renewLeaseRecord = async (code: string, epoch: number): Promise<boolean> => {
  const result = await callRpc<{ readonly renewed?: unknown }>('renew_coordinator_lease', { p_code: normalizeCode(code), p_epoch: epoch, p_duration_ms: 12_000 });
  return result.renewed === true;
};

export const enqueueCommandRecord = async (code: string, slotKey: string, command: GameCommand): Promise<boolean> => {
  const result = await callRpc<{ readonly queued?: unknown }>('enqueue_room_command', { p_code: normalizeCode(code), p_slot_key: slotKey, p_command_id: command.commandId, p_command: command });
  return result.queued === true;
};

export const applyRoomStateRecord = async (code: string, expectedVersion: number, epoch: number, state: Room, commandId: string | null, slotKey: string | null, receipt: CommandReceipt | null): Promise<{ readonly applied: boolean; readonly reason?: string }> => {
  const result = await callRpc<{ readonly applied?: unknown; readonly reason?: unknown }>('apply_room_state', {
    p_code: normalizeCode(code),
    p_expected_version: expectedVersion,
    p_coordinator_epoch: epoch,
    p_state: state,
    p_command_id: commandId,
    p_slot_key: slotKey,
    p_receipt: receipt,
  });
  return { applied: result.applied === true, ...(typeof result.reason === 'string' ? { reason: result.reason } : {}) };
};

export const startRoomRecord = async (code: string, expectedVersion: number, state: Room): Promise<boolean> => {
  const result = await callRpc<{ readonly started?: unknown }>('start_room', { p_code: normalizeCode(code), p_expected_version: expectedVersion, p_state: state });
  return result.started === true;
};

export const endRoomRecord = async (code: string, expectedVersion: number, epoch: number): Promise<boolean> => {
  const result = await callRpc<{ readonly ended?: unknown }>('end_room', { p_code: normalizeCode(code), p_expected_version: expectedVersion, p_coordinator_epoch: epoch });
  return result.ended === true;
};
