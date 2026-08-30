-- Supabase persistence for the online game.
--
-- The game engine still owns the complete canonical state. PostgreSQL owns the
-- concurrency boundaries around that state: one versioned room row, an
-- append-only command queue, leases and explicit presence heartbeats. Every
-- state mutation goes through a SECURITY DEFINER RPC so a browser cannot
-- bypass the coordinator or impersonate another seat.

create extension if not exists pgcrypto;

create schema if not exists private;

create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-Z0-9]{4,6}$'),
  host_uid text not null,
  status text not null check (status in ('LOBBY', 'PLAYING', 'ENDED')),
  max_players smallint not null check (max_players between 4 and 7),
  character_mode text not null check (character_mode in ('OFFICIAL', 'DRAFT_TWO')),
  state jsonb not null,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.room_members (
  room_code text not null references public.rooms(code) on delete cascade,
  player_id text not null,
  seat_number smallint not null check (seat_number between 0 and 6),
  uid text,
  display_name text not null check (char_length(display_name) between 1 and 80),
  is_bot boolean not null default false,
  reconnect_hash text,
  joined_at bigint not null,
  primary key (room_code, player_id),
  unique (room_code, seat_number),
  unique (room_code, uid)
);

create table if not exists public.room_presence (
  room_code text not null references public.rooms(code) on delete cascade,
  player_id text not null,
  connection_id text not null,
  uid text not null,
  connected boolean not null default true,
  connected_at bigint not null,
  last_seen bigint not null,
  primary key (room_code, player_id, connection_id)
);

create table if not exists public.seat_proofs (
  room_code text not null references public.rooms(code) on delete cascade,
  seat_number smallint not null check (seat_number between 0 and 6),
  proof_hash text not null,
  primary key (room_code, seat_number),
  unique (room_code, proof_hash)
);

create table if not exists public.reconnect_claims (
  room_code text not null references public.rooms(code) on delete cascade,
  uid text not null,
  proof_hash text not null,
  requested_at bigint not null,
  primary key (room_code, uid)
);

create table if not exists public.room_commands (
  room_code text not null references public.rooms(code) on delete cascade,
  slot_key text not null check (slot_key ~ '^slot-[0-9]{1,3}$'),
  command_id text not null,
  command jsonb not null,
  submitted_by_uid text not null,
  submitted_at bigint not null,
  primary key (room_code, slot_key),
  unique (room_code, command_id)
);

create table if not exists public.room_command_receipts (
  room_code text not null references public.rooms(code) on delete cascade,
  command_id text not null,
  submitted_by_uid text not null,
  status text not null check (status in ('APPLIED', 'REJECTED')),
  updated_at bigint not null,
  revision bigint,
  error text,
  primary key (room_code, command_id)
);

create index if not exists room_members_uid_idx on public.room_members(uid);
create index if not exists room_presence_room_player_idx on public.room_presence(room_code, player_id);
create index if not exists room_commands_room_submitted_idx on public.room_commands(room_code, submitted_at);
create index if not exists room_receipts_room_updated_idx on public.room_command_receipts(room_code, updated_at);

create or replace function public.set_room_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
before update on public.rooms
for each row execute function public.set_room_updated_at();

create or replace function public.server_now_ms()
returns bigint
language sql
stable
as $$
  select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

-- SECURITY DEFINER helpers deliberately use an empty search_path. This keeps
-- auth and public objects explicit and prevents search_path hijacking.
create or replace function private.is_room_member(p_room_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members
    where room_code = p_room_code
      and uid = (select auth.uid())::text
  );
$$;

create or replace function private.can_read_room(p_room_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rooms
    where code = p_room_code
      and (
        status = 'LOBBY'
        or host_uid = (select auth.uid())::text
        or private.is_room_member(p_room_code)
      )
  );
$$;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_presence enable row level security;
alter table public.seat_proofs enable row level security;
alter table public.reconnect_claims enable row level security;
alter table public.room_commands enable row level security;
alter table public.room_command_receipts enable row level security;

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms
for select to authenticated
using (private.can_read_room(code));

drop policy if exists room_members_read on public.room_members;
create policy room_members_read on public.room_members
for select to authenticated
using (private.can_read_room(room_code));

