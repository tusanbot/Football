import { PrismaClient } from "@prisma/client";
import { SPECIAL_PLAYER_CATALOG } from "../src/players/special-catalog.js";

const prisma = new PrismaClient();

async function main() {
  for (const player of SPECIAL_PLAYER_CATALOG) {
    await prisma.specialPlayer.upsert({
      where: { slug: player.slug },
      create: {
        ...player,
        birthDate: new Date(player.birthDate),
        sourceNote: "Curated public biographical data; gameplay ratings are Football Empire balancing values.",
      },
      update: {
        fullName: player.fullName,
        nationality: player.nationality,
        birthDate: new Date(player.birthDate),
        positions: [...player.positions],
        rarity: player.rarity,
        acquisitionMethods: [...player.acquisitionMethods],
        overall: player.overall,
        potential: player.potential,
        attributes: player.attributes,
        active: true,
      },
    });
  }
  console.log(`Upserted ${SPECIAL_PLAYER_CATALOG.length} special players.`);
}

main().finally(async () => prisma.$disconnect());
