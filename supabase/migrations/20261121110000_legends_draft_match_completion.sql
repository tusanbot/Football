-- Complete a fully drafted Legends match exactly once in the Supabase database.
alter table public.legends_draft_challenges
  add column if not exists match_result jsonb;

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
begin
  if p_user_id is null or btrim(p_user_id) = '' then
    raise exception 'DRAFT_NOT_PARTICIPANT' using errcode = '42501';
  end if;
  if p_match_result is null or jsonb_typeof(p_match_result) <> 'object'
    or jsonb_typeof(p_match_result->'homeScore') <> 'number'
    or jsonb_typeof(p_match_result->'awayScore') <> 'number'
    or jsonb_typeof(p_match_result->'events') <> 'array'
    or jsonb_typeof(p_match_result->'performances') <> 'array' then
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

  v_match_id := coalesce(v_challenge.match_id, 'draft_match_' || replace(gen_random_uuid()::text, '-', ''));
  update public.legends_draft_challenges
     set status = 'COMPLETED',
         match_id = v_match_id,
         match_result = p_match_result,
         completed_at = now(),
         version = version + 1,
         updated_at = now()
   where id = p_challenge_id;

  return jsonb_build_object('matchId', v_match_id, 'result', p_match_result, 'replayed', false);
end;
$$;

revoke all on function public.legends_draft_complete_match(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.legends_draft_complete_match(text,text,jsonb) to service_role;
