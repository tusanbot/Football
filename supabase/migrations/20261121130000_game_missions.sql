-- Supabase-native mission progress and atomic reward claims.
create table if not exists public.game_mission_progress (
  user_id text not null references public."User"(id) on delete cascade,
  mission_id text not null,
  mission_date date not null default (now() at time zone 'UTC')::date,
  progress integer not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, mission_id, mission_date)
);

alter table public.game_mission_progress enable row level security;
revoke all on public.game_mission_progress from anon, authenticated;
grant select, insert, update, delete on public.game_mission_progress to service_role;

create or replace function public.claim_game_mission(
  p_user_id text,
  p_mission_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_progress public.game_mission_progress%rowtype;
  v_asset public."WalletAsset";
  v_amount bigint;
begin
  if p_mission_id not in ('daily_play_1','daily_win_1','daily_goals_3','daily_train_1')
     or p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$' then
    raise exception 'MISSION_INVALID_CLAIM' using errcode = '22023';
  end if;

  insert into public.game_mission_progress(user_id, mission_id, mission_date)
  values (p_user_id, p_mission_id, (now() at time zone 'UTC')::date)
  on conflict (user_id, mission_id) do nothing;

  select * into v_progress
  from public.game_mission_progress
  where user_id = p_user_id and mission_id = p_mission_id
    and mission_date = (now() at time zone 'UTC')::date
  for update;

  if v_progress.progress < case p_mission_id
    when 'daily_play_1' then 1 when 'daily_win_1' then 1
    when 'daily_goals_3' then 3 when 'daily_train_1' then 1 end then
    raise exception 'MISSION_NOT_COMPLETED' using errcode = 'P0001';
  end if;
  if v_progress.claimed_at is not null then
    raise exception 'MISSION_ALREADY_CLAIMED' using errcode = 'P0001';
  end if;

  v_asset := case p_mission_id when 'daily_win_1' then 'GOLD'::public."WalletAsset"
    when 'daily_goals_3' then 'HONOR'::public."WalletAsset" else 'CASH'::public."WalletAsset" end;
  v_amount := case p_mission_id when 'daily_play_1' then 500
    when 'daily_win_1' then 2 when 'daily_goals_3' then 10 else 300 end;

  perform public.apply_wallet_entry(
    p_user_id, v_asset, 'CREDIT', v_amount, p_idempotency_key,
    'MISSION_REWARD', 'GAME_MISSION', p_mission_id
  );

  update public.game_mission_progress
  set claimed_at = now(), updated_at = now()
  where user_id = p_user_id and mission_id = p_mission_id
    and mission_date = (now() at time zone 'UTC')::date;

  return jsonb_build_object('missionId', p_mission_id, 'claimed', true, 'asset', v_asset, 'amount', v_amount);
end;
$$;

revoke all on function public.claim_game_mission(text,text,text) from public, anon, authenticated;
grant execute on function public.claim_game_mission(text,text,public."WalletAsset",bigint,text) to service_role;
