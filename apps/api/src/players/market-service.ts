import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { settleClubDailyState } from "./player-development-service.js";
import { getMarketPurchasePort } from "./market-purchase-context.js";
import { getMarketListingPort } from "./market-listing-context.js";

export class MarketError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MarketError"; }
}

export async function createMarketListing(userId: string, playerId: string, askingPrice: bigint, expiresInHours: number) {
  await settleClubDailyState(userId);
  const listingPort = getMarketListingPort();
  if (listingPort) {
    try {
      return await listingPort.create({ userId, playerId, askingPrice: askingPrice.toString(), expiresInHours });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code) throw new MarketError(code);
      throw error;
    }
  }
  const club = await prisma.club.findUnique({ where: { ownerId: userId }, select: { id: true } });
  if (!club) throw new MarketError("CLUB_NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const player = await tx.player.findFirst({ where: { id: playerId, clubId: club.id } });
    if (!player) throw new MarketError("PLAYER_NOT_FOUND");
    if (player.origin !== "GENERATED") throw new MarketError("SPECIAL_PLAYERS_NOT_TRADEABLE");
    if (player.status !== "ACTIVE") throw new MarketError("PLAYER_NOT_AVAILABLE");
    const activeRuntime = await tx.footballMatch.findFirst({
      where: {
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        OR: [{ homeClubId: club.id }, { awayClubId: club.id }],
        runtime: { isNot: null },
      },
      select: { id: true },
    });
    if (activeRuntime) throw new MarketError("MARKET_LOCKED_DURING_MATCH");
    const eligiblePlayers = await tx.player.findMany({
      where: { clubId: club.id, status: "ACTIVE", suspensionMatchesRemaining: 0 },
      select: { id: true, position: true },
    });
    const remainingPlayers = eligiblePlayers.filter((candidate) => candidate.id !== player.id);
    if (remainingPlayers.length < 11 || !remainingPlayers.some((candidate) => candidate.position === "GK")) {
      throw new MarketError("MINIMUM_ACTIVE_SQUAD_REQUIRED");
    }
    const changed = await tx.player.updateMany({
      where: { id: player.id, clubId: club.id, status: "ACTIVE", origin: "GENERATED" },
      data: { status: "LISTED", lineupSlot: null },
    });
    if (changed.count !== 1) throw new MarketError("PLAYER_NOT_AVAILABLE");
    if (player.lineupSlot !== null) {
      await tx.club.update({ where: { id: club.id }, data: { lineupVersion: { increment: 1 } } });
    }
    return tx.playerMarketListing.create({
      data: {
        playerId: player.id, sellerClubId: club.id, askingPrice,
        expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
      },
      select: { id: true, playerId: true, askingPrice: true, status: true, expiresAt: true, createdAt: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function buyMarketListing(userId: string, listingId: string) {
  await settleClubDailyState(userId);
  const sellerIdentity = await prisma.playerMarketListing.findUnique({ where: { id: listingId }, select: { sellerClub: { select: { ownerId: true } } } });
  if (sellerIdentity?.sellerClub.ownerId) await settleClubDailyState(sellerIdentity.sellerClub.ownerId);
  const buyerClub = await prisma.club.findUnique({ where: { ownerId: userId }, select: { id: true } });
  if (!buyerClub) throw new MarketError("CLUB_NOT_FOUND");

  const purchasePort = getMarketPurchasePort();
  if (purchasePort) {
    try { return await purchasePort.purchase({ userId, listingId }); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code) throw new MarketError(code);
      throw error;
    }
  }

  return prisma.$transaction(async (tx) => {
    const listing = await tx.playerMarketListing.findUnique({
      where: { id: listingId },
      include: { player: true, sellerClub: { select: { id: true, ownerId: true } } },
    });
    if (!listing) throw new MarketError("LISTING_NOT_FOUND");
    if (listing.status === "SOLD" && listing.buyerClubId === buyerClub.id) {
      return { listingId, playerId: listing.playerId, price: listing.askingPrice.toString(), replayed: true };
    }
    if (listing.status !== "OPEN") throw new MarketError("LISTING_NOT_OPEN");
    if (listing.sellerClubId === buyerClub.id) throw new MarketError("CANNOT_BUY_OWN_PLAYER");
    const now = new Date();
    if (listing.player.contractDays <= 0) {
      await tx.playerMarketListing.update({ where: { id: listing.id }, data: { status: "EXPIRED" } });
      await tx.player.updateMany({ where: { id: listing.playerId, status: "LISTED", clubId: listing.sellerClubId }, data: { status: "CONTRACT_EXPIRED" } });
      return { error: "PLAYER_CONTRACT_EXPIRED" as const };
    }
    if (listing.expiresAt <= now) {
      await tx.playerMarketListing.update({ where: { id: listing.id }, data: { status: "EXPIRED" } });
      await tx.player.updateMany({ where: { id: listing.playerId, status: "LISTED", clubId: listing.sellerClubId }, data: { status: listing.player.contractDays > 0 ? "ACTIVE" : "CONTRACT_EXPIRED" } });
      return { error: "LISTING_EXPIRED" as const };
    }

    const buyerWallet = await tx.wallet.findUnique({ where: { userId_asset: { userId, asset: "CASH" } } });
    const sellerWallet = await tx.wallet.findUnique({ where: { userId_asset: { userId: listing.sellerClub.ownerId, asset: "CASH" } } });
    if (!buyerWallet || !sellerWallet) throw new MarketError("WALLET_NOT_FOUND");
    if (buyerWallet.balance < listing.askingPrice) throw new MarketError("INSUFFICIENT_FUNDS");

    const buyerUpdated = await tx.wallet.updateMany({
      where: { id: buyerWallet.id, balance: buyerWallet.balance, version: buyerWallet.version },
      data: { balance: { decrement: listing.askingPrice }, version: { increment: 1 } },
    });
    const sellerUpdated = await tx.wallet.updateMany({
      where: { id: sellerWallet.id, balance: sellerWallet.balance, version: sellerWallet.version },
      data: { balance: { increment: listing.askingPrice }, version: { increment: 1 } },
    });
    if (buyerUpdated.count !== 1 || sellerUpdated.count !== 1) throw new MarketError("CONCURRENT_MODIFICATION");

    const claimed = await tx.playerMarketListing.updateMany({
      where: { id: listing.id, status: "OPEN", expiresAt: { gt: now } },
      data: { status: "SOLD", buyerClubId: buyerClub.id },
    });
    if (claimed.count !== 1) throw new MarketError("LISTING_NOT_OPEN");

    const moved = await tx.player.updateMany({
      where: { id: listing.playerId, clubId: listing.sellerClubId, status: "LISTED", origin: "GENERATED" },
      data: { clubId: buyerClub.id, status: "ACTIVE" },
    });
    if (moved.count !== 1) throw new MarketError("PLAYER_OWNERSHIP_CHANGED");

    await tx.ledgerTransaction.createMany({ data: [
      { idempotencyKey: `market:${listing.id}:buyer`, userId, asset: "CASH", direction: "DEBIT", amount: listing.askingPrice, reason: "PLAYER_MARKET_PURCHASE", referenceType: "PLAYER_MARKET_LISTING", referenceId: listing.id },
      { idempotencyKey: `market:${listing.id}:seller`, userId: listing.sellerClub.ownerId, asset: "CASH", direction: "CREDIT", amount: listing.askingPrice, reason: "PLAYER_MARKET_SALE", referenceType: "PLAYER_MARKET_LISTING", referenceId: listing.id },
    ] });
    await tx.clubFinanceEntry.createMany({ data: [
      {
        idempotencyKey: `club-finance-market:${listing.id}:buyer`, clubId: buyerClub.id,
        category: "PLAYER_MARKET_PURCHASE", direction: "DEBIT", amount: listing.askingPrice,
        description: `Transfer purchase: ${listing.player.firstName} ${listing.player.lastName}`,
      },
      {
        idempotencyKey: `club-finance-market:${listing.id}:seller`, clubId: listing.sellerClubId,
        category: "PLAYER_MARKET_SALE", direction: "CREDIT", amount: listing.askingPrice,
        description: `Transfer sale: ${listing.player.firstName} ${listing.player.lastName}`,
      },
    ] });

    return { listingId, playerId: listing.playerId, price: listing.askingPrice.toString(), replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function cancelMarketListing(userId: string, listingId: string) {
  await settleClubDailyState(userId);
  const club = await prisma.club.findUnique({ where: { ownerId: userId }, select: { id: true } });
  if (!club) throw new MarketError("CLUB_NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const listing = await tx.playerMarketListing.findFirst({ where: { id: listingId, sellerClubId: club.id }, include: { player: { select: { contractDays: true } } } });
    if (!listing) throw new MarketError("LISTING_NOT_FOUND");
    if (listing.status !== "OPEN") throw new MarketError("LISTING_NOT_OPEN");
    const changed = await tx.playerMarketListing.updateMany({ where: { id: listing.id, status: "OPEN" }, data: { status: "CANCELLED" } });
    if (changed.count !== 1) throw new MarketError("LISTING_NOT_OPEN");
    await tx.player.updateMany({ where: { id: listing.playerId, clubId: club.id, status: "LISTED" }, data: { status: listing.player.contractDays > 0 ? "ACTIVE" : "CONTRACT_EXPIRED" } });
    return { listingId, status: "CANCELLED" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getOpenMarketListings() {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const expired = await tx.playerMarketListing.findMany({ where: { status: "OPEN", expiresAt: { lte: now } }, select: { id: true, playerId: true, sellerClubId: true, player: { select: { contractDays: true } } } });
    if (!expired.length) return;
    await tx.playerMarketListing.updateMany({ where: { id: { in: expired.map((item) => item.id) }, status: "OPEN" }, data: { status: "EXPIRED" } });
    for (const item of expired) {
      await tx.player.updateMany({ where: { id: item.playerId, clubId: item.sellerClubId, status: "LISTED" }, data: { status: item.player.contractDays > 0 ? "ACTIVE" : "CONTRACT_EXPIRED" } });
    }
  });
  return prisma.playerMarketListing.findMany({
    where: { status: "OPEN", expiresAt: { gt: now } },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    select: {
      id: true, askingPrice: true, expiresAt: true, createdAt: true,
      player: { select: { id: true, firstName: true, lastName: true, nationality: true, age: true, position: true, overall: true, potential: true, marketValue: true, wage: true } },
      sellerClub: { select: { id: true, name: true } },
    },
  }).then((items) => items.map((item) => ({
    ...item, askingPrice: item.askingPrice.toString(),
    player: { ...item.player, marketValue: item.player.marketValue.toString(), wage: item.player.wage.toString() },
  })));
}
