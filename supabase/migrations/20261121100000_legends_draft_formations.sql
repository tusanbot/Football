-- Atomic formation selection for the Legends Draft. Does not start a match;
-- match creation is a separate lifecycle transition once both lineups are persisted.
create or replace function public.legends_draft_set_formation(
  p_challenge_id text,
  p_user_id text,
  p_formation text,
  p_expected_version integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.legends_draft_challenges%rowtype;
  v_column text;
  v_value text;
begin
  if p_formation not in ('2-2','1-2-1','1-1-2','2-1-1') then
    raise exception 'DRAFT_FORMATION_INVALID' using errcode = '22023';
  end if;
  select * into v_challenge
    from public.legends_draft_challenges
   where id = p_challenge_id
   for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_user_id not in (v_challenge.creator_user_id, v_challenge.opponent_user_id) then
    raise exception 'DRAFT_NOT_PARTICIPANT' using errcode = '42501';
  end if;
  if v_challenge.expires_at <= now() then raise exception 'DRAFT_EXPIRED' using errcode = '55000'; end if;
  if v_challenge.status <> 'LINEUP' then raise exception 'DRAFT_NOT_READY_FOR_FORMATION' using errcode = '55000'; end if;
  if v_challenge.version <> p_expected_version then raise exception 'DRAFT_VERSION_CONFLICT' using errcode = '40001'; end if;
  if (select count(*) from public.legends_draft_picks where challenge_id = p_challenge_id) <> 10 then
    raise exception 'DRAFT_NOT_READY_FOR_FORMATION' using errcode = '55000';
  end if;

  if p_user_id = v_challenge.creator_user_id then
    v_column := 'creator_formation';
    v_value := v_challenge.creator_formation;
  else
    v_column := 'opponent_formation';
    v_value := v_challenge.opponent_formation;
  end if;
  if v_value is not null then
    if v_value = p_formation then
      return jsonb_build_object('challenge_id', p_challenge_id, 'formation', p_formation,
        'version', v_challenge.version, 'replayed', true,
        'both_ready', v_challenge.creator_formation is not null and v_challenge.opponent_formation is not null);
    end if;
    raise exception 'DRAFT_FORMATION_ALREADY_SET' using errcode = '55000';
  end if;

  if p_user_id = v_challenge.creator_user_id then
    update public.legends_draft_challenges
       set creator_formation = p_formation, version = version + 1, updated_at = now()
     where id = p_challenge_id returning * into v_challenge;
  else
    update public.legends_draft_challenges
       set opponent_formation = p_formation, version = version + 1, updated_at = now()
     where id = p_challenge_id returning * into v_challenge;
  end if;
  return jsonb_build_object('challenge_id', p_challenge_id, 'formation', p_formation,
    'version', v_challenge.version, 'replayed', false,
    'both_ready', v_challenge.creator_formation is not null and v_challenge.opponent_formation is not null);
end;
$$;
revoke all on function public.legends_draft_set_formation(text,text,text,integer) from public, anon, authenticated;
grant execute on function public.legends_draft_set_formation(text,text,text,integer) to service_role;
