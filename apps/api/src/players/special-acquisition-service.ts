import { randomInt } from "node:crypto";
import { Prisma, type PlayerPosition, type SpecialRarity } from "@prisma/client";
import { prisma } from "../db.js";
import { getSpecialAcquisitionPort } from "./special-acquisition-context.js";

const PACKS = {
  epic_pack: { rarity: "EPIC", price: 250, maxCopies: 10 },
  legendary_pack: { rarity: "LEGENDARY", price: 2_500, maxCopies: 3 },
  icon_pack: { rarity: "ICON", price: 25_000, maxCopies: 1 },
} as const;

export type SpecialPackMethod = keyof typeof PACKS;

export class SpecialAcquisitionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SpecialAcquisitionError";
  }
}

export function getSpecialPackOffers() {
  return Object.entries(PACKS).map(([method, pack]) => ({
    method,
    rarity: pack.rarity,
    priceGold: String(pack.price),
    maxCopiesPerPlayer: pack.maxCopies,
  }));
}

export async function acquireSpecialPlayer(userId: string, method: SpecialPackMethod, idempotencyKey: string) {
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(idempotencyKey)) {
    throw new SpecialAcquisitionError("INVALID_IDEMPOTENCY_KEY");
  }
  const pack = PACKS[method];
  if (!pack) throw new SpecialAcquisitionError("INVALID_ACQUISITION_METHOD");
  const acquisitionPort = getSpecialAcquisitionPort();
  if (acquisitionPort) {
    try { return await acquisitionPort.acquire({ userId, method, idempotencyKey }); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
      if (code) throw new SpecialAcquisitionError(code);
      throw error;
    }
  }

  const execute = () => prisma.$transaction(async (tx) => {
    const previous = await tx.specialPlayerAcquisition.findUnique({
      where: { idempotencyKey },
      include: { specialPlayer: true },
    });
    if (previous) {
      if (previous.userId !== userId || previous.method !== method) {
        throw new SpecialAcquisitionError("IDEMPOTENCY_CONFLICT");
      }
      const wallet = await tx.wallet.findUnique({
        where: { userId_asset: { userId, asset: "GOLD" } },
        select: { balance: true },
      });
      return {
        acquisitionId: previous.id,
        method: previous.method,
        playerId: previous.playerId,
        specialPlayer: {
          id: previous.specialPlayer.id,
          fullName: previous.specialPlayer.fullName,
          rarity: previous.specialPlayer.rarity,
          overall: previous.specialPlayer.overall,
        },
        goldBalance: wallet?.balance.toString() ?? "0",
        replayed: true,
      };
    }

    const club = await tx.club.findUnique({ where: { ownerId: userId }, select: { id: true } });
    if (!club) throw new SpecialAcquisitionError("CLUB_NOT_FOUND");

    const wallet = await tx.wallet.findUnique({
      where: { userId_asset: { userId, asset: "GOLD" } },
      select: { id: true, balance: true, version: true },
    });
    if (!wallet) throw new SpecialAcquisitionError("WALLET_NOT_FOUND");
    const price = BigInt(pack.price);
    if (wallet.balance < price) throw new SpecialAcquisitionError("INSUFFICIENT_GOLD");

    const candidates = await tx.specialPlayer.findMany({
      where: {
        active: true,
        rarity: pack.rarity as SpecialRarity,
        acquisitionMethods: { has: method },
        players: { none: { clubId: club.id } },
      },
      select: {
        id: true, fullName: true, nationality: true, birthDate: true,
        positions: true, rarity: true, overall: true, potential: true, attributes: true,
        _count: { select: { acquisitions: true } },
      },
    });
    const available = candidates.filter((candidate) => candidate._count.acquisitions < pack.maxCopies);
    if (!available.length) throw new SpecialAcquisitionError("NO_AVAILABLE_PLAYERS");

    const selected = available[randomInt(0, available.length)]!;
    // Serialize acquisitions for this exact card across all clubs. A concurrent
    // transaction that selected the same card must retry after this row lock.
    const cardLock = await tx.specialPlayer.updateMany({
      where: { id: selected.id, active: true },
      data: { updatedAt: new Date() },
    });
    if (cardLock.count !== 1) throw new SpecialAcquisitionError("NO_AVAILABLE_PLAYERS");
    const currentCopies = await tx.specialPlayerAcquisition.count({ where: { specialPlayerId: selected.id } });
    if (currentCopies >= pack.maxCopies) throw new SpecialAcquisitionError("NO_AVAILABLE_PLAYERS");
    const updated = await tx.wallet.updateMany({
      where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
      data: { balance: { decrement: price }, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new SpecialAcquisitionError("CONCURRENT_MODIFICATION");

    const [firstName, ...lastParts] = selected.fullName.split(/\s+/);
    const player = await tx.player.create({
      data: {
        clubId: club.id,
        firstName: firstName || selected.fullName,
        lastName: lastParts.join(" ") || "Legend",
        nationality: selected.nationality,
        age: 28,
        position: (selected.positions[0] || "ST") as PlayerPosition,
        overall: selected.overall,
        potential: selected.potential,
        attributes: selected.attributes === null ? Prisma.JsonNull : selected.attributes as Prisma.InputJsonValue,
        wage: BigInt(selected.overall * 3),
        contractDays: 365,
        origin: "SPECIAL",
        status: "ACTIVE",
        specialPlayerId: selected.id,
      },
      select: { id: true },
    });

    const acquisition = await tx.specialPlayerAcquisition.create({
      data: {
        idempotencyKey,
        userId,
        clubId: club.id,
        specialPlayerId: selected.id,
        playerId: player.id,
        method,
        asset: "GOLD",
        amount: price,
      },
      select: { id: true },
    });

    await tx.ledgerTransaction.create({
      data: {
        idempotencyKey: `special-acquisition:${idempotencyKey}`,
        userId,
        asset: "GOLD",
        direction: "DEBIT",
        amount: price,
        reason: "SPECIAL_PLAYER_ACQUISITION",
        referenceType: "SPECIAL_PLAYER_ACQUISITION",
        referenceId: acquisition.id,
      },
    });

    return {
      acquisitionId: acquisition.id,
      method,
      playerId: player.id,
      specialPlayer: {
        id: selected.id,
        fullName: selected.fullName,
        rarity: selected.rarity,
        overall: selected.overall,
      },
      goldBalance: (wallet.balance - price).toString(),
      replayed: false,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  try {
    return await execute();
  } catch (error) {
    if (error instanceof SpecialAcquisitionError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const previous = await prisma.specialPlayerAcquisition.findUnique({
        where: { idempotencyKey },
        include: { specialPlayer: true },
      });
      if (previous && previous.userId === userId && previous.method === method) {
        const wallet = await prisma.wallet.findUnique({
          where: { userId_asset: { userId, asset: "GOLD" } },
          select: { balance: true },
        });
        return {
          acquisitionId: previous.id,
          playerId: previous.playerId,
          specialPlayer: {
            id: previous.specialPlayer.id,
            fullName: previous.specialPlayer.fullName,
            rarity: previous.specialPlayer.rarity,
            overall: previous.specialPlayer.overall,
          },
          goldBalance: wallet?.balance.toString() ?? "0",
          replayed: true,
        };
      }
      throw new SpecialAcquisitionError("ACQUISITION_CONFLICT_RETRY");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new SpecialAcquisitionError("CONCURRENT_MODIFICATION");
    }
    throw error;
  }
}

const LEGACY_CHALLENGES = [
  {
    slug: "pele-king-of-football",
    title: "پادشاه فوتبال",
    description: "در ۸۰ مسابقه شرکت کن و دست‌کم ۵۰ پیروزی به دست بیاور.",
    playerSlug: "pele", rewardName: "پله",
    requirements: { matches: 80, wins: 50, goals: 0 },
  },
  {
    slug: "maradona-hand-of-god",
    title: "جادوی شماره ۱۰",
    description: "در ۵۰ مسابقه شرکت کن، ۳۰ بار پیروز شو و با بازیکنان هافبک هجومی ۲۵ گل بزن.",
    playerSlug: "diego-maradona", rewardName: "دیه‌گو مارادونا",
    requirements: { matches: 50, wins: 30, goals: 25, position: "CAM" as const },
  },
  {
    slug: "van-basten-golden-boot",
    title: "کفش طلایی",
    description: "در ۴۰ مسابقه شرکت کن، ۱۵ برد به دست بیاور و با مهاجمان نوک ۳۰ گل ثبت کن.",
    playerSlug: "marco-van-basten", rewardName: "مارکو فان‌باستن",
    requirements: { matches: 40, wins: 15, goals: 30, position: "ST" as const },
  },
] as const;

export class LegacyChallengeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "LegacyChallengeError";
  }
}

type LegacyProgressDb = Pick<Prisma.TransactionClient, "footballMatch" | "playerMatchPerformance">;

async function legacyProgressForClub(db: LegacyProgressDb, clubId: string, challenge: typeof LEGACY_CHALLENGES[number]) {
  const matchWhere = {
    status: "COMPLETED" as const,
    OR: [{ homeClubId: clubId }, { awayClubId: clubId }],
  };
  const [matches, wins, performances] = await Promise.all([
    db.footballMatch.count({ where: matchWhere }),
    db.footballMatch.count({ where: { ...matchWhere, winnerClubId: clubId } }),
    db.playerMatchPerformance.findMany({ where: { clubId }, select: { goals: true, player: { select: { position: true } } } }),
  ]);
  const requiredPosition = "position" in challenge.requirements ? challenge.requirements.position : undefined;
  const goals = performances.reduce((sum, item) =>
    sum + (requiredPosition && item.player.position !== requiredPosition ? 0 : item.goals), 0);
  return {
    matches, wins, goals,
    requiredMatches: challenge.requirements.matches,
    requiredWins: challenge.requirements.wins,
    requiredGoals: challenge.requirements.goals,
    completed: matches >= challenge.requirements.matches && wins >= challenge.requirements.wins && goals >= challenge.requirements.goals,
  };
}

function legacyAcquisitionKey(userId: string, slug: string) {
  return "legacy-challenge:" + userId + ":" + slug;
}

export async function listLegacyChallenges(userId: string) {
  const acquisitionPort = getSpecialAcquisitionPort();
  if (acquisitionPort) {
    try { return await acquisitionPort.listLegacyChallenges(userId); }
    catch (error) { throw new LegacyChallengeError(error instanceof Error ? error.message : "LEGACY_CHALLENGES_UNAVAILABLE"); }
  }
  const club = await prisma.club.findUnique({ where: { ownerId: userId }, select: { id: true } });
  if (!club) throw new LegacyChallengeError("CLUB_NOT_FOUND");
  const challenges = await Promise.all(LEGACY_CHALLENGES.map(async (challenge) => {
    const [progress, previous, reward] = await Promise.all([
      legacyProgressForClub(prisma, club.id, challenge),
      prisma.specialPlayerAcquisition.findUnique({
        where: { idempotencyKey: legacyAcquisitionKey(userId, challenge.slug) }, select: { id: true },
      }),
      prisma.specialPlayer.findUnique({
        where: { slug: challenge.playerSlug },
        select: { id: true, active: true, _count: { select: { acquisitions: true } } },
      }),
    ]);
    const available = !!reward?.active && reward._count.acquisitions < 1;
    return {
      slug: challenge.slug, title: challenge.title, description: challenge.description,
      rewardName: challenge.rewardName, progress, claimed: !!previous, available,
      canClaim: progress.completed && !previous && available,
    };
  }));
  return { challenges };
}

export async function claimLegacyChallenge(userId: string, slug: string) {
  const acquisitionPort = getSpecialAcquisitionPort();
  if (acquisitionPort) {
    try { return await acquisitionPort.claimLegacyChallenge(userId, slug); }
    catch (error) { throw new LegacyChallengeError(error instanceof Error ? error.message : "LEGACY_CHALLENGE_CLAIM_FAILED"); }
  }
  const challenge = LEGACY_CHALLENGES.find((item) => item.slug === slug);
  if (!challenge) throw new LegacyChallengeError("LEGACY_CHALLENGE_NOT_FOUND");
  const idempotencyKey = legacyAcquisitionKey(userId, slug);
  try {
    return await prisma.$transaction(async (tx) => {
      const previous = await tx.specialPlayerAcquisition.findUnique({ where: { idempotencyKey }, include: { specialPlayer: true } });
      if (previous) {
        if (previous.userId !== userId || previous.method !== "legacy_event") throw new LegacyChallengeError("IDEMPOTENCY_CONFLICT");
        return {
          acquisitionId: previous.id, playerId: previous.playerId,
          specialPlayer: { id: previous.specialPlayer.id, fullName: previous.specialPlayer.fullName, rarity: previous.specialPlayer.rarity, overall: previous.specialPlayer.overall },
          replayed: true,
        };
      }
      const club = await tx.club.findUnique({ where: { ownerId: userId }, select: { id: true } });
      if (!club) throw new LegacyChallengeError("CLUB_NOT_FOUND");
      const progress = await legacyProgressForClub(tx, club.id, challenge);
      if (!progress.completed) throw new LegacyChallengeError("LEGACY_CHALLENGE_NOT_COMPLETED");
      const special = await tx.specialPlayer.findUnique({ where: { slug: challenge.playerSlug } });
      if (!special || !special.active || !special.acquisitionMethods.includes("legacy_event")) {
        throw new LegacyChallengeError("LEGACY_REWARD_NOT_AVAILABLE");
      }
      const locked = await tx.specialPlayer.updateMany({
        where: { id: special.id, active: true }, data: { updatedAt: new Date() },
      });
      if (locked.count !== 1) throw new LegacyChallengeError("LEGACY_REWARD_ALREADY_CLAIMED");
      const copies = await tx.specialPlayerAcquisition.count({ where: { specialPlayerId: special.id } });
      if (copies >= 1) throw new LegacyChallengeError("LEGACY_REWARD_ALREADY_CLAIMED");
      const [firstName, ...lastParts] = special.fullName.split(/\\s+/);
      const player = await tx.player.create({
        data: {
          clubId: club.id, firstName: firstName || special.fullName,
          lastName: lastParts.join(" ") || "Legend", nationality: special.nationality,
          age: 28, position: (special.positions[0] || "ST") as PlayerPosition,
          overall: special.overall, potential: special.potential,
          attributes: special.attributes === null ? Prisma.JsonNull : special.attributes as Prisma.InputJsonValue,
          wage: BigInt(special.overall * 3), contractDays: 365, origin: "SPECIAL",
          status: "ACTIVE", specialPlayerId: special.id,
        }, select: { id: true },
      });
      const acquisition = await tx.specialPlayerAcquisition.create({
        data: {
          idempotencyKey, userId, clubId: club.id, specialPlayerId: special.id,
          playerId: player.id, method: "legacy_event", asset: "GOLD", amount: 0n,
        }, select: { id: true },
      });
      return {
        acquisitionId: acquisition.id, playerId: player.id,
        specialPlayer: { id: special.id, fullName: special.fullName, rarity: special.rarity, overall: special.overall },
        replayed: false,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof LegacyChallengeError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const previous = await prisma.specialPlayerAcquisition.findUnique({ where: { idempotencyKey }, include: { specialPlayer: true } });
      if (previous && previous.userId === userId && previous.method === "legacy_event") {
        return {
          acquisitionId: previous.id, playerId: previous.playerId,
          specialPlayer: { id: previous.specialPlayer.id, fullName: previous.specialPlayer.fullName, rarity: previous.specialPlayer.rarity, overall: previous.specialPlayer.overall },
          replayed: true,
        };
      }
      throw new LegacyChallengeError("LEGACY_REWARD_ALREADY_CLAIMED");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new LegacyChallengeError("CONCURRENT_MODIFICATION");
    }
    throw error;
  }
}
