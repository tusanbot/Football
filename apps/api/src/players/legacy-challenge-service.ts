import { Prisma, type PlayerPosition } from "@prisma/client";
import { prisma } from "../db.js";

const LEGACY_CHALLENGES = [
  {
    slug: "pele-king-of-football",
    title: "پادشاه فوتبال",
    description: "در ۸۰ مسابقه رسمی شرکت کن و دست‌کم ۵۰ پیروزی به دست بیاور.",
    playerSlug: "pele",
    rewardName: "پله",
    requirements: { matches: 80, wins: 50, goals: 0 },
  },
  {
    slug: "maradona-hand-of-god",
    title: "جادوی شماره ۱۰",
    description: "در ۵۰ مسابقه شرکت کن، ۳۰ بار پیروز شو و با بازیکنان پست هافبک هجومی ۲۵ گل بزن.",
    playerSlug: "diego-maradona",
    rewardName: "دیه‌گو مارادونا",
    requirements: { matches: 50, wins: 30, goals: 25, position: "CAM" as const },
  },
  {
    slug: "van-basten-golden-boot",
    title: "کفش طلایی",
    description: "در ۴۰ مسابقه شرکت کن، ۱۵ برد به دست بیاور و با مهاجمان نوک ۳۰ گل ثبت کن.",
    playerSlug: "marco-van-basten",
    rewardName: "مارکو فان‌باستن",
    requirements: { matches: 40, wins: 15, goals: 30, position: "ST" as const },
  },
] as const;

export class LegacyChallengeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "LegacyChallengeError";
  }
}

type ProgressDb = Pick<Prisma.TransactionClient, "footballMatch" | "playerMatchPerformance">;

async function progressForClub(db: ProgressDb, clubId: string, challenge: typeof LEGACY_CHALLENGES[number]) {
  const matchWhere = {
    status: "COMPLETED" as const,
    OR: [{ homeClubId: clubId }, { awayClubId: clubId }],
  };
  const [matches, wins, performances] = await Promise.all([
    db.footballMatch.count({ where: matchWhere }),
    db.footballMatch.count({ where: { ...matchWhere, winnerClubId: clubId } }),
    db.playerMatchPerformance.findMany({
      where: { clubId },
      select: { goals: true, player: { select: { position: true } } },
    }),
  ]);
  const goals = performances.reduce((sum, item) => {
    if (challenge.requirements.position && item.player.position !== challenge.requirements.position) return sum;
    return sum + item.goals;
  }, 0);
  const requirements = challenge.requirements;
  return {
    matches, wins, goals,
    requiredMatches: requirements.matches,
    requiredWins: requirements.wins,
    requiredGoals: requirements.goals,
    completed: matches >= requirements.matches && wins >= requirements.wins && goals >= requirements.goals,
  };
}

function acquisitionKey(userId: string, slug: string) {
  return "legacy-challenge:" + userId + ":" + slug;
}

export function getLegacyChallengeDefinitions() {
  return LEGACY_CHALLENGES.map(({ slug, title, description, rewardName, requirements }) => ({
    slug, title, description, rewardName, requirements,
  }));
}

export async function listLegacyChallenges(userId: string) {
  const club = await prisma.club.findUnique({ where: { ownerId: userId }, select: { id: true } });
  if (!club) throw new LegacyChallengeError("CLUB_NOT_FOUND");
  const challenges = await Promise.all(LEGACY_CHALLENGES.map(async (challenge) => {
    const [progress, previous, reward, copies] = await Promise.all([
      progressForClub(prisma, club.id, challenge),
      prisma.specialPlayerAcquisition.findUnique({ where: { idempotencyKey: acquisitionKey(userId, challenge.slug) }, select: { id: true } }),
      prisma.specialPlayer.findUnique({ where: { slug: challenge.playerSlug }, select: { id: true, active: true } }),
      prisma.specialPlayer.findUnique({ where: { slug: challenge.playerSlug }, select: { _count: { select: { acquisitions: true } } } }),
    ]);
    return {
      ...challenge,
      progress,
      claimed: !!previous,
      available: !!reward?.active && (copies?._count.acquisitions ?? 0) < 1,
      canClaim: progress.completed && !previous && !!reward?.active && (copies?._count.acquisitions ?? 0) < 1,
    };
  }));
  return { challenges };
}

export async function claimLegacyChallenge(userId: string, slug: string) {
  const challenge = LEGACY_CHALLENGES.find((item) => item.slug === slug);
  if (!challenge) throw new LegacyChallengeError("LEGACY_CHALLENGE_NOT_FOUND");
  const idempotencyKey = acquisitionKey(userId, slug);
  try {
    return await prisma.$transaction(async (tx) => {
      const previous = await tx.specialPlayerAcquisition.findUnique({
        where: { idempotencyKey }, include: { specialPlayer: true },
      });
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
      const progress = await progressForClub(tx, club.id, challenge);
      if (!progress.completed) throw new LegacyChallengeError("LEGACY_CHALLENGE_NOT_COMPLETED");
      const special = await tx.specialPlayer.findUnique({ where: { slug: challenge.playerSlug } });
      if (!special || !special.active || !special.acquisitionMethods.includes("legacy_event")) {
        throw new LegacyChallengeError("LEGACY_REWARD_NOT_AVAILABLE");
      }
      const locked = await tx.specialPlayer.updateMany({
        where: { id: special.id, active: true },
        data: { updatedAt: new Date() },
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
        },
        select: { id: true },
      });
      const acquisition = await tx.specialPlayerAcquisition.create({
        data: {
          idempotencyKey, userId, clubId: club.id, specialPlayerId: special.id,
          playerId: player.id, method: "legacy_event", asset: "GOLD", amount: 0n,
        },
        select: { id: true },
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
      const previous = await prisma.specialPlayerAcquisition.findUnique({
        where: { idempotencyKey }, include: { specialPlayer: true },
      });
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