drop policy if exists room_presence_read on public.room_presence;
create policy room_presence_read on public.room_presence
for select to authenticated
using (private.can_read_room(room_code));

-- Proof hashes are intentionally not readable from the browser. Reconnection
-- compares them inside claim_reconnect() under the definer's transaction.
drop policy if exists seat_proofs_read on public.seat_proofs;

drop policy if exists room_commands_read on public.room_commands;
create policy room_commands_read on public.room_commands
for select to authenticated
using (private.can_read_room(room_code));

drop policy if exists room_receipts_read on public.room_command_receipts;
create policy room_receipts_read on public.room_command_receipts
for select to authenticated
using (private.can_read_room(room_code));

-- No browser receives direct writes to any online table. The RPCs below are
-- the only mutation surface and are granted after all definitions.
revoke insert, update, delete on public.rooms from anon, authenticated;
revoke insert, update, delete on public.room_members from anon, authenticated;
revoke insert, update, delete on public.room_presence from anon, authenticated;
revoke insert, update, delete on public.seat_proofs from anon, authenticated;
revoke insert, update, delete on public.reconnect_claims from anon, authenticated;
revoke insert, update, delete on public.room_commands from anon, authenticated;
revoke insert, update, delete on public.room_command_receipts from anon, authenticated;

create or replace function public.create_room(
  p_code text,
  p_state jsonb,
  p_player_id text,
  p_display_name text,
  p_joined_at bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_state jsonb;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_code is null or p_code !~ '^[A-Z0-9]{4,6}$' then raise exception 'invalid_room_code'; end if;
  if p_state is null or p_state->'seats' is null or p_state->'players' is null then raise exception 'invalid_room_state'; end if;

  v_state := p_state
    || jsonb_build_object(
      'code', p_code,
      'hostUid', v_uid,
      'status', 'LOBBY',
      'createdAt', p_joined_at,
      'commands', '{}'::jsonb,
      'commandReceipts', '{}'::jsonb,
      'presence', '{}'::jsonb
    );
  v_state := jsonb_set(v_state, '{coordinator}', jsonb_build_object(
    'coordinatorId', v_uid,
    'coordinatorEpoch', 1,
    'leaseUntil', p_joined_at + 12000,
    'heartbeat', p_joined_at
  ), true);
  v_state := jsonb_set(v_state, '{seats,0,ownerUid}', to_jsonb(v_uid), true);
  v_state := jsonb_set(v_state, array['seats','0','playerId'], to_jsonb(p_player_id), true);
  v_state := jsonb_set(v_state, array['players',p_player_id,'uid'], to_jsonb(v_uid), true);
  v_state := jsonb_set(v_state, array['players',p_player_id,'displayName'], to_jsonb(left(trim(p_display_name), 80)), true);

  insert into public.rooms(code, host_uid, status, max_players, character_mode, state)
  values (
    p_code,
    v_uid,
    'LOBBY',
    (v_state->>'maxPlayers')::smallint,
    v_state->>'characterMode',
    v_state - 'transportVersion'
  );

  insert into public.room_members(room_code, player_id, seat_number, uid, display_name, is_bot, joined_at)
  values (p_code, p_player_id, 0, v_uid, left(trim(p_display_name), 80), false, p_joined_at);

  return jsonb_build_object('created', true, 'version', 0);
exception
  when unique_violation then
    return jsonb_build_object('created', false);
end;
$$;

create or replace function public.join_room(
  p_code text,
  p_player_id text,
  p_display_name text,
  p_joined_at bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_room public.rooms%rowtype;
  v_existing public.room_members%rowtype;
  v_seat integer;
  v_state jsonb;
  v_display_name text := left(trim(p_display_name), 80);
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  select * into v_room from public.rooms where code = upper(p_code) for update;
  if not found or v_room.status <> 'LOBBY' then raise exception 'room_unavailable'; end if;

  select * into v_existing from public.room_members where room_code = v_room.code and uid = v_uid limit 1;
  if found then
    return jsonb_build_object('joined', true, 'existing', true, 'seat', v_existing.seat_number, 'playerId', v_existing.player_id, 'version', v_room.version);
  end if;

  select candidate into v_seat
  from generate_series(0, v_room.max_players - 1) as candidate
  where not exists (
    select 1 from public.room_members
    where room_code = v_room.code and seat_number = candidate
  )
  order by candidate
  limit 1;
  if v_seat is null then raise exception 'room_full'; end if;

  v_state := v_room.state;
  v_state := jsonb_set(v_state, array['seats',v_seat::text], jsonb_build_object(
    'number', v_seat,
    'playerId', p_player_id,
    'ownerUid', v_uid,
    'reconnectHash', null,
    'isBot', false,
    'joinedAt', p_joined_at
  ), true);
  v_state := jsonb_set(v_state, array['players',p_player_id], jsonb_build_object(
    'uid', v_uid,
    'playerId', p_player_id,
    'displayName', v_display_name,
    'connected', true,
    'lastSeen', p_joined_at
  ), true);
  update public.rooms
  set state = v_state, version = version + 1
  where code = v_room.code;

  insert into public.room_members(room_code, player_id, seat_number, uid, display_name, is_bot, joined_at)
  values (v_room.code, p_player_id, v_seat, v_uid, v_display_name, false, p_joined_at);
  return jsonb_build_object('joined', true, 'existing', false, 'seat', v_seat, 'playerId', p_player_id, 'version', v_room.version + 1);
end;
$$;

create or replace function public.upsert_seat_proof(
  p_code text,
  p_seat_number smallint,
  p_proof_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.room_members
    where room_code = upper(p_code) and seat_number = p_seat_number and uid = (select auth.uid())::text
  ) then raise exception 'seat_not_owned'; end if;
  insert into public.seat_proofs(room_code, seat_number, proof_hash)
  values (upper(p_code), p_seat_number, p_proof_hash)
  on conflict (room_code, seat_number) do update set proof_hash = excluded.proof_hash;
  return true;
end;
$$;

create or replace function public.upsert_presence(
  p_code text,
  p_player_id text,
  p_connection_id text,
  p_now bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
begin
  if not exists (
    select 1 from public.room_members
    where room_code = upper(p_code) and player_id = p_player_id and uid = v_uid
  ) then raise exception 'seat_not_owned'; end if;
  delete from public.room_presence where room_code = upper(p_code) and last_seen < p_now - 300000;
  insert into public.room_presence(room_code, player_id, connection_id, uid, connected, connected_at, last_seen)
  values (upper(p_code), p_player_id, p_connection_id, v_uid, true, p_now, p_now)
  on conflict (room_code, player_id, connection_id) do update
    set uid = excluded.uid, connected = true, last_seen = excluded.last_seen;
  return true;
end;
$$;

create or replace function public.mark_presence_offline(
  p_code text,
  p_player_id text,
  p_connection_id text,
  p_now bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_presence
  set connected = false, last_seen = p_now
  where room_code = upper(p_code)
    and player_id = p_player_id
    and connection_id = p_connection_id
    and uid = (select auth.uid())::text;
  return true;
end;
$$;

create or replace function public.claim_reconnect(
  p_code text,
  p_proof_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_now bigint := public.server_now_ms();
  v_room public.rooms%rowtype;
  v_proof public.seat_proofs%rowtype;
  v_member public.room_members%rowtype;
  v_state jsonb;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  select * into v_room from public.rooms where code = upper(p_code) for update;
  if not found or v_room.status = 'ENDED' then raise exception 'room_unavailable'; end if;
  select * into v_proof from public.seat_proofs where room_code = v_room.code and proof_hash = p_proof_hash limit 1;
  if not found then raise exception 'invalid_reconnect_token'; end if;
  select * into v_member from public.room_members where room_code = v_room.code and seat_number = v_proof.seat_number for update;
  if not found then raise exception 'seat_unavailable'; end if;
  if v_member.uid = v_uid then
    return jsonb_build_object('reconnected', true, 'playerId', v_member.player_id, 'seat', v_member.seat_number, 'version', v_room.version);
  end if;
  if exists (
    select 1 from public.room_presence
    where room_code = v_room.code and player_id = v_member.player_id and uid = v_member.uid
      and connected and v_now - last_seen < 12000
  ) then raise exception 'seat_still_connected'; end if;

  v_state := jsonb_set(v_room.state, array['seats',v_member.seat_number::text,'ownerUid'], to_jsonb(v_uid), true);
  v_state := jsonb_set(v_state, array['players',v_member.player_id,'uid'], to_jsonb(v_uid), true);
  v_state := jsonb_set(v_state, array['players',v_member.player_id,'connected'], 'true'::jsonb, true);
  v_state := jsonb_set(v_state, array['players',v_member.player_id,'lastSeen'], to_jsonb(v_now), true);
  update public.rooms set state = v_state, version = version + 1 where code = v_room.code;
  update public.room_members set uid = v_uid where room_code = v_room.code and player_id = v_member.player_id;
  delete from public.reconnect_claims where room_code = v_room.code and uid = v_uid;
  return jsonb_build_object('reconnected', true, 'playerId', v_member.player_id, 'seat', v_member.seat_number, 'version', v_room.version + 1);
end;
$$;

create or replace function public.acquire_coordinator_lease(
  p_code text,
  p_duration_ms bigint default 12000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_now bigint := public.server_now_ms();
  v_room public.rooms%rowtype;
  v_current jsonb;
  v_epoch bigint;
  v_lease jsonb;
begin
  select * into v_room from public.rooms where code = upper(p_code) for update;
  if not found or v_room.status = 'ENDED' then return jsonb_build_object('acquired', false); end if;
  v_current := coalesce(v_room.state->'coordinator', '{}'::jsonb);
  if coalesce(v_current->>'coordinatorId', '') <> ''
     and v_current->>'coordinatorId' <> v_uid
     and coalesce((v_current->>'leaseUntil')::bigint, 0) > v_now then
    return jsonb_build_object('acquired', false);
  end if;
  v_epoch := coalesce((v_current->>'coordinatorEpoch')::bigint, 0)
    + case when v_current->>'coordinatorId' = v_uid then 0 else 1 end;
  v_lease := jsonb_build_object(
    'coordinatorId', v_uid,
    'coordinatorEpoch', v_epoch,
    'leaseUntil', v_now + greatest(p_duration_ms, 1000),
    'heartbeat', v_now
  );
  update public.rooms
  set state = jsonb_set(v_room.state, '{coordinator}', v_lease, true), version = version + 1
  where code = v_room.code;
  return jsonb_build_object('acquired', true, 'lease', v_lease, 'version', v_room.version + 1);
end;
$$;

create or replace function public.renew_coordinator_lease(
  p_code text,
  p_epoch bigint,
  p_duration_ms bigint default 12000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_now bigint := public.server_now_ms();
  v_room public.rooms%rowtype;
  v_current jsonb;
  v_lease jsonb;
begin
  select * into v_room from public.rooms where code = upper(p_code) for update;
  if not found then return jsonb_build_object('renewed', false); end if;
  v_current := coalesce(v_room.state->'coordinator', '{}'::jsonb);
  if v_current->>'coordinatorId' <> v_uid
     or coalesce((v_current->>'coordinatorEpoch')::bigint, -1) <> p_epoch
     or coalesce((v_current->>'leaseUntil')::bigint, 0) <= v_now then
    return jsonb_build_object('renewed', false);
  end if;
  v_lease := jsonb_build_object(
    'coordinatorId', v_uid,
    'coordinatorEpoch', p_epoch,
    'leaseUntil', v_now + greatest(p_duration_ms, 1000),
    'heartbeat', v_now
  );
  update public.rooms set state = jsonb_set(v_room.state, '{coordinator}', v_lease, true), version = version + 1 where code = v_room.code;
  return jsonb_build_object('renewed', true, 'lease', v_lease, 'version', v_room.version + 1);
end;
$$;

create or replace function public.enqueue_room_command(
  p_code text,
  p_slot_key text,
  p_command_id text,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_code text := upper(p_code);
  v_now bigint := public.server_now_ms();
  v_inserted boolean := false;
begin
  if not exists (select 1 from public.rooms where code = v_code and status = 'PLAYING') then raise exception 'room_unavailable'; end if;
  if not exists (
    select 1 from public.room_members
    where room_code = v_code and uid = v_uid and player_id = p_command->>'playerId'
  ) then raise exception 'seat_not_owned'; end if;
  if exists (
    select 1 from public.room_commands
    where room_code = v_code and command_id = p_command_id and submitted_by_uid = v_uid
  ) or exists (
    select 1 from public.room_command_receipts
    where room_code = v_code and command_id = p_command_id and submitted_by_uid = v_uid
  ) then
    return jsonb_build_object('queued', true, 'commandId', p_command_id, 'duplicate', true);
  end if;
  if (select count(*) from public.room_commands where room_code = v_code) >= 100 then raise exception 'command_queue_full'; end if;
  if (select count(*) from public.room_commands where room_code = v_code and submitted_by_uid = v_uid and submitted_at > v_now - 10000) >= 20 then raise exception 'command_rate_limited'; end if;
  insert into public.room_commands(room_code, slot_key, command_id, command, submitted_by_uid, submitted_at)
  values (v_code, p_slot_key, p_command_id, p_command, v_uid, v_now)
  on conflict do nothing
  returning true into v_inserted;
  return jsonb_build_object('queued', coalesce(v_inserted, false), 'commandId', p_command_id);
end;
$$;

create or replace function public.apply_room_state(
  p_code text,
  p_expected_version bigint,
  p_coordinator_epoch bigint,
  p_state jsonb,
  p_command_id text default null,
  p_slot_key text default null,
  p_receipt jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_now bigint := public.server_now_ms();
  v_room public.rooms%rowtype;
  v_lease jsonb;
  v_state jsonb;
  v_new_version bigint;
begin
  select * into v_room from public.rooms where code = upper(p_code) for update;
  if not found then return jsonb_build_object('applied', false, 'reason', 'room_missing'); end if;
  v_lease := coalesce(v_room.state->'coordinator', '{}'::jsonb);
  if v_room.version <> p_expected_version then return jsonb_build_object('applied', false, 'reason', 'version_conflict', 'version', v_room.version); end if;
  if v_lease->>'coordinatorId' <> v_uid
     or coalesce((v_lease->>'coordinatorEpoch')::bigint, -1) <> p_coordinator_epoch
     or coalesce((v_lease->>'leaseUntil')::bigint, 0) <= v_now then
    return jsonb_build_object('applied', false, 'reason', 'lease_invalid');
  end if;

  v_state := coalesce(p_state, '{}'::jsonb) - 'transportVersion' - 'commands' - 'commandReceipts' - 'presence';
  if coalesce(v_state->>'status', '') <> v_room.status then return jsonb_build_object('applied', false, 'reason', 'invalid_status_transition'); end if;
  v_state := jsonb_set(v_state, '{code}', to_jsonb(v_room.code), true);
  v_state := jsonb_set(v_state, '{hostUid}', to_jsonb(v_room.host_uid), true);
  v_state := jsonb_set(v_state, '{maxPlayers}', to_jsonb(v_room.max_players), true);
  v_state := jsonb_set(v_state, '{characterMode}', to_jsonb(v_room.character_mode), true);
  v_state := jsonb_set(v_state, '{coordinator}', v_lease, true);
  update public.rooms
  set state = v_state, status = coalesce(v_state->>'status', status), max_players = coalesce((v_state->>'maxPlayers')::smallint, max_players), character_mode = coalesce(v_state->>'characterMode', character_mode), version = version + 1
  where code = v_room.code
  returning version into v_new_version;

  if p_slot_key is not null then delete from public.room_commands where room_code = v_room.code and slot_key = p_slot_key; end if;
  if p_command_id is not null then delete from public.room_commands where room_code = v_room.code and command_id = p_command_id; end if;
  if p_receipt is not null and p_command_id is not null then
    insert into public.room_command_receipts(room_code, command_id, submitted_by_uid, status, updated_at, revision, error)
    values (v_room.code, p_command_id, coalesce(p_receipt->>'submittedByUid', v_uid), p_receipt->>'status', coalesce((p_receipt->>'updatedAt')::bigint, v_now), (p_receipt->>'revision')::bigint, p_receipt->>'error')
    on conflict (room_code, command_id) do update set submitted_by_uid = excluded.submitted_by_uid, status = excluded.status, updated_at = excluded.updated_at, revision = excluded.revision, error = excluded.error;
    delete from public.room_command_receipts where room_code = v_room.code and command_id in (
      select command_id from public.room_command_receipts where room_code = v_room.code order by updated_at desc offset 200
    );
  end if;
  return jsonb_build_object('applied', true, 'version', v_new_version);
end;
$$;

create or replace function public.start_room(
  p_code text,
  p_expected_version bigint,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_room public.rooms%rowtype;
  v_state jsonb;
  v_lease jsonb;
  v_version bigint;
begin
  select * into v_room from public.rooms where code = upper(p_code) for update;
  if not found or v_room.host_uid <> v_uid or v_room.status <> 'LOBBY' or v_room.version <> p_expected_version then return jsonb_build_object('started', false); end if;
  v_state := coalesce(p_state, '{}'::jsonb) - 'transportVersion' - 'commands' - 'commandReceipts' - 'presence';
  if coalesce(v_state->>'status', '') <> 'PLAYING' or jsonb_typeof(v_state->'canonical') <> 'object' then return jsonb_build_object('started', false); end if;
  v_lease := coalesce(v_room.state->'coordinator', '{}'::jsonb);
  v_state := jsonb_set(v_state, '{coordinator}', v_lease, true);
  update public.rooms set state = v_state, status = 'PLAYING', version = version + 1 where code = v_room.code returning version into v_version;
  return jsonb_build_object('started', true, 'version', v_version);
end;
$$;

create or replace function public.end_room(
  p_code text,
  p_expected_version bigint,
  p_coordinator_epoch bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_now bigint := public.server_now_ms();
  v_room public.rooms%rowtype;
  v_lease jsonb;
  v_state jsonb;
  v_version bigint;
begin
  select * into v_room from public.rooms where code = upper(p_code) for update;
  if not found or v_room.host_uid <> v_uid or v_room.version <> p_expected_version then return jsonb_build_object('ended', false); end if;
  v_lease := coalesce(v_room.state->'coordinator', '{}'::jsonb);
  if v_lease->>'coordinatorId' <> v_uid or coalesce((v_lease->>'coordinatorEpoch')::bigint, -1) <> p_coordinator_epoch or coalesce((v_lease->>'leaseUntil')::bigint, 0) <= v_now then return jsonb_build_object('ended', false); end if;
  v_state := jsonb_set(v_room.state, '{status}', '"ENDED"'::jsonb, true);
  v_state := jsonb_set(v_state, '{endedAt}', to_jsonb(v_now), true) - 'commands' - 'commandReceipts' - 'presence';
  update public.rooms set state = v_state, status = 'ENDED', version = version + 1 where code = v_room.code returning version into v_version;
  delete from public.room_commands where room_code = v_room.code;
  return jsonb_build_object('ended', true, 'version', v_version);
end;
$$;

grant usage on schema public to authenticated;
grant select on public.rooms, public.room_members, public.room_presence, public.room_commands, public.room_command_receipts to authenticated;
grant execute on function public.server_now_ms() to authenticated;
grant execute on function public.create_room(text, jsonb, text, text, bigint) to authenticated;
grant execute on function public.join_room(text, text, text, bigint) to authenticated;
grant execute on function public.upsert_seat_proof(text, smallint, text) to authenticated;
grant execute on function public.upsert_presence(text, text, text, bigint) to authenticated;
grant execute on function public.mark_presence_offline(text, text, text, bigint) to authenticated;
grant execute on function public.claim_reconnect(text, text) to authenticated;
grant execute on function public.acquire_coordinator_lease(text, bigint) to authenticated;
grant execute on function public.renew_coordinator_lease(text, bigint, bigint) to authenticated;
grant execute on function public.enqueue_room_command(text, text, text, jsonb) to authenticated;
grant execute on function public.apply_room_state(text, bigint, bigint, jsonb, text, text, jsonb) to authenticated;
grant execute on function public.start_room(text, bigint, jsonb) to authenticated;
grant execute on function public.end_room(text, bigint, bigint) to authenticated;

-- Enable Postgres Changes for room-wide invalidation. The client always reloads
-- the complete snapshot after a change, so partial payloads never become state.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['rooms','room_members','room_presence','room_commands','room_command_receipts'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
