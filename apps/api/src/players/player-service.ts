import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { buildDefaultLineup, type LineupCandidate, generateStarterSquad } from "@football/domain";

export async function ensureStarterSquad(tx: Prisma.TransactionClient, clubId: string) {
  await tx.coach.upsert({
    where: { clubId },
    create: { clubId, name: "Academy Coach", level: 1, trainingSkill: 35, recoverySkill: 30, medicalSkill: 25, weeklySalary: 100n },
    update: {},
  });
  const existingCount = await tx.player.count({ where: { clubId } });
  if (existingCount === 0) {
    const squad = generateStarterSquad(randomInt);
    await tx.player.createMany({
      data: squad.map((player) => ({
        clubId,
        firstName: player.firstName,
        lastName: player.lastName,
        nationality: player.nationality,
        age: player.age,
        position: player.position,
        overall: player.overall,
        potential: player.potential,
        attributes: player.attributes,
        wage: player.wage,
        contractDays: player.contractDays,
        origin: "GENERATED",
      })),
    });
  }

  // Existing clubs created before the lineup feature receive a default XI once.
  // Never overwrite a manager's already configured lineup on later logins.
  const assignedCount = await tx.player.count({ where: { clubId, lineupSlot: { not: null } } });
  if (assignedCount > 0) return;

  const candidates = await tx.player.findMany({
    where: { clubId, status: "ACTIVE" },
    select: { id: true, position: true, overall: true },
  });
  const lineup = buildDefaultLineup(candidates.map((player) => ({
    id: player.id,
    position: player.position as LineupCandidate["position"],
    overall: player.overall,
  })));
  if (!lineup) return;

  await Promise.all(lineup.map((playerId, index) =>
    tx.player.update({ where: { id: playerId }, data: { lineupSlot: index + 1 } }),
  ));
}
