DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AllianceSeason_allianceId_fkey'
      AND conrelid = 'public."AllianceSeason"'::regclass
  ) THEN
    ALTER TABLE public."AllianceSeason"
      ADD CONSTRAINT "AllianceSeason_allianceId_fkey"
      FOREIGN KEY ("allianceId") REFERENCES public."Alliance"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AllianceLedger_allianceId_fkey'
      AND conrelid = 'public."AllianceLedger"'::regclass
  ) THEN
    ALTER TABLE public."AllianceLedger"
      ADD CONSTRAINT "AllianceLedger_allianceId_fkey"
      FOREIGN KEY ("allianceId") REFERENCES public."Alliance"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
