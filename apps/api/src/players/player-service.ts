import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { generateStarterSquad } from "@football/domain";

export async function ensureStarterSquad(tx: Prisma.TransactionClient, clubId: string) {
  const existingCount = await tx.player.count({ where: { clubId } });
  if (existingCount > 0) return;
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
