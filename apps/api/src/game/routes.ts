import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateLineup, type Formation, type LineupCandidate } from "@football/domain";
import { prisma } from "../db.js";
import { requireTelegramUser } from "../auth/require-telegram-user.js";

const clubUpdateSchema = z.object({
  name: z.string().trim().min(2).max(32).regex(/^[\p{L}\p{N} .'-]+$/u),
});

const formationSchema = z.enum(["4-3-3", "4-4-2", "3-5-2", "4-2-3-1"]);
const tacticsSchema = z.object({
  mentality: z.enum(["DEFENSIVE", "BALANCED", "ATTACKING"]).optional(),
  pressing: z.enum(["LOW_BLOCK", "MID_BLOCK", "HIGH_PRESS"]).optional(),
  tempo: z.enum(["SLOW", "NORMAL", "FAST"]).optional(),
  passingStyle: z.enum(["SHORT", "MIXED", "DIRECT"]).optional(),
});
const lineupUpdateSchema = z.object({
  formation: formationSchema,
  playerIds: z.array(z.string().min(1)).length(11),
  expectedVersion: z.number().int().nonnegative(),
  tactics: tacticsSchema.optional(),
});

export function registerGameRoutes(app: FastifyInstance) {
  app.get("/v1/me", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const [club, wallets] = await Promise.all([
      prisma.club.findUnique({ where: { ownerId: user.id }, select: { id: true, name: true, level: true, reputation: true, createdAt: true } }),
      prisma.wallet.findMany({ where: { userId: user.id }, select: { asset: true, balance: true, version: true }, orderBy: { asset: "asc" } }),
    ]);
    return {
      user: { ...user, createdAt: user.createdAt.toISOString() }, club,
      wallets: wallets.map((wallet) => ({ asset: wallet.asset, balance: wallet.balance.toString(), version: wallet.version })),
    };
  });

  app.patch("/v1/club", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = clubUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_CLUB_NAME", details: parsed.error.flatten() });
    const club = await prisma.club.updateMany({ where: { ownerId: user.id }, data: { name: parsed.data.name } });
    if (club.count !== 1) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    return { club: await prisma.club.findUnique({ where: { ownerId: user.id }, select: { id: true, name: true, level: true, reputation: true } }) };
  });

  app.get("/v1/wallet", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const wallets = await prisma.wallet.findMany({ where: { userId: user.id }, select: { asset: true, balance: true, version: true, updatedAt: true }, orderBy: { asset: "asc" } });
    return { wallets: wallets.map((wallet) => ({ asset: wallet.asset, balance: wallet.balance.toString(), version: wallet.version, updatedAt: wallet.updatedAt.toISOString() })) };
  });

  app.get("/v1/club/lineup", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const club = await prisma.club.findUnique({
      where: { ownerId: user.id },
      select: {
        id: true, name: true, formation: true, mentality: true, pressing: true,
        tempo: true, passingStyle: true, lineupVersion: true,
        players: {
          where: { lineupSlot: { not: null }, status: "ACTIVE" },
          orderBy: { lineupSlot: "asc" },
          select: { id: true, firstName: true, lastName: true, position: true, overall: true, morale: true, fitness: true, lineupSlot: true },
        },
      },
    });
    if (!club) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    return { club: {
      id: club.id, name: club.name, formation: club.formation,
      tactics: { mentality: club.mentality, pressing: club.pressing, tempo: club.tempo, passingStyle: club.passingStyle },
      lineupVersion: club.lineupVersion, players: club.players,
    } };
  });

  app.put("/v1/club/lineup", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = lineupUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LINEUP_REQUEST", details: parsed.error.flatten() });

    const club = await prisma.club.findUnique({
      where: { ownerId: user.id },
      select: { id: true, formation: true, mentality: true, pressing: true, tempo: true, passingStyle: true, lineupVersion: true },
    });
    if (!club) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    if (club.lineupVersion !== parsed.data.expectedVersion) {
      return reply.code(409).send({ error: "LINEUP_VERSION_CONFLICT", currentVersion: club.lineupVersion });
    }

    const players = await prisma.player.findMany({
      where: { id: { in: parsed.data.playerIds }, clubId: club.id, status: "ACTIVE" },
      select: { id: true, position: true, overall: true },
    });
    if (players.length !== 11) return reply.code(400).send({ error: "LINEUP_PLAYERS_INVALID" });

    const byId = new Map(players.map((player) => [player.id, player]));
    const ordered = parsed.data.playerIds.map((id) => byId.get(id)!).map((player) => ({
      id: player.id,
      position: player.position as LineupCandidate["position"],
      overall: player.overall,
    }));
    const validation = validateLineup(parsed.data.formation as Formation, ordered);
    if (!validation.valid) return reply.code(400).send({ error: "LINEUP_INVALID", details: validation.errors });

    try {
      const saved = await prisma.$transaction(async (tx) => {
        // Re-check ownership and availability inside the same transaction that
        // writes lineup slots; the earlier read is only for fast validation.
        const currentPlayers = await tx.player.findMany({
          where: { id: { in: parsed.data.playerIds }, clubId: club.id, status: "ACTIVE" },
          select: { id: true, position: true, overall: true },
        });
        if (currentPlayers.length !== 11) return "PLAYERS_CHANGED";
        const currentById = new Map(currentPlayers.map((player) => [player.id, player]));
        const currentOrdered = parsed.data.playerIds.map((id) => currentById.get(id)!).map((player) => ({
          id: player.id,
          position: player.position as LineupCandidate["position"],
          overall: player.overall,
        }));
        if (!validateLineup(parsed.data.formation as Formation, currentOrdered).valid) return "LINEUP_CHANGED";

        const updated = await tx.club.updateMany({
          where: { id: club.id, ownerId: user.id, lineupVersion: parsed.data.expectedVersion },
          data: {
            formation: parsed.data.formation,
            mentality: parsed.data.tactics?.mentality ?? club.mentality,
            pressing: parsed.data.tactics?.pressing ?? club.pressing,
            tempo: parsed.data.tactics?.tempo ?? club.tempo,
            passingStyle: parsed.data.tactics?.passingStyle ?? club.passingStyle,
            lineupVersion: { increment: 1 },
          },
        });
        if (updated.count !== 1) return "VERSION_CONFLICT";
        await tx.player.updateMany({ where: { clubId: club.id, lineupSlot: { not: null } }, data: { lineupSlot: null } });
        for (const [index, id] of parsed.data.playerIds.entries()) {
          const assigned = await tx.player.updateMany({
            where: { id, clubId: club.id, status: "ACTIVE" },
            data: { lineupSlot: index + 1 },
          });
          if (assigned.count !== 1) throw new Error("LINEUP_PLAYERS_CHANGED");
        }
        return "SAVED";
      }, { isolationLevel: "Serializable" });
      if (saved !== "SAVED") {
        return reply.code(409).send({ error: saved === "VERSION_CONFLICT" ? "LINEUP_VERSION_CONFLICT" : "LINEUP_PLAYERS_CHANGED" });
      }
      return { ok: true, lineupVersion: parsed.data.expectedVersion + 1 };
    } catch (error) {
      if ((typeof error === "object" && error !== null && "code" in error && error.code === "P2034")
        || (error instanceof Error && error.message === "LINEUP_PLAYERS_CHANGED")) {
        return reply.code(409).send({ error: "LINEUP_UPDATE_CONFLICT" });
      }
      request.log.error({ error }, "Lineup update failed");
      return reply.code(500).send({ error: "LINEUP_UPDATE_FAILED" });
    }
  });

  app.get("/v1/club/players", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const club = await prisma.club.findUnique({ where: { ownerId: user.id }, select: { id: true } });
    if (!club) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    const players = await prisma.player.findMany({
      where: { clubId: club.id, status: { in: ["ACTIVE", "INJURED", "CONTRACT_EXPIRED"] } },
      orderBy: [{ status: "asc" }, { position: "asc" }, { overall: "desc" }],
      select: { id: true, firstName: true, lastName: true, nationality: true, age: true, position: true, overall: true, potential: true, attributes: true, wage: true, contractDays: true, morale: true, fitness: true, origin: true, status: true, lineupSlot: true },
    });
    return { players: players.map((player) => ({ ...player, wage: player.wage.toString() })), count: players.length };
  });
}
