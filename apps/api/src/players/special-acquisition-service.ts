import { randomInt } from "node:crypto";
import { Prisma, type PlayerPosition, type SpecialRarity } from "@prisma/client";
import { prisma } from "../db.js";

const PACKS = {
  epic_pack: { rarity: "EPIC", price: 10 },
  legendary_pack: { rarity: "LEGENDARY", price: 25 },
  icon_pack: { rarity: "ICON", price: 50 },
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
  }));
}

export async function acquireSpecialPlayer(userId: string, method: SpecialPackMethod, idempotencyKey: string) {
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(idempotencyKey)) {
    throw new SpecialAcquisitionError("INVALID_IDEMPOTENCY_KEY");
  }
  const pack = PACKS[method];
  if (!pack) throw new SpecialAcquisitionError("INVALID_ACQUISITION_METHOD");

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
        players: { none: { clubId: club.id } },
      },
      select: {
        id: true, fullName: true, nationality: true, birthDate: true,
        positions: true, rarity: true, overall: true, potential: true, attributes: true,
      },
    });
    if (!candidates.length) throw new SpecialAcquisitionError("NO_AVAILABLE_PLAYERS");

    const selected = candidates[randomInt(0, candidates.length)]!;
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
