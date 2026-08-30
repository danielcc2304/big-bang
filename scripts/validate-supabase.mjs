import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/0001_online.sql', import.meta.url), 'utf8');
const requiredTables = [
  'rooms',
  'room_members',
  'room_presence',
  'seat_proofs',
  'reconnect_claims',
  'room_commands',
  'room_command_receipts',
];
const requiredFunctions = [
  'server_now_ms',
  'create_room',
  'join_room',
  'upsert_seat_proof',
  'upsert_presence',
  'mark_presence_offline',
  'claim_reconnect',
  'acquire_coordinator_lease',
  'renew_coordinator_lease',
  'enqueue_room_command',
  'apply_room_state',
  'start_room',
  'end_room',
];

for (const table of requiredTables) {
  if (!new RegExp(`create table if not exists public\\.${table}\\b`, 'i').test(migration)) throw new Error(`Falta la tabla Supabase ${table}.`);
}
for (const fn of requiredFunctions) {
  if (!new RegExp(`function public\\.${fn}\\b`, 'i').test(migration)) throw new Error(`Falta la función RPC ${fn}.`);
}
if ((migration.match(/enable row level security/gi) ?? []).length < requiredTables.length) throw new Error('Todas las tablas online deben tener RLS activado.');
if ((migration.match(/security definer/gi) ?? []).length < requiredFunctions.length - 1) throw new Error('Las mutaciones online deben ejecutarse mediante RPC SECURITY DEFINER.');
if (!migration.includes("set search_path = ''")) throw new Error('Las funciones SECURITY DEFINER deben fijar search_path.');
if (!migration.includes('supabase_realtime')) throw new Error('Las tablas online deben publicarse en Supabase Realtime.');
if (!migration.includes('revoke insert, update, delete')) throw new Error('Las escrituras directas deben estar revocadas.');
console.log('Supabase online schema: OK');
