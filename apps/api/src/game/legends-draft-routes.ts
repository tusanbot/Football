import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import type { SupabaseHttpClient } from "../node-supabase-http.js";
import { simulateFootballMatch } from "@football/domain";

type DraftLine = "GK" | "DEF" | "MID" | "ATT";
function toDraftLine(positions: unknown): DraftLine | null {
  if (!Array.isArray(positions)) return null;
  for (const position of positions) {
    if (position === "GK") return "GK";
    if (["RB", "LB", "CB"].includes(String(position))) return "DEF";
    if (["CDM", "CM", "CAM"].includes(String(position))) return "MID";
    if (["RW", "LW", "ST"].includes(String(position))) return "ATT";
  }
  return null;
}
function errorCode(error: unknown): string {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : "LEGENDS_DRAFT_UNAVAILABLE";
}

export function registerLegendsDraftRoutes(app: FastifyInstance, client: SupabaseHttpClient) {
  app.post("/v1/legends-draft", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = z.object({
      opponentUserId: z.string().min(1).max(128),
      telegramGroupId: z.string().min(1).max(128).optional(),
      expiresAt: z.string().datetime().optional(),
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LEGENDS_DRAFT" });
    if (parsed.data.opponentUserId === user.id) return reply.code(400).send({ error: "DRAFT_USERS_MUST_DIFFER" });
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 7 * 24 * 60 * 60 * 1000) {
      return reply.code(400).send({ error: "INVALID_DRAFT_EXPIRY" });
    }
    try {
      // The client cannot inject or alter the draft pool; it is sourced from the
      // active server-side SpecialPlayer catalog.
      const catalog = await client.select<Array<Record<string, unknown>>>("SpecialPlayer", {
        select: "id,fullName,positions,overall,active", active: "eq.true", order: "overall.desc",
      });
      const playerPool = catalog.flatMap((row) => {
        const line = toDraftLine(row.positions);
        if (typeof row.id !== "string" || typeof row.fullName !== "string"
          || typeof row.overall !== "number" || !line) return [];
        return [{ id: row.id, name: row.fullName, line, overall: row.overall }];
      });
      if (playerPool.length < 10) return reply.code(503).send({ error: "LEGENDS_DRAFT_POOL_UNAVAILABLE" });
      const id = randomUUID();
      const rows = await client.insert<Array<Record<string, unknown>>>("legends_draft_challenges", {
        id, creator_user_id: user.id, opponent_user_id: parsed.data.opponentUserId,
        telegram_group_id: parsed.data.telegramGroupId ?? null,
        status: "INVITED", player_pool: playerPool,
        current_pick_number: 1, expires_at: expiresAt.toISOString(),
      });
      if (!Array.isArray(rows) || !rows[0]) return reply.code(503).send({ error: "LEGENDS_DRAFT_CREATE_FAILED" });
      return reply.code(201).send({ challenge: rows[0] });
    } catch (error) {
      request.log.error({ error }, "Supabase Legends Draft creation failed");
      return reply.code(503).send({ error: errorCode(error) });
    }
  });

  app.post("/v1/legends-draft/:id/accept", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_DRAFT_ID" });
    try {
      const updated = await client.update<Array<Record<string, unknown>>>("legends_draft_challenges", {
        id: "eq." + params.data.id, opponent_user_id: "eq." + user.id,
        status: "eq.INVITED", expires_at: "gt." + new Date().toISOString(),
      }, { status: "DRAFTING", accepted_at: new Date().toISOString(), version: 1 });
      if (updated[0]) return { challenge: updated[0], replayed: false };
      const existing = await client.select<Array<Record<string, unknown>>>("legends_draft_challenges", {
        select: "*", id: "eq." + params.data.id, opponent_user_id: "eq." + user.id, limit: "1",
      });
      if (existing[0]?.status === "DRAFTING" && existing[0]?.accepted_at) return { challenge: existing[0], replayed: true };
      return reply.code(409).send({ error: "DRAFT_NOT_ACCEPTABLE" });
    } catch (error) {
      request.log.error({ error }, "Supabase Legends Draft acceptance failed");
      return reply.code(503).send({ error: errorCode(error) });
    }
  });

  app.post("/v1/legends-draft/:id/picks", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z.object({
      playerId: z.string().min(1).max(128),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/),
      expectedVersion: z.number().int().nonnegative(),
    }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_DRAFT_PICK" });
    try {
      return await client.rpc<Record<string, unknown>>("legends_draft_pick", {
        p_challenge_id: params.data.id, p_user_id: user.id, p_player_id: body.data.playerId,
        p_idempotency_key: body.data.idempotencyKey, p_expected_version: body.data.expectedVersion,
      });
    } catch (error) {
      const code = errorCode(error);
      const conflict = ["DRAFT_VERSION_CONFLICT", "DRAFT_NOT_YOUR_TURN", "DRAFT_PLAYER_ALREADY_PICKED",
        "DRAFT_NOT_ACTIVE", "DRAFT_EXPIRED", "DRAFT_PICK_MUST_COMPLETE_TEAM_ROSTER"].includes(code);
      request.log.warn({ code }, "Legends Draft pick rejected");
      return reply.code(conflict ? 409 : 400).send({ error: code });
    }
  });

  app.get("/v1/legends-draft/:id", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_DRAFT_ID" });
    try {
      const rows = await client.select<Array<Record<string, unknown>>>("legends_draft_challenges", {
        select: "*", id: "eq." + params.data.id, limit: "1",
      });
      const challenge = rows[0];
      if (!challenge) return reply.code(404).send({ error: "DRAFT_NOT_FOUND" });
      if (challenge.creator_user_id !== user.id && challenge.opponent_user_id !== user.id) {
        return reply.code(403).send({ error: "NOT_DRAFT_PARTICIPANT" });
      }
      const picks = await client.select<Array<Record<string, unknown>>>("legends_draft_picks", {
        select: "pick_number,user_id,player_id,player_snapshot,created_at",
        challenge_id: "eq." + params.data.id, order: "pick_number.asc",
      });
      return { challenge, picks };
    } catch (error) {
      request.log.error({ error }, "Supabase Legends Draft read failed");
      return reply.code(503).send({ error: errorCode(error) });
    }
  });
  app.post("/v1/legends-draft/:id/formation", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z.object({
      formation: z.enum(["2-2", "1-2-1", "1-1-2", "2-1-1"]),
      expectedVersion: z.number().int().nonnegative(),
    }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_DRAFT_FORMATION" });
    try {
      return await client.rpc<Record<string, unknown>>("legends_draft_set_formation", {
        p_challenge_id: params.data.id, p_user_id: user.id,
        p_formation: body.data.formation, p_expected_version: body.data.expectedVersion,
      });
    } catch (error) {
      const code = errorCode(error);
      const conflict = ["DRAFT_VERSION_CONFLICT", "DRAFT_NOT_READY_FOR_FORMATION",
        "DRAFT_NOT_PARTICIPANT", "DRAFT_EXPIRED"].includes(code);
      return reply.code(conflict ? 409 : 400).send({ error: code });
    }
  });


  app.post("/v1/legends-draft/:id/play", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_DRAFT_ID" });
    try {
      const rows = await client.select<Array<Record<string, unknown>>>("legends_draft_challenges", {
        select: "*", id: "eq." + params.data.id, limit: "1",
      });
      const challenge = rows[0];
      if (!challenge) return reply.code(404).send({ error: "DRAFT_NOT_FOUND" });
      if (challenge.creator_user_id !== user.id && challenge.opponent_user_id !== user.id) {
        return reply.code(403).send({ error: "NOT_DRAFT_PARTICIPANT" });
      }
      if (challenge.status === "COMPLETED" && challenge.match_result) {
        return { matchId: challenge.match_id, result: challenge.match_result, replayed: true };
      }
      if (challenge.status !== "LINEUP" || !challenge.creator_formation || !challenge.opponent_formation) {
        return reply.code(409).send({ error: "DRAFT_NOT_READY_TO_PLAY" });
      }
      if (typeof challenge.expires_at !== "string" || Date.parse(challenge.expires_at) <= Date.now()) {
        return reply.code(409).send({ error: "DRAFT_EXPIRED" });
      }
      const picks = await client.select<Array<Record<string, unknown>>>("legends_draft_picks", {
        select: "pick_number,user_id,player_id,player_snapshot",
        challenge_id: "eq." + params.data.id, order: "pick_number.asc",
      });
      if (picks.length !== 10) return reply.code(409).send({ error: "DRAFT_NOT_READY_TO_PLAY" });

      const toMatchPosition = (line: unknown): "GK" | "CB" | "CM" | "ST" => {
        if (line === "GK") return "GK";
        if (line === "DEF") return "CB";
        if (line === "MID") return "CM";
        if (line === "ATT") return "ST";
        throw new Error("DRAFT_PLAYER_POSITION_INVALID");
      };
      const makeSide = (ownerId: string, formation: string, teamPicks: Record<string, unknown>[]) => ({
        clubId: ownerId,
        clubName: "Legends Draft",
        formation,
        tactics: { mentality: "BALANCED" as const, pressing: "MID_BLOCK" as const, tempo: "NORMAL" as const, passingStyle: "MIXED" as const },
        players: teamPicks.map((pick) => {
          const player = pick.player_snapshot as Record<string, unknown>;
          if (!player || typeof player.id !== "string" || typeof player.name !== "string"
            || typeof player.overall !== "number" || !Number.isFinite(player.overall)) {
            throw new Error("DRAFT_PLAYER_SNAPSHOT_INVALID");
          }
          const overall = Math.max(1, Math.min(99, player.overall));
          const goalkeeper = player.line === "GK";
          const attributes = {
            pace: overall, shooting: overall, passing: overall, dribbling: overall,
            defending: overall, physical: overall, goalkeeping: goalkeeper ? overall : 25,
          };
          return {
            id: player.id, name: player.name, position: toMatchPosition(player.line),
            overall, morale: 100, fitness: 100, attributes,
          };
        }),
        stadiumCapacity: 0, ticketPrice: 0n, reputation: 0, coachMedicalSkill: 100,
      });
      const creatorId = String(challenge.creator_user_id);
      const opponentId = String(challenge.opponent_user_id);
      const home = makeSide(creatorId, String(challenge.creator_formation), picks.filter((pick) => pick.user_id === creatorId));
      const away = makeSide(opponentId, String(challenge.opponent_formation), picks.filter((pick) => pick.user_id === opponentId));
      const simulation = simulateFootballMatch({
        seed: "legends-draft:" + params.data.id,
        home, away, format: "5v5",
      });
      const result = JSON.parse(JSON.stringify(simulation, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value)) as Record<string, unknown>;
      return await client.rpc<Record<string, unknown>>("legends_draft_complete_match", {
        p_challenge_id: params.data.id,
        p_user_id: user.id,
        p_match_result: result,
      });
    } catch (error) {
      const code = errorCode(error);
      const conflict = ["DRAFT_NOT_READY_TO_PLAY", "DRAFT_EXPIRED", "DRAFT_NOT_PARTICIPANT",
        "DRAFT_MATCH_ALREADY_COMPLETED"].includes(code);
      request.log.warn({ code }, "Legends Draft match rejected");
      return reply.code(conflict ? 409 : 503).send({ error: code });
    }
  });

  app.get("/v1/legends-draft/groups/:groupId/latest", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ groupId: z.string().min(1).max(128) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_GROUP_ID" });
    try {
      const rows = await client.select<Array<Record<string, unknown>>>("legends_draft_group_latest_results", {
        select: "telegram_group_id,challenge_id,result_id,updated_at",
        telegram_group_id: "eq." + params.data.groupId, limit: "1",
      });
      if (!rows[0]) return reply.code(404).send({ error: "NO_LATEST_DRAFT_RESULT" });
      const result = await client.select<Array<Record<string, unknown>>>("legends_draft_match_results", {
        select: "*", id: "eq." + String(rows[0].result_id), limit: "1",
      });
      return { latest: rows[0], result: result[0] ?? null };
    } catch (error) {
      request.log.error({ error }, "Legends Draft group result read failed");
      return reply.code(503).send({ error: errorCode(error) });
    }
  });

  app.get("/v1/legends-draft/players/:userId/records", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ userId: z.string().min(1).max(128) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_PLAYER_ID" });
    try {
      const rows = await client.select<Array<Record<string, unknown>>>("legends_draft_player_records", {
        select: "user_id,wins,losses,draws,matches,updated_at",
        user_id: "eq." + params.data.userId, limit: "1",
      });
      return { records: rows[0] ?? { user_id: params.data.userId, wins: 0, losses: 0, draws: 0, matches: 0 } };
    } catch (error) {
      request.log.error({ error }, "Legends Draft player records read failed");
      return reply.code(503).send({ error: errorCode(error) });
    }
  });

}
