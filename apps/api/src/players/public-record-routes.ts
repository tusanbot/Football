
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const querySchema = z.object({
  metric: z.enum(["goals", "assists", "appearances", "rating"]).default("goals"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export function registerPublicPlayerRecordRoutes(app: FastifyInstance) {
  app.get("/v1/players/records", async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_PLAYER_RECORD_QUERY" });

    const aggregates = await prisma.playerMatchPerformance.groupBy({
      by: ["playerId"],
      where: {
        minutesPlayed: { gt: 0 },
        ...(query.data.metric === "goals" ? { goals: { gt: 0 } } : {}),
        ...(query.data.metric === "assists" ? { assists: { gt: 0 } } : {}),
        match: { is: { status: "COMPLETED" } },
      },
      _sum: { goals: true, assists: true, minutesPlayed: true },
      _avg: { rating: true },
      _count: { _all: true },
    });

    const eligible = aggregates.filter((item) => query.data.metric !== "rating" || item._count._all >= 3);
    const playerIds = eligible.map((item) => item.playerId);
    const players = playerIds.length ? await prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: {
        id: true, firstName: true, lastName: true, position: true, overall: true,
        club: { select: { name: true } },
      },
    }) : [];
    const playerById = new Map(players.map((player) => [player.id, player]));
    const records = eligible.flatMap((item) => {
      const player = playerById.get(item.playerId);
      if (!player) return [];
      const appearances = item._count._all;
      const goals = item._sum.goals ?? 0;
      const assists = item._sum.assists ?? 0;
      const minutesPlayed = item._sum.minutesPlayed ?? 0;
      const averageRating = Math.round((item._avg.rating ?? 0) * 100) / 100;
      const value = query.data.metric === "goals" ? goals
        : query.data.metric === "assists" ? assists
          : query.data.metric === "appearances" ? appearances : averageRating;
      return [{
        playerId: player.id,
        playerName: player.firstName + " " + player.lastName,
        position: player.position,
        overall: player.overall,
        clubName: player.club.name,
        appearances, goals, assists, minutesPlayed, averageRating, value,
      }];
    });
    records.sort((a, b) => b.value - a.value
      || b.appearances - a.appearances
      || b.averageRating - a.averageRating
      || a.playerName.localeCompare(b.playerName));
    return {
      metric: query.data.metric,
      minimumAppearances: query.data.metric === "rating" ? 3 : 1,
      records: records.slice(0, query.data.limit).map((record, index) => ({ rank: index + 1, ...record })),
    };
  });
}
