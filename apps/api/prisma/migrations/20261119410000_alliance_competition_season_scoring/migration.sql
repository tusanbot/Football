ALTER TABLE public."CompetitionEntry"
 ADD COLUMN "allianceGroupId" text;

ALTER TABLE public."CompetitionEntry"
 ADD CONSTRAINT "CompetitionEntry_allianceGroupId_fkey"
 FOREIGN KEY ("allianceGroupId") REFERENCES public."AllianceGroup"(id)
 ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CompetitionEntry_allianceGroupId_idx"
 ON public."CompetitionEntry"("allianceGroupId");

-- Attribute legacy entries only when the club owner belongs to exactly one
-- group in that competition's alliance. Ambiguous rows remain unattributed.
WITH candidate_groups AS (
 SELECT ce.id AS entry_id,min(ag.id) AS alliance_group_id,count(*) AS matches
 FROM public."CompetitionEntry" ce
 JOIN public."Competition" cp ON cp.id=ce."competitionId" AND cp."allianceId" IS NOT NULL
 JOIN public."Club" cl ON cl.id=ce."clubId"
 JOIN public."GroupMembership" gm ON gm."userId"=cl."ownerId"
 JOIN public."AllianceGroup" ag ON ag."groupId"=gm."groupId" AND ag."allianceId"=cp."allianceId"
 WHERE ce."allianceGroupId" IS NULL
 GROUP BY ce.id
 HAVING count(*)=1
)
UPDATE public."CompetitionEntry" ce
SET "allianceGroupId"=candidate_groups.alliance_group_id
FROM candidate_groups
WHERE ce.id=candidate_groups.entry_id;

CREATE OR REPLACE FUNCTION public.record_alliance_competition_match_points()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
 v_alliance_id text;
 v_season_status text;
 v_season_starts timestamp without time zone;
 v_season_ends timestamp without time zone;
 v_home_points integer;
 v_away_points integer;
 v_entry record;
 v_key text;
 v_inserted integer;
BEGIN
 IF OLD.status::text='COMPLETED' OR NEW.status::text<>'COMPLETED'
  OR NEW."competitionId" IS NULL OR NEW."homeScore" IS NULL OR NEW."awayScore" IS NULL
  OR NEW."completedAt" IS NULL THEN
  RETURN NEW;
 END IF;

 SELECT cp."allianceId",s.status::text,s."startsAt",s."endsAt"
 INTO v_alliance_id,v_season_status,v_season_starts,v_season_ends
 FROM public."Competition" cp
 JOIN public."AllianceSeason" s ON s.id=cp."allianceSeasonId" AND s."allianceId"=cp."allianceId"
 WHERE cp.id=NEW."competitionId" AND cp."format"::text='LEAGUE' AND cp.status::text='ACTIVE';

 IF NOT FOUND OR v_alliance_id IS NULL OR v_season_status<>'ACTIVE'
  OR NEW."completedAt"<v_season_starts OR NEW."completedAt">=v_season_ends THEN
  RETURN NEW;
 END IF;

 v_home_points:=CASE WHEN NEW."homeScore">NEW."awayScore" THEN 3
  WHEN NEW."homeScore"=NEW."awayScore" THEN 1 ELSE 0 END;
 v_away_points:=CASE WHEN NEW."awayScore">NEW."homeScore" THEN 3
  WHEN NEW."awayScore"=NEW."homeScore" THEN 1 ELSE 0 END;

 FOR v_entry IN
  SELECT ce."clubId" AS club_id,ag."groupId" AS group_id,cl."ownerId" AS user_id,
   CASE WHEN ce."clubId"=NEW."homeClubId" THEN v_home_points ELSE v_away_points END AS points
  FROM public."CompetitionEntry" ce
  JOIN public."Club" cl ON cl.id=ce."clubId"
  JOIN public."AllianceGroup" ag ON ag.id=ce."allianceGroupId" AND ag."allianceId"=v_alliance_id
  WHERE ce."competitionId"=NEW."competitionId"
   AND ce."clubId" IN (NEW."homeClubId",NEW."awayClubId")
 LOOP
  IF v_entry.points>0 THEN
   v_key:='alliance-match:'||NEW.id||':'||v_entry.club_id;
   INSERT INTO public."GroupPointLedger"(
    id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt"
   ) VALUES(
    gen_random_uuid()::text,v_key,v_entry.group_id,v_entry.user_id,v_entry.points,
    'LEAGUE_REWARD','Alliance competition match reward: '||NEW.id,NEW."completedAt"
   ) ON CONFLICT ("idempotencyKey") DO NOTHING;
   GET DIAGNOSTICS v_inserted=ROW_COUNT;
   IF v_inserted=1 THEN
    UPDATE public."TelegramGroup" SET points=points+v_entry.points WHERE id=v_entry.group_id;
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.record_alliance_competition_match_points() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS alliance_competition_match_points ON public."FootballMatch";
CREATE TRIGGER alliance_competition_match_points
 AFTER UPDATE OF status ON public."FootballMatch"
 FOR EACH ROW
 WHEN (NEW.status='COMPLETED' AND OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION public.record_alliance_competition_match_points();
