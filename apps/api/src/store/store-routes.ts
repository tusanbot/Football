import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import { getStoreSnapshot, purchaseStoreItem, StoreError, useStoreItem } from "./store-service.js";

const purchaseSchema = z.object({
  itemKey: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(10).default(1),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,80}$/),
});
const useSchema = z.object({
  itemKey: z.string().min(1).max(64),
  playerId: z.string().min(1).max(64),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,80}$/),
});

function sendStoreError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof StoreError)) throw error;
  const status = ["INSUFFICIENT_FUNDS", "WALLET_NOT_FOUND", "CONCURRENT_MODIFICATION", "ITEM_NOT_IN_INVENTORY", "IDEMPOTENCY_CONFLICT"].includes(error.code) ? 409
    : ["CLUB_NOT_FOUND", "PLAYER_NOT_FOUND", "STORE_ITEM_NOT_FOUND"].includes(error.code) ? 404 : 400;
  return reply.code(status).send({ error: error.code });
}

export function registerStoreRoutes(app: FastifyInstance) {
  app.get("/v1/store", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    return getStoreSnapshot(user.id);
  });

  app.post("/v1/store/purchase", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = purchaseSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PURCHASE", details: parsed.error.flatten() });
    try {
      return { purchase: await purchaseStoreItem(user.id, parsed.data.itemKey, parsed.data.quantity, parsed.data.idempotencyKey) };
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });

  app.post("/v1/store/use", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = useSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_USE", details: parsed.error.flatten() });
    try {
      return { usage: await useStoreItem(user.id, parsed.data.itemKey, parsed.data.playerId, parsed.data.idempotencyKey) };
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });
}
