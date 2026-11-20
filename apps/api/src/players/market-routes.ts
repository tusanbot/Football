import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import { buyMarketListing, cancelMarketListing, createMarketListing, getOpenMarketListings, MarketError } from "./market-service.js";
import { getMarketListingPort } from "./market-listing-context.js";
import { getSpecialAcquisitionPort } from "./special-acquisition-context.js";
import {
  acquireSpecialPlayer, getSpecialPackOffers, SpecialAcquisitionError,
  listLegacyChallenges, claimLegacyChallenge, LegacyChallengeError,
} from "./special-acquisition-service.js";

const createSchema = z.object({
  playerId: z.string().min(1).max(64),
  askingPrice: z.string().regex(/^[1-9][0-9]{0,14}$/),
  expiresInHours: z.number().int().min(1).max(168).default(72),
});

const idSchema = z.object({ id: z.string().min(1).max(64) });
const specialAcquisitionSchema = z.object({ method: z.enum(["epic_pack", "legendary_pack", "icon_pack"]), idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,80}$/) });

function sendMarketError(reply: FastifyReply, error: unknown) {
  if (error instanceof Error && "code" in error && String((error as { code: unknown }).code).startsWith("SUPABASE_")) {
    return reply.code(503).send({ error: String((error as { code: unknown }).code) });
  }
  if (error instanceof LegacyChallengeError) {
    const status = ["CLUB_NOT_FOUND", "LEGACY_CHALLENGE_NOT_FOUND"].includes(error.code) ? 404
      : ["LEGACY_CHALLENGE_NOT_COMPLETED", "LEGACY_REWARD_ALREADY_CLAIMED", "CONCURRENT_MODIFICATION"].includes(error.code) ? 409 : 400;
    return reply.code(status).send({ error: error.code });
  }
  if (error instanceof SpecialAcquisitionError) {
    const status = error.code === "CLUB_NOT_FOUND" ? 404 : error.code === "INSUFFICIENT_GOLD" || error.code === "NO_AVAILABLE_PLAYERS" || error.code === "CONCURRENT_MODIFICATION" || error.code === "ACQUISITION_CONFLICT_RETRY" ? 409 : 400;
    return reply.code(status).send({ error: error.code });
  }
  if (error instanceof MarketError) {
    const status = error.code === "INSUFFICIENT_FUNDS" ? 409
      : error.code === "CLUB_NOT_FOUND" || error.code === "PLAYER_NOT_FOUND" || error.code === "LISTING_NOT_FOUND" ? 404
      : error.code === "WALLET_NOT_FOUND" || error.code === "MARKET_LOCKED_DURING_MATCH" || error.code === "MINIMUM_ACTIVE_SQUAD_REQUIRED" ? 409 : 400;
    return reply.code(status).send({ error: error.code });
  }
  throw error;
}

export function registerPlayerMarketRoutes(app: FastifyInstance) {
  app.get("/v1/players/special/challenges", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try { return await listLegacyChallenges(user.id); }
    catch (error) { return sendMarketError(reply, error); }
  });

  app.post("/v1/players/special/challenges/:slug/claim", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = z.object({ slug: z.string().min(1).max(64) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LEGACY_CHALLENGE" });
    try { return { acquisition: await claimLegacyChallenge(user.id, parsed.data.slug) }; }
    catch (error) { return sendMarketError(reply, error); }
  });

  app.get("/v1/players/special", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const acquisitionPort = getSpecialAcquisitionPort();
    if (!acquisitionPort?.listActive) return reply.code(503).send({ error: "SUPABASE_SPECIAL_PLAYER_CATALOG_UNAVAILABLE" });
    const players = await acquisitionPort.listActive();
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
    const listingPort = getMarketListingPort();
    if (!listingPort) return reply.code(503).send({ error: "SUPABASE_MARKET_LISTING_UNAVAILABLE" });
    return { listings: await listingPort.listMine(user.id) };
  });

  app.get("/v1/market/listings", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try { return { listings: await getOpenMarketListings() }; }
    catch (error) { return sendMarketError(reply, error); }
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
