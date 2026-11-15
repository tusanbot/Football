import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import { prisma } from "../db.js";
import { buyMarketListing, cancelMarketListing, createMarketListing, getOpenMarketListings, MarketError } from "./market-service.js";
import { acquireSpecialPlayer, getSpecialPackOffers, SpecialAcquisitionError } from "./special-acquisition-service.js";

const createSchema = z.object({
  playerId: z.string().min(1).max(64),
  askingPrice: z.string().regex(/^[1-9][0-9]{0,14}$/),
  expiresInHours: z.number().int().min(1).max(168).default(72),
});

const idSchema = z.object({ id: z.string().min(1).max(64) });
const specialAcquisitionSchema = z.object({ method: z.enum(["epic_pack", "legendary_pack", "icon_pack"]), idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,80}$/) });

function sendMarketError(reply: FastifyReply, error: unknown) {
  if (error instanceof SpecialAcquisitionError) {
    const status = error.code === "CLUB_NOT_FOUND" ? 404 : error.code === "INSUFFICIENT_GOLD" || error.code === "NO_AVAILABLE_PLAYERS" || error.code === "CONCURRENT_MODIFICATION" || error.code === "ACQUISITION_CONFLICT_RETRY" ? 409 : 400;
    return reply.code(status).send({ error: error.code });
  }
  if (error instanceof MarketError) {
    const status = error.code === "INSUFFICIENT_FUNDS" ? 409
      : error.code === "CLUB_NOT_FOUND" || error.code === "PLAYER_NOT_FOUND" || error.code === "LISTING_NOT_FOUND" ? 404
      : error.code === "WALLET_NOT_FOUND" ? 409 : 400;
    return reply.code(status).send({ error: error.code });
  }
  throw error;
}

export function registerPlayerMarketRoutes(app: FastifyInstance) {
  app.get("/v1/players/special", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const players = await prisma.specialPlayer.findMany({ where: { active: true }, orderBy: [{ rarity: "desc" }, { overall: "desc" }], select: { id: true, slug: true, fullName: true, nationality: true, birthDate: true, positions: true, rarity: true, overall: true, potential: true, attributes: true, acquisitionMethods: true } });
    return { players, packOffers: getSpecialPackOffers() };
  });
  app.post("/v1/players/special/acquire", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = specialAcquisitionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_ACQUISITION", details: parsed.error.flatten() });
    try {
      return { acquisition: await acquireSpecialPlayer(user.id, parsed.data.method, parsed.data.idempotencyKey) };
    } catch (error) {
      return sendMarketError(reply, error);
    }
  });

  app.get("/v1/market/my-listings", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const club = await prisma.club.findUnique({ where: { ownerId: user.id }, select: { id: true } });
    if (!club) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    const listings = await prisma.playerMarketListing.findMany({
      where: { sellerClubId: club.id, status: { in: ["OPEN", "SOLD", "CANCELLED", "EXPIRED"] } },
      orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, askingPrice: true, status: true, expiresAt: true, createdAt: true,
        player: { select: { id: true, firstName: true, lastName: true, overall: true, position: true, marketValue: true } } },
    });
    return { listings: listings.map((item) => ({ ...item, askingPrice: item.askingPrice.toString(), player: { ...item.player, marketValue: item.player.marketValue.toString() } })) };
  });

  app.get("/v1/market/listings", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    return { listings: await getOpenMarketListings() };
  });

  app.post("/v1/market/listings", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LISTING", details: parsed.error.flatten() });
    try {
      const listing = await createMarketListing(user.id, parsed.data.playerId, BigInt(parsed.data.askingPrice), parsed.data.expiresInHours);
      return reply.code(201).send({ listing: { ...listing, askingPrice: listing.askingPrice.toString() } });
    } catch (error) {
      return sendMarketError(reply, error);
    }
  });

  app.post("/v1/market/listings/:id/buy", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = idSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LISTING_ID" });
    try {
      const result = await buyMarketListing(user.id, parsed.data.id);
      if ("error" in result) return reply.code(410).send({ error: result.error });
      return { purchase: result };
    } catch (error) {
      return sendMarketError(reply, error);
    }
  });

  app.delete("/v1/market/listings/:id", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = idSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LISTING_ID" });
    try {
      return { listing: await cancelMarketListing(user.id, parsed.data.id) };
    } catch (error) {
      return sendMarketError(reply, error);
    }
  });
}
