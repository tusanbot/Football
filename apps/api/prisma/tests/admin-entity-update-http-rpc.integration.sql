BEGIN;
INSERT INTO public."User"(id,"telegramId") VALUES('admin-entity-user-1','990000001'),('admin-entity-user-2','990000002');
INSERT INTO public."Club"(id,"ownerId",name,slug) VALUES('admin-entity-club-1','admin-entity-user-1','Club One','admin-entity-club-one'),('admin-entity-club-2','admin-entity-user-2','Club Two','admin-entity-club-two');
INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays")
VALUES('admin-entity-player-1','admin-entity-club-1','Test','Player','IR',20,'ST',60,75,'{}'::jsonb,100,365);
INSERT INTO public."FootballMatch"(id,"idempotencyKey","homeClubId","awayClubId","scheduledAt",seed)
VALUES('admin-entity-match-1','admin-entity-match-key-1','admin-entity-club-1','admin-entity-club-2',now()+interval '1 day','admin-entity-seed-1');
DO $$
DECLARE r jsonb; n integer;
BEGIN
 r:=public.admin_entity_update_http('player-update','admin-entity-player-1','990000009','admin-entity-player-update-1','{"firstName":"Updated","overall":88,"wage":"250"}'::jsonb);
 IF r->>'replay'<>'false' THEN RAISE EXCEPTION 'first player update must not replay'; END IF;
 r:=public.admin_entity_update_http('player-update','admin-entity-player-1','990000009','admin-entity-player-update-1','{"firstName":"Updated","overall":88,"wage":"250"}'::jsonb);
 IF r->>'replay'<>'true' THEN RAISE EXCEPTION 'player update replay expected'; END IF;
 IF (SELECT "firstName" FROM public."Player" WHERE id='admin-entity-player-1')<>'Updated' THEN RAISE EXCEPTION 'player update failed'; END IF;
 PERFORM public.admin_entity_update_http('player-status','admin-entity-player-1','990000009','admin-entity-player-status-1','{"status":"RETIRED"}'::jsonb);
 IF (SELECT status::text FROM public."Player" WHERE id='admin-entity-player-1')<>'RETIRED' THEN RAISE EXCEPTION 'player status update failed'; END IF;
 PERFORM public.admin_entity_update_http('club-update','admin-entity-club-1','990000009','admin-entity-club-update-1','{"clubName":"Updated Club","level":3,"ticketPrice":"250"}'::jsonb);
 IF (SELECT name FROM public."Club" WHERE id='admin-entity-club-1')<>'Updated Club' THEN RAISE EXCEPTION 'club update failed'; END IF;
 PERFORM public.admin_entity_update_http('match-update','admin-entity-match-1','990000009','admin-entity-match-update-1','{"homeScore":2,"awayScore":1,"matchStatus":"CANCELLED"}'::jsonb);
 IF (SELECT status::text FROM public."FootballMatch" WHERE id='admin-entity-match-1')<>'CANCELLED' THEN RAISE EXCEPTION 'match update failed'; END IF;
 BEGIN
  PERFORM public.admin_entity_update_http('match-update','admin-entity-match-1','990000009','admin-entity-match-update-2','{"matchStatus":"COMPLETED"}'::jsonb);
  RAISE EXCEPTION 'completed match status must be rejected';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 SELECT count(*) INTO n FROM public."AdminAuditLog" WHERE "idempotencyKey" LIKE 'admin-entity:admin-entity-%';
 IF n<>4 THEN RAISE EXCEPTION 'expected 4 audit rows, got %',n; END IF;
 IF has_function_privilege('anon','public.admin_entity_update_http(text,text,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'anon must not execute admin entity RPC'; END IF;
 IF has_function_privilege('authenticated','public.admin_entity_update_http(text,text,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'authenticated must not execute admin entity RPC'; END IF;
END $$;
ROLLBACK;
