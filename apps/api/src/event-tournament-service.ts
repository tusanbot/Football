import { Prisma, type PlayerPosition, type WalletAsset } from "@prisma/client";
import { prisma } from "./db.js";

export async function finalizeEventTournamentFromCompetition(competitionId: string, now = new Date()) {
  const tournament = await prisma.eventTournament.findUnique({
    where: { competitionId },
    include: { prizes: true, participants: { select: { id: true, userId: true, clubId: true, prizeSettledAt: true } } },
  });
  if (!tournament || tournament.status !== "ACTIVE") {
    return { finalized: false, replayed: true, participants: 0, awards: 0 };
  }
  const competition = await prisma.competition.findUnique({ where: { id: competitionId }, select: { status: true } });
  if (competition?.status !== "COMPLETED") {
    return { finalized: false, replayed: false, participants: tournament.participants.length, awards: 0 };
  }
  const standings = await prisma.competitionEntry.findMany({
    where: { competitionId }, include: { club: { select: { name: true } } },
  });
  standings.sort((a, b) => b.points - a.points
    || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
    || b.goalsFor - a.goalsFor || a.club.name.localeCompare(b.club.name));
  const positionByClub = new Map(standings.map((entry, index) => [entry.clubId, { placement: index + 1, score: entry.points }]));
  let awarded = 0;

  // Settle each participant independently. A transient failure can then retry
  // without rolling back already settled participants or duplicating rewards.
  for (const participant of tournament.participants) {
    if (participant.prizeSettledAt) continue;
    const result = positionByClub.get(participant.clubId);
    if (!result) throw new Error("EVENT_TOURNAMENT_STANDING_MISSING");
    const prizes = tournament.prizes.filter((prize) =>
      prize.placement === result.placement || (result.placement > 3 && prize.placement === 0));

    const participantAwards = await prisma.$transaction(async (tx) => {
      await tx.eventTournamentParticipant.update({
        where: { id: participant.id },
        data: { placement: result.placement, score: result.score },
      });
      let participantAwarded = 0;
      for (const prize of prizes) {
        const previous = await tx.eventTournamentPrizeAward.findUnique({
          where: { participantId_prizeId: { participantId: participant.id, prizeId: prize.id } },
        });
        if (previous) continue;

        let status = "AWARDED";
        let detail: Prisma.InputJsonObject = {};
        if (["CASH", "GOLD", "HONOR"].includes(prize.type)) {
          const asset = prize.type as WalletAsset;
          const wallet = await tx.wallet.upsert({
            where: { userId_asset: { userId: participant.userId, asset } },
            create: { userId: participant.userId, asset, balance: 0n },
            update: {},
            select: { id: true, balance: true, version: true },
          });
          const updated = await tx.wallet.updateMany({
            where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
            data: { balance: { increment: prize.amount }, version: { increment: 1 } },
          });
          if (updated.count !== 1) throw new Error("CONCURRENT_MODIFICATION");
          await tx.ledgerTransaction.create({ data: {
            idempotencyKey: "event-tournament-prize:" + tournament.id + ":" + participant.id + ":" + prize.id,
            userId: participant.userId, asset, direction: "CREDIT", amount: prize.amount,
            reason: "EVENT_TOURNAMENT_PRIZE", referenceType: "event-tournament", referenceId: tournament.id,
          } });
          detail = { asset, amount: prize.amount.toString() };
        } else if (prize.type === "STORE_ITEM") {
          if (!prize.itemKey) throw new Error("TOURNAMENT_STORE_ITEM_KEY_MISSING");
          const inventory = await tx.storeInventoryItem.upsert({
            where: { userId_itemKey: { userId: participant.userId, itemKey: prize.itemKey } },
            create: { userId: participant.userId, itemKey: prize.itemKey, quantity: 1 },
            update: { quantity: { increment: 1 } },
            select: { quantity: true },
          });
          detail = { itemKey: prize.itemKey, quantity: inventory.quantity };
        } else {
          if (!prize.specialPlayerId) throw new Error("TOURNAMENT_SPECIAL_PLAYER_MISSING");
          const special = await tx.specialPlayer.findUnique({ where: { id: prize.specialPlayerId } });
          if (!special?.active) throw new Error("SPECIAL_PLAYER_NOT_AVAILABLE");
          const owned = await tx.player.findFirst({
            where: { clubId: participant.clubId, specialPlayerId: special.id },
            select: { id: true },
          });
          if (owned) {
            status = "SKIPPED_ALREADY_OWNED";
          } else {
            const allowedPositions: PlayerPosition[] = ["GK", "RB", "LB", "CB", "CDM", "CM", "CAM", "RW", "LW", "ST"];
            const position = (special.positions.find((item) => allowedPositions.includes(item as PlayerPosition)) ?? "ST") as PlayerPosition;
            const age = special.birthDate ? Math.max(16, new Date().getFullYear() - special.birthDate.getFullYear()) : 28;
            const player = await tx.player.create({ data: {
              clubId: participant.clubId,
              firstName: special.fullName.split(" ")[0] ?? special.fullName,
              lastName: special.fullName.split(" ").slice(1).join(" ") || "Legend",
              nationality: special.nationality,
              age,
              position,
              overall: special.overall,
              potential: special.potential,
              marketValue: BigInt(special.overall * 10_000),
              attributes: special.attributes === null ? Prisma.JsonNull : special.attributes as Prisma.InputJsonValue,
              wage: BigInt(special.overall * 50),
              contractDays: 365,
              origin: "SPECIAL",
              status: "ACTIVE",
              specialPlayerId: special.id,
            }, select: { id: true } });
            await tx.specialPlayerAcquisition.create({ data: {
              idempotencyKey: "event-tournament-special:" + tournament.id + ":" + participant.id + ":" + prize.id,
              userId: participant.userId,
              clubId: participant.clubId,
              specialPlayerId: special.id,
              playerId: player.id,
              method: "EVENT_TOURNAMENT",
              asset: "HONOR",
              amount: 0n,
            } });
            detail = { specialPlayerId: special.id, playerId: player.id };
          }
        }
        await tx.eventTournamentPrizeAward.create({
          data: { participantId: participant.id, prizeId: prize.id, status, detail },
        });
        if (status === "AWARDED") participantAwarded += 1;
      }
      await tx.eventTournamentParticipant.update({
        where: { id: participant.id },
        data: { prizeSettledAt: now },
      });
      return participantAwarded;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000, maxWait: 10_000 });
    awarded += participantAwards;
  }

  const winners = standings.slice(0, 3).map((entry, index) =>
    (index + 1) + ". " + entry.club.name + " · " + entry.points + " امتیاز");
  const finalization = await prisma.$transaction(async (tx) => {
    const current = await tx.eventTournament.findUnique({
      where: { id: tournament.id },
      select: { status: true, endsAt: true },
    });
    if (!current || current.status !== "ACTIVE") {
      return { finalized: false, replayed: true, participants: tournament.participants.length, awards: awarded };
    }
    const unsettled = await tx.eventTournamentParticipant.count({
      where: { tournamentId: tournament.id, prizeSettledAt: null },
    });
    if (unsettled > 0) {
      return { finalized: false, replayed: false, participants: tournament.participants.length, awards: awarded };
    }
    const updated = await tx.eventTournament.updateMany({
      where: { id: tournament.id, status: "ACTIVE" },
      data: { status: "COMPLETED", finalizedAt: now, endsAt: current.endsAt ?? now },
    });
    if (updated.count !== 1) {
      return { finalized: false, replayed: true, participants: tournament.participants.length, awards: awarded };
    }
    await tx.leagueNotice.createMany({
      data: tournament.participants.map((participant) => {
        const placement = positionByClub.get(participant.clubId)?.placement ?? 0;
        const rewards = tournament.prizes
          .filter((prize) => prize.placement === placement || (placement > 3 && prize.placement === 0))
          .map((prize) => prize.type === "CASH" || prize.type === "GOLD" || prize.type === "HONOR"
            ? prize.type + " · " + prize.amount.toString()
            : prize.type === "STORE_ITEM" ? "آیتم فروشگاه · " + (prize.itemKey ?? "") : "بازیکن ویژه")
          .join("، ");
        return {
          userId: participant.userId,
          kind: "EVENT_TOURNAMENT_RESULT",
          title: "نتیجه نهایی تورنمنت «" + tournament.title + "»",
          body: "تورنمنت به پایان رسید.\n" + winners.join("\n")
            + "\n\nرتبه باشگاه شما: " + placement
            + "\nجوایز شما: " + (rewards || "جایزه‌ای برای این رتبه تعریف نشده است."),
          referenceId: competitionId,
          dedupeKey: "event-tournament-result:" + tournament.id + ":" + participant.userId,
        };
      }),
      skipDuplicates: true,
    });
    return { finalized: true, replayed: false, participants: tournament.participants.length, awards: awarded };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000, maxWait: 10_000 });

  return finalization;
}

/** Retry completed competitions whose tournament prize settlement was interrupted. */
export async function processDueEventTournamentFinalizations(now = new Date(), limit = 1) {
  const candidates = await prisma.eventTournament.findMany({
    where: { status: "ACTIVE", competition: { is: { status: "COMPLETED" } } },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(Math.trunc(limit), 1), 10),
    select: { competitionId: true },
  });
  let finalized = 0;
  let failed = 0;
  for (const candidate of candidates) {
    if (!candidate.competitionId) continue;
    try {
      const result = await finalizeEventTournamentFromCompetition(candidate.competitionId, now);
      if (result.finalized) finalized += 1;
    } catch (error) {
      failed += 1;
      console.error("Event tournament finalization retry failed", {
        competitionId: candidate.competitionId,
        message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      });
    }
  }
  return { candidates: candidates.length, finalized, failed };
}
