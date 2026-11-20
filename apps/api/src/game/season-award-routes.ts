import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const paramsSchema = z.object({ season: z.coerce.number().int().min(2020).max(2200) });
const querySchema = z.object({ minimumAppearances: z.coerce.number().int().min(1).max(38).default(3) }).strict();

export type SeasonAwardRecord = {
  playerId: string; playerName: string; position: string; clubName: string;
  appearances: number; goals: number; assists: number; minutesPlayed: number; averageRating: number;
};
export type SeasonManualAward = {
  id: string; awardType: string; awardName: string; reason: string | null;
  playerId: string; playerName: string; position: string; clubName: string;
};
export type SeasonAwardData = { matches: number; records: SeasonAwardRecord[]; manualAwards: SeasonManualAward[] };
export interface SeasonAwardRepository { getSeasonData(season: number): Promise<SeasonAwardData> }

function positionGroup(position: string): "GK" | "DEF" | "MID" | "FWD" {
  const value = position.toUpperCase().replace(/[^A-Z]/g, "");
  if (["GK", "G", "GOALKEEPER"].includes(value)) return "GK";
  if (["CB", "LCB", "RCB", "LB", "RB", "LWB", "RWB", "DF", "DEF", "DEFENDER"].includes(value)) return "DEF";
  if (["CDM", "DM", "CM", "LCM", "RCM", "CAM", "AM", "LM", "RM", "MF", "MID", "MIDFIELDER"].includes(value)) return "MID";
  return "FWD";
}
function comparePerformance(a: SeasonAwardRecord, b: SeasonAwardRecord): number {
  return b.averageRating - a.averageRating || b.goals - a.goals || b.assists - a.assists
    || b.appearances - a.appearances || a.playerName.localeCompare(b.playerName);
}
function buildSeasonAwards(season: number, minimumAppearances: number, data: SeasonAwardData) {
  const records = data.records;
  const eligible = records.filter((record) => record.appearances >= minimumAppearances);
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
  return {
    season, matches: data.matches, minimumAppearances,
    awards: { topScorer: byGoals[0] ?? null, topAssists: byAssists[0] ?? null, playerOfSeason: byRating[0] ?? null, teamOfSeason },
    manualAwards: data.manualAwards,
    leaders: { scorers: byGoals.slice(0, 10), assists: byAssists.slice(0, 10), ratings: byRating.slice(0, 10) },
  };
}

const prismaRepository: SeasonAwardRepository = {
  async getSeasonData(season) {
    const performances = await prisma.playerMatchPerformance.groupBy({
      by: ["playerId"],
      where: { minutesPlayed: { gt: 0 }, match: { is: { status: "COMPLETED", competition: { is: { season } } } } },
      _sum: { goals: true, assists: true, minutesPlayed: true }, _avg: { rating: true }, _count: { _all: true },
    });
    const playerIds = performances.map((item) => item.playerId);
    const players = playerIds.length ? await prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, firstName: true, lastName: true, position: true, club: { select: { name: true } } },
    }) : [];
    const playerById = new Map(players.map((player) => [player.id, player]));
    const records: SeasonAwardRecord[] = performances.flatMap((item) => {
      const player = playerById.get(item.playerId);
      if (!player) return [];
      return [{
        playerId: player.id, playerName: [player.firstName, player.lastName].filter(Boolean).join(" "),
        position: player.position, clubName: player.club.name, appearances: item._count._all,
        goals: item._sum.goals ?? 0, assists: item._sum.assists ?? 0,
        minutesPlayed: item._sum.minutesPlayed ?? 0, averageRating: Math.round((item._avg.rating ?? 0) * 100) / 100,
      }];
    });
    const manualRows = await prisma.seasonPlayerAward.findMany({
      where: { season },
      include: { player: { select: { id: true, firstName: true, lastName: true, position: true, club: { select: { name: true } } } } },
      orderBy: [{ awardType: "asc" }, { createdAt: "asc" }],
    });
    const matches = await prisma.footballMatch.count({ where: { status: "COMPLETED", competition: { is: { season } } } });
    return {
      matches, records,
      manualAwards: manualRows.map((award) => ({
        id: award.id, awardType: award.awardType, awardName: award.awardName, reason: award.reason,
        playerId: award.player.id, playerName: [award.player.firstName, award.player.lastName].filter(Boolean).join(" "),
        position: award.player.position, clubName: award.player.club.name,
      })),
    };
  },
};

export function registerSeasonAwardRoutes(app: FastifyInstance, repository: SeasonAwardRepository = prismaRepository) {
  app.get("/v1/seasons/:season/awards", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const query = querySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "INVALID_SEASON_AWARDS_QUERY" });
    const data = await repository.getSeasonData(params.data.season);
    return buildSeasonAwards(params.data.season, query.data.minimumAppearances, data);
  });
}
