-- Persist Legends Draft results independently from official/local league matches.
-- Group "latest result" is a pointer only; historical results and player records remain durable.
alter table public.legends_draft_challenges
  add column if not exists telegram_group_id text;

create table if not exists public.legends_draft_match_results (
  id text primary key,
  challenge_id text not null unique references public.legends_draft_challenges(id) on delete restrict,
  telegram_group_id text,
  creator_user_id text not null references public."User"(id) on delete restrict,
  opponent_user_id text not null references public."User"(id) on delete restrict,
  home_score integer not null check (home_score >= 0),
  away_score integer not null check (away_score >= 0),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  completed_at timestamptz not null default now(),
  check (creator_user_id <> opponent_user_id)
);
create index if not exists legends_draft_results_group_recent_idx
  on public.legends_draft_match_results (telegram_group_id, completed_at desc)
  where telegram_group_id is not null;

create table if not exists public.legends_draft_group_latest_results (
  telegram_group_id text primary key,
  challenge_id text not null references public.legends_draft_challenges(id) on delete restrict,
  result_id text not null references public.legends_draft_match_results(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table if not exists public.legends_draft_player_records (
  user_id text primary key references public."User"(id) on delete restrict,
  wins bigint not null default 0 check (wins >= 0),
  losses bigint not null default 0 check (losses >= 0),
  draws bigint not null default 0 check (draws >= 0),
  matches bigint not null default 0 check (matches >= 0),
  updated_at timestamptz not null default now(),
  check (matches = wins + losses + draws)
);

-- A newly created draft replaces only the group's visible latest-result pointer.
-- Existing result rows and cumulative player records are intentionally retained.
create or replace function public.legends_draft_clear_group_latest_on_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.telegram_group_id is not null then
    delete from public.legends_draft_group_latest_results
     where telegram_group_id = new.telegram_group_id;
  end if;
  return new;
end;
$$;

drop trigger if exists legends_draft_clear_group_latest_on_create
  on public.legends_draft_challenges;
create trigger legends_draft_clear_group_latest_on_create
after insert on public.legends_draft_challenges
for each row execute function public.legends_draft_clear_group_latest_on_create();

create or replace function public.legends_draft_complete_match(
  p_challenge_id text,
  p_user_id text,
  p_match_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.legends_draft_challenges%rowtype;
  v_match_id text;
  v_result_id text;
  v_home_score integer;
  v_away_score integer;
  v_winner text;
begin
  if p_user_id is null or btrim(p_user_id) = '' then
    raise exception 'DRAFT_NOT_PARTICIPANT' using errcode = '42501';
  end if;
  if p_match_result is null or jsonb_typeof(p_match_result) is distinct from 'object'
    or jsonb_typeof(p_match_result->'homeScore') is distinct from 'number'
    or jsonb_typeof(p_match_result->'awayScore') is distinct from 'number'
    or jsonb_typeof(p_match_result->'events') is distinct from 'array'
    or jsonb_typeof(p_match_result->'performances') is distinct from 'array' then
    raise exception 'DRAFT_MATCH_RESULT_INVALID' using errcode = '22023';
  end if;
  if (p_match_result->>'homeScore')::numeric < 0
    or (p_match_result->>'awayScore')::numeric < 0
    or (p_match_result->>'homeScore')::numeric <> trunc((p_match_result->>'homeScore')::numeric)
    or (p_match_result->>'awayScore')::numeric <> trunc((p_match_result->>'awayScore')::numeric)
    or (p_match_result->>'homeScore')::numeric > 2147483647
    or (p_match_result->>'awayScore')::numeric > 2147483647 then
    raise exception 'DRAFT_MATCH_RESULT_INVALID' using errcode = '22023';
  end if;

  select * into v_challenge
    from public.legends_draft_challenges
   where id = p_challenge_id
   for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_user_id not in (v_challenge.creator_user_id, v_challenge.opponent_user_id) then
    raise exception 'DRAFT_NOT_PARTICIPANT' using errcode = '42501';
  end if;

  if v_challenge.status = 'COMPLETED' and v_challenge.match_result is not null then
    return jsonb_build_object('matchId', v_challenge.match_id, 'result', v_challenge.match_result, 'replayed', true);
  end if;
  if v_challenge.status <> 'LINEUP' or v_challenge.creator_formation is null
    or v_challenge.opponent_formation is null then
    raise exception 'DRAFT_NOT_READY_TO_PLAY' using errcode = '55000';
  end if;
  if v_challenge.expires_at <= now() then
    raise exception 'DRAFT_EXPIRED' using errcode = '55000';
  end if;
  if (select count(*) from public.legends_draft_picks where challenge_id = p_challenge_id) <> 10 then
    raise exception 'DRAFT_NOT_READY_TO_PLAY' using errcode = '55000';
  end if;

  v_home_score := (p_match_result->>'homeScore')::integer;
  v_away_score := (p_match_result->>'awayScore')::integer;
  v_match_id := coalesce(v_challenge.match_id, 'draft_match_' || replace(gen_random_uuid()::text, '-', ''));
  v_result_id := 'draft_result_' || replace(gen_random_uuid()::text, '-', '');
  v_winner := case when v_home_score > v_away_score then v_challenge.creator_user_id
                   when v_away_score > v_home_score then v_challenge.opponent_user_id
                   else null end;

  insert into public.legends_draft_match_results
    (id, challenge_id, telegram_group_id, creator_user_id, opponent_user_id,
     home_score, away_score, result, completed_at)
  values
    (v_result_id, p_challenge_id, v_challenge.telegram_group_id,
     v_challenge.creator_user_id, v_challenge.opponent_user_id,
     v_home_score, v_away_score, p_match_result, now());

  if v_winner is null then
    insert into public.legends_draft_player_records (user_id, draws, matches, updated_at)
    values (v_challenge.creator_user_id, 1, 1, now()), (v_challenge.opponent_user_id, 1, 1, now())
    on conflict (user_id) do update set draws = public.legends_draft_player_records.draws + 1,
      matches = public.legends_draft_player_records.matches + 1, updated_at = now();
  else
    insert into public.legends_draft_player_records (user_id, wins, matches, updated_at)
    values (v_winner, 1, 1, now())
    on conflict (user_id) do update set wins = public.legends_draft_player_records.wins + 1,
      matches = public.legends_draft_player_records.matches + 1, updated_at = now();
    insert into public.legends_draft_player_records (user_id, losses, matches, updated_at)
    values (case when v_winner = v_challenge.creator_user_id then v_challenge.opponent_user_id else v_challenge.creator_user_id end, 1, 1, now())
    on conflict (user_id) do update set losses = public.legends_draft_player_records.losses + 1,
      matches = public.legends_draft_player_records.matches + 1, updated_at = now();
  end if;

  if v_challenge.telegram_group_id is not null then
    insert into public.legends_draft_group_latest_results
      (telegram_group_id, challenge_id, result_id, updated_at)
    values (v_challenge.telegram_group_id, p_challenge_id, v_result_id, now())
    on conflict (telegram_group_id) do update set challenge_id = excluded.challenge_id,
      result_id = excluded.result_id, updated_at = excluded.updated_at;
  end if;

  update public.legends_draft_challenges
     set status = 'COMPLETED', match_id = v_match_id, match_result = p_match_result,
         completed_at = now(), version = version + 1, updated_at = now()
   where id = p_challenge_id;

  return jsonb_build_object('matchId', v_match_id, 'resultId', v_result_id,
    'result', p_match_result, 'replayed', false);
end;
$$;

alter table public.legends_draft_match_results enable row level security;
alter table public.legends_draft_group_latest_results enable row level security;
alter table public.legends_draft_player_records enable row level security;
revoke all on public.legends_draft_match_results from anon, authenticated;
revoke all on public.legends_draft_group_latest_results from anon, authenticated;
revoke all on public.legends_draft_player_records from anon, authenticated;
grant select, insert, update, delete on public.legends_draft_match_results to service_role;
grant select, insert, update, delete on public.legends_draft_group_latest_results to service_role;
grant select, insert, update, delete on public.legends_draft_player_records to service_role;
revoke all on function public.legends_draft_clear_group_latest_on_create() from public, anon, authenticated;
revoke all on function public.legends_draft_complete_match(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.legends_draft_complete_match(text,text,jsonb) to service_role;
