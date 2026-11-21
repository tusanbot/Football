-- Legends Draft persistence (Supabase-native PostgreSQL).
-- All draft picks are serialized by a row lock and guarded by expected_version.
create table if not exists public.legends_draft_challenges (
  id text primary key,
  creator_user_id text not null references public."User"(id) on delete restrict,
  opponent_user_id text references public."User"(id) on delete restrict,
  status text not null default 'INVITED'
    check (status in ('INVITED','DRAFTING','LINEUP','RUNNING','COMPLETED','CANCELLED','EXPIRED')),
  player_pool jsonb not null check (jsonb_typeof(player_pool) = 'array'),
  current_pick_number smallint not null default 1 check (current_pick_number between 1 and 11),
  creator_formation text check (creator_formation in ('2-2','1-2-1','1-1-2','2-1-1')),
  opponent_formation text check (opponent_formation in ('2-2','1-2-1','1-1-2','2-1-1')),
  match_id text,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  check (opponent_user_id is null or opponent_user_id <> creator_user_id)
);

create index if not exists legends_draft_invited_expiry_idx
  on public.legends_draft_challenges (expires_at) where status = 'INVITED';
create index if not exists legends_draft_participant_status_idx
  on public.legends_draft_challenges (creator_user_id, status, created_at desc);
create index if not exists legends_draft_opponent_status_idx
  on public.legends_draft_challenges (opponent_user_id, status, created_at desc);

create table if not exists public.legends_draft_picks (
  id bigint generated always as identity primary key,
  challenge_id text not null references public.legends_draft_challenges(id) on delete cascade,
  pick_number smallint not null check (pick_number between 1 and 10),
  user_id text not null references public."User"(id) on delete restrict,
  player_id text not null,
  player_snapshot jsonb not null check (jsonb_typeof(player_snapshot) = 'object'),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (challenge_id, pick_number),
  unique (challenge_id, player_id),
  unique (challenge_id, user_id, idempotency_key)
);
create index if not exists legends_draft_picks_user_idx
  on public.legends_draft_picks (user_id, challenge_id);

create or replace function public.legends_draft_pick(
  p_challenge_id text,
  p_user_id text,
  p_player_id text,
  p_idempotency_key text,
  p_expected_version integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.legends_draft_challenges%rowtype;
  v_existing public.legends_draft_picks%rowtype;
  v_player jsonb;
  v_user_picks integer;
  v_user_gk integer;
  v_user_outfield integer;
  v_expected_user text;
  v_pick_number integer;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'DRAFT_IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;

  select * into v_challenge
    from public.legends_draft_challenges
   where id = p_challenge_id
   for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_existing
    from public.legends_draft_picks
   where challenge_id = p_challenge_id and user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('pick', to_jsonb(v_existing), 'version', v_challenge.version, 'replayed', true);
  end if;
  if v_challenge.status <> 'DRAFTING' then raise exception 'DRAFT_NOT_ACTIVE' using errcode = '55000'; end if;
  if v_challenge.expires_at <= now() then raise exception 'DRAFT_EXPIRED' using errcode = '55000'; end if;
  if v_challenge.version <> p_expected_version then raise exception 'DRAFT_VERSION_CONFLICT' using errcode = '40001'; end if;
  if v_challenge.opponent_user_id is null then raise exception 'DRAFT_OPPONENT_NOT_ACCEPTED' using errcode = '55000'; end if;

  v_expected_user := case when v_challenge.current_pick_number % 2 = 1
    then v_challenge.creator_user_id else v_challenge.opponent_user_id end;
  if p_user_id <> v_expected_user then raise exception 'DRAFT_NOT_YOUR_TURN' using errcode = '42501'; end if;

  select item.player into v_player
    from jsonb_array_elements(v_challenge.player_pool) as item(player)
   where item.player->>'id' = p_player_id;
  if v_player is null then raise exception 'DRAFT_PLAYER_NOT_IN_POOL' using errcode = '22023'; end if;
  if exists (select 1 from public.legends_draft_picks where challenge_id = p_challenge_id and player_id = p_player_id) then
    raise exception 'DRAFT_PLAYER_ALREADY_PICKED' using errcode = '23505';
  end if;

  select count(*),
         count(*) filter (where player_snapshot->>'line' = 'GK'),
         count(*) filter (where player_snapshot->>'line' <> 'GK')
    into v_user_picks, v_user_gk, v_user_outfield
    from public.legends_draft_picks
   where challenge_id = p_challenge_id and user_id = p_user_id;
  if v_player->>'line' = 'GK' and v_user_gk > 0 then raise exception 'DRAFT_TEAM_ALREADY_HAS_GOALKEEPER' using errcode = '22023'; end if;
  if v_player->>'line' <> 'GK' and v_user_outfield >= 4 then raise exception 'DRAFT_TEAM_ALREADY_HAS_FOUR_OUTFIELD_PLAYERS' using errcode = '22023'; end if;
  if v_user_picks = 4 and ((v_user_gk = 0 and v_player->>'line' <> 'GK') or (v_user_outfield < 4 and v_player->>'line' = 'GK')) then
    raise exception 'DRAFT_PICK_MUST_COMPLETE_TEAM_ROSTER' using errcode = '22023';
  end if;

  v_pick_number := v_challenge.current_pick_number;
  insert into public.legends_draft_picks
    (challenge_id, pick_number, user_id, player_id, player_snapshot, idempotency_key)
  values (p_challenge_id, v_pick_number, p_user_id, p_player_id, v_player, p_idempotency_key)
  returning * into v_existing;

  update public.legends_draft_challenges
     set current_pick_number = current_pick_number + 1,
         status = case when current_pick_number = 10 then 'LINEUP' else 'DRAFTING' end,
         version = version + 1,
         updated_at = now()
   where id = p_challenge_id
   returning * into v_challenge;
  return jsonb_build_object('pick', to_jsonb(v_existing), 'version', v_challenge.version, 'status', v_challenge.status, 'replayed', false);
end;
$$;

revoke all on function public.legends_draft_pick(text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.legends_draft_pick(text,text,text,text,integer) to service_role;
alter table public.legends_draft_challenges enable row level security;
alter table public.legends_draft_picks enable row level security;
revoke all on public.legends_draft_challenges from anon, authenticated;
revoke all on public.legends_draft_picks from anon, authenticated;
grant select, insert, update, delete on public.legends_draft_challenges to service_role;
grant select, insert, update, delete on public.legends_draft_picks to service_role;
grant usage, select on sequence public.legends_draft_picks_id_seq to service_role;
