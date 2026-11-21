-- Supabase-native mission progress and atomic reward claims.
create table if not exists public.game_mission_progress (
  user_id text not null references public."User"(id) on delete cascade,
  mission_id text not null,
  progress integer not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, mission_id)
);

alter table public.game_mission_progress enable row level security;
revoke all on public.game_mission_progress from anon, authenticated;
grant select, insert, update, delete on public.game_mission_progress to service_role;

create or replace function public.claim_game_mission(
  p_user_id text,
  p_mission_id text,
  p_asset public."WalletAsset",
  p_amount bigint,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_progress public.game_mission_progress%rowtype;
  v_reward public."LedgerTransaction"%rowtype;
begin
  if p_mission_id not in ('daily_play_1','daily_win_1','daily_goals_3','daily_train_1')
     or p_amount <= 0
     or p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$' then
    raise exception 'MISSION_INVALID_CLAIM' using errcode = '22023';
  end if;

  insert into public.game_mission_progress(user_id, mission_id)
  values (p_user_id, p_mission_id)
  on conflict (user_id, mission_id) do nothing;

  select * into v_progress
  from public.game_mission_progress
  where user_id = p_user_id and mission_id = p_mission_id
  for update;

  if v_progress.progress < case p_mission_id
    when 'daily_play_1' then 1 when 'daily_win_1' then 1
    when 'daily_goals_3' then 3 when 'daily_train_1' then 1 end then
    raise exception 'MISSION_NOT_COMPLETED' using errcode = 'P0001';
  end if;
  if v_progress.claimed_at is not null then
    raise exception 'MISSION_ALREADY_CLAIMED' using errcode = 'P0001';
  end if;

  perform public.apply_wallet_entry(
    p_user_id, p_asset, 'CREDIT', p_amount, p_idempotency_key,
    'MISSION_REWARD', 'GAME_MISSION', p_mission_id
  );

  update public.game_mission_progress
  set claimed_at = now(), updated_at = now()
  where user_id = p_user_id and mission_id = p_mission_id;

  return jsonb_build_object('missionId', p_mission_id, 'claimed', true, 'asset', p_asset, 'amount', p_amount);
end;
$$;

revoke all on function public.claim_game_mission(text,text,public."WalletAsset",bigint,text) from public, anon, authenticated;
grant execute on function public.claim_game_mission(text,text,public."WalletAsset",bigint,text) to service_role;
