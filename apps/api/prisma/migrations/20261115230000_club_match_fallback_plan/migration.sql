ALTER TABLE "Club"
  ADD COLUMN "matchFallbackPlan" JSONB,
  ADD COLUMN "matchFallbackPlanVersion" INTEGER NOT NULL DEFAULT 1;
