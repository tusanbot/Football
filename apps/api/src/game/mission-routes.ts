import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import type { SupabaseHttpClient } from "../node-supabase-http.js";
import { DAILY_MISSIONS, getMissionViews } from "@football/domain";

export function registerMissionRoutes(app: FastifyInstance, client: SupabaseHttpClient) {
  app.get("/v1/missions", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try {
      const rows = await client.select<Array<{ mission_id: string; progress: number; claimed_at: string | null }>>(
        "game_mission_progress",
        { select: "mission_id,progress,claimed_at", user_id: "eq." + user.id,
          mission_date: "eq." + new Date().toISOString().slice(0, 10) },
      );
      const views = getMissionViews(DAILY_MISSIONS, rows.map((row) => ({
        missionId: row.mission_id, progress: row.progress,
        claimedAt: row.claimed_at ? new Date(row.claimed_at) : null,
      })));
      return { missions: views, date: new Date().toISOString().slice(0, 10) };
    } catch (error) {
      request.log.error({ error }, "Mission progress read failed");
      return reply.code(503).send({ error: "MISSIONS_UNAVAILABLE" });
    }
  });

  app.post("/v1/missions/:missionId/claim", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ missionId: z.string().min(1).max(64) }).safeParse(request.params);
    const body = z.object({ idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_MISSION_CLAIM" });
    try {
      const result = await client.rpc<Record<string, unknown>>("claim_game_mission", {
        p_user_id: user.id,
        p_mission_id: params.data.missionId,
        p_idempotency_key: body.data.idempotencyKey,
      });
      return { result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const known = ["MISSION_NOT_COMPLETED", "MISSION_ALREADY_CLAIMED", "MISSION_INVALID_CLAIM"];
      const code = known.find((item) => message.includes(item));
      return reply.code(code ? 409 : 503).send({ error: code ?? "MISSION_CLAIM_UNAVAILABLE" });
    }
  });
}
