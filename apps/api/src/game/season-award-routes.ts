import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const paramsSchema = z.object({ season: z.coerce.number().int().min(2020).max(2200) });
const querySchema = z.object({ minimumAppearances: z.coerce.number().int().min(1).max(38).default(3) }).strict();

type AwardRecord = {
  playerId: string;
  playerName: string;
  position: string;
  clubName: string;
  appearances: number;
  goals: number;
  assists: number;
  minutesPlayed: number;
  averageRating: number;
};

function positionGroup(position: string): "GK" | "DEF" | "MID" | "FWD" {
  const value = position.toUpperCase().replace(/[^A-Z]/g, "");
  if (["GK", "G", "GOALKEEPER"].includes(value)) return "GK";
  if (["CB", "LCB", "RCB", "LB", "RB", "LWB", "RWB", "DF", "DEF", "DEFENDER"].includes(value)) return "DEF";
  if (["CDM", "DM", "CM", "LCM", "RCM", "CAM", "AM", "LM", "RM", "MF", "MID", "MIDFIELDER"].includes(value)) return "MID";
  return "FWD";
}

function comparePerformance(a: AwardRecord, b: AwardRecord): number {
  return b.averageRating - a.averageRating || b.goals - a.goals || b.assists - a.assists
    || b.appearances - a.appearances || a.playerName.localeCompare(b.playerName);
}

export function registerSeasonAwardRoutes(app: FastifyInstance) {
  app.get("/v1/seasons/:season/awards", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const query = querySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "INVALID_SEASON_AWARDS_QUERY" });

    const season = params.data.season;
    const performances = await prisma.playerMatchPerformance.groupBy({
      by: ["playerId"],
      where: {
        minutesPlayed: { gt: 0 },
        match: { is: { status: "COMPLETED", competition: { is: { season } } } },
      },
      _sum: { goals: true, assists: true, minutesPlayed: true },
      _avg: { rating: true },
      _count: { _all: true },
    });

    const playerIds = performances.map((item) => item.playerId);
    const players = playerIds.length ? await prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, firstName: true, lastName: true, position: true, club: { select: { name: true } } },
    }) : [];
    const playerById = new Map(players.map((player) => [player.id, player]));
    const records: AwardRecord[] = performances.flatMap((item) => {
      const player = playerById.get(item.playerId);
      if (!player) return [];
      return [{
        playerId: player.id,
        playerName: [player.firstName, player.lastName].filter(Boolean).join(" "),
        position: player.position,
        clubName: player.club.name,
        appearances: item._count._all,
        goals: item._sum.goals ?? 0,
        assists: item._sum.assists ?? 0,
        minutesPlayed: item._sum.minutesPlayed ?? 0,
        averageRating: Math.round((item._avg.rating ?? 0) * 100) / 100,
      }];
    });

    const eligible = records.filter((record) => record.appearances >= query.data.minimumAppearances);
    const byGoals = [...records].filter((record) => record.goals > 0)
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists || comparePerformance(a, b));
    const byAssists = [...records].filter((record) => record.assists > 0)
      .sort((a, b) => b.assists - a.assists || b.goals - a.goals || comparePerformance(a, b));
    const byRating = [...eligible].sort(comparePerformance);

    const slots: Array<"GK" | "DEF" | "MID" | "FWD"> = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "FWD", "FWD", "FWD"];
    const remaining = [...byRating];
    const teamOfSeason = slots.flatMap((group) => {
      const index = remaining.findIndex((record) => positionGroup(record.position) === group);
      if (index < 0) return [];
      const [selected] = remaining.splice(index, 1);
      return selected ? [selected] : [];
    });

    const matches = await prisma.footballMatch.count({
      where: { status: "COMPLETED", competition: { is: { season } } },
    });
    const top = (record: AwardRecord | undefined) => record ?? null;
    return {
      season,
      matches,
      minimumAppearances: query.data.minimumAppearances,
      awards: {
        topScorer: top(byGoals[0]),
        topAssists: top(byAssists[0]),
        playerOfSeason: top(byRating[0]),
        teamOfSeason,
      },
      leaders: {
        scorers: byGoals.slice(0, 10),
        assists: byAssists.slice(0, 10),
        ratings: byRating.slice(0, 10),
      },
    };
  });
}
