import assert from "node:assert/strict";
import test from "node:test";
import { assertManualCompetitionStatus } from "../src/admin-routes.js";

test("administrators cannot manually mark a competition completed", () => {
  for (const status of ["DRAFT", "REGISTRATION", "ACTIVE", "CANCELLED"]) {
    assert.doesNotThrow(() => assertManualCompetitionStatus(status));
  }
  assert.throws(
    () => assertManualCompetitionStatus("COMPLETED"),
    (error: unknown) => error instanceof Error && error.message === "COMPETITION_COMPLETION_AUTOMATIC_ONLY",
  );
});
