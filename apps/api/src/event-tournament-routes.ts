import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, type PlayerPosition, type WalletAsset } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireTelegramUser } from "./auth/require-telegram-user.js";
import { parseAdminTelegramIds } from "./runtime-config.js";
import { consumeAllianceActionRateLimit } from "./groups/alliance-rate-limit.js";
import { getStoreItem } from "./store/catalog.js";

type Permission = "read" | "competitions";
const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  superadmin: ["read", "competitions"],
  football: ["read", "competitions"],
  economy: ["read"],
  moderator: ["read"],
};

async function authorize(request: FastifyRequest, reply: FastifyReply, permission: Permission) {
  const user = await requireTelegramUser(request);
  if (!user) { reply.code(401).send({ error: "UNAUTHENTICATED" }); return null; }
  const superAdmins = parseAdminTelegramIds(process.env.GAME_ADMIN_TELEGRAM_IDS);
  let role: string | null = superAdmins.includes(user.telegramId) ? "superadmin" : null;
  if (!role) {
    const assigned = await prisma.adminRoleAssignment.findUnique({ where: { telegramId: user.telegramId }, select: { role: true, active: true } });
    if (assigned) role = assigned.active && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, assigned.role) ? assigned.role : null;
    else {
      try {
        const map = JSON.parse(process.env.GAME_ADMIN_ROLE_MAP ?? "{}") as Record<string, string>;
        role = map[user.telegramId] && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, map[user.telegramId]!) ? map[user.telegramId]! : null;
      } catch { role = null; }
    }
  }
  if (!role || !ROLE_PERMISSIONS[role]?.includes(permission)) { reply.code(403).send({ error: "ADMIN_PERMISSION_REQUIRED", permission }); return null; }
  return user;
}

const prizeSchema = z.object({
  placement: z.number().int().min(0).max(3),
  type: z.enum(["CASH", "GOLD", "HONOR", "STORE_ITEM", "SPECIAL_PLAYER"]),
  amount: z.string().regex(/^(0|[1-9][0-9]{0,17})$/).optional(),
  itemKey: z.string().trim().min(2).max(80).optional(),
  specialPlayerId: z.string().min(1).max(128).optional(),
}).superRefine((value, context) => {
  if (["CASH", "GOLD", "HONOR"].includes(value.type) && (!value.amount || !/^[0-9]+$/.test(value.amount) || BigInt(value.amount) <= 0n)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "CURRENCY_PRIZE_AMOUNT_REQUIRED" });
  }
  if (value.type === "STORE_ITEM" && !value.itemKey) context.addIssue({ code: z.ZodIssueCode.custom, path: ["itemKey"], message: "STORE_ITEM_KEY_REQUIRED" });
  if (value.type === "SPECIAL_PLAYER" && !value.specialPlayerId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["specialPlayerId"], message: "SPECIAL_PLAYER_REQUIRED" });
});

const createSchema = z.object({
  idempotencyKey: z.string().min(12).max(128),
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(5).max(2000),
  entryFeeAsset: z.enum(["CASH", "GOLD", "HONOR"]).optional(),
  entryFeeAmount: z.string().regex(/^(0|[1-9][0-9]{0,17})$/).default("0"),
  maxParticipants: z.number().int().min(2).max(500).default(128),
  registrationEndsAt: z.string().datetime(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  prizes: z.array(prizeSchema).min(1).max(12),
}).superRefine((value, context) => {
  const registrationEndsAt = new Date(value.registrationEndsAt);
  const startsAt = new Date(value.startsAt);
  if (registrationEndsAt <= new Date()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["registrationEndsAt"], message: "REGISTRATION_END_MUST_BE_FUTURE" });
  if (startsAt < registrationEndsAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ["startsAt"], message: "START_MUST_FOLLOW_REGISTRATION" });
  if (value.endsAt && new Date(value.endsAt) <= startsAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "END_MUST_FOLLOW_START" });
  const validEntryAmount = /^(0|[1-9][0-9]{0,17})$/.test(value.entryFeeAmount);
  const entryAmount = validEntryAmount ? BigInt(value.entryFeeAmount) : 0n;
  if (validEntryAmount && entryAmount > 0n && !value.entryFeeAsset) context.addIssue({ code: z.ZodIssueCode.custom, path: ["entryFeeAsset"], message: "ENTRY_FEE_ASSET_REQUIRED" });
  if (validEntryAmount && entryAmount === 0n && value.entryFeeAsset) context.addIssue({ code: z.ZodIssueCode.custom, path: ["entryFeeAsset"], message: "ENTRY_FEE_AMOUNT_REQUIRED" });
});

const idParams = z.object({ id: z.string().min(1).max(128) });

export function registerEventTournamentRoutes(app: FastifyInstance) {
  app.get("/v1/event-tournaments", async (request, reply) => {
    const actor = await requireTelegramUser(request);
    if (!actor) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const tournaments = await prisma.eventTournament.findMany({
      where: { status: { in: ["REGISTRATION", "ACTIVE", "COMPLETED"] } },
      orderBy: [{ status: "asc" }, { startsAt: "desc" }],
      take: 40,
      include: {
        _count: { select: { participants: true } },
        prizes: { orderBy: [{ placement: "asc" }, { type: "asc" }] },
        participants: { where: { userId: actor.id }, select: { id: true, placement: true, joinedAt: true } },
      },
    });
    return { tournaments: tournaments.map((item) => ({
      id: item.id, title: item.title, description: item.description, status: item.status,
      entryFeeAsset: item.entryFeeAsset, entryFeeAmount: item.entryFeeAmount.toString(),
      maxParticipants: item.maxParticipants, participantCount: item._count.participants,
      registrationEndsAt: item.registrationEndsAt.toISOString(), startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt?.toISOString() ?? null,
      prizes: item.prizes.map((prize) => ({ placement: prize.placement, type: prize.type, amount: prize.amount.toString(), itemKey: prize.itemKey, specialPlayerId: prize.specialPlayerId })),
      joined: item.participants.length > 0, participantId: item.participants[0]?.id ?? null,
      placement: item.participants[0]?.placement ?? null,
    })) };
  });

  app.post("/v1/event-tournaments/:id/join", async (request, reply) => {
    const actor = await requireTelegramUser(request);
    if (!actor) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_TOURNAMENT_ID" });
    if (!await consumeAllianceActionRateLimit({ telegramUserId: actor.telegramId, telegramGroupId: "event-tournament", action: "event-tournament-join", limit: 8 })) {
      return reply.code(429).send({ error: "TOURNAMENT_JOIN_RATE_LIMITED", retryAfterSeconds: 60 });
    }
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.eventTournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: params.data.id, userId: actor.id } } });
        if (existing) return { participantId: existing.id, replayed: true };
        const tournament = await tx.eventTournament.findUnique({ where: { id: params.data.id } });
        if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
        const now = new Date();
        if (tournament.status !== "REGISTRATION" || tournament.registrationEndsAt <= now || tournament.startsAt <= now) throw new Error("TOURNAMENT_REGISTRATION_CLOSED");
        const count = await tx.eventTournamentParticipant.count({ where: { tournamentId: tournament.id } });
        if (count >= tournament.maxParticipants) throw new Error("TOURNAMENT_FULL");
        const club = await tx.club.findUnique({ where: { ownerId: actor.id }, select: { id: true } });
        if (!club) throw new Error("CLUB_NOT_FOUND");
        if (tournament.entryFeeAmount > 0n && tournament.entryFeeAsset) {
          const asset = tournament.entryFeeAsset as WalletAsset;
          const wallet = await tx.wallet.findUnique({ where: { userId_asset: { userId: actor.id, asset } }, select: { id: true, balance: true, version: true } });
          if (!wallet || wallet.balance < tournament.entryFeeAmount) throw new Error("INSUFFICIENT_FUNDS");
          const updated = await tx.wallet.updateMany({
            where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
            data: { balance: { decrement: tournament.entryFeeAmount }, version: { increment: 1 } },
          });
          if (updated.count !== 1) throw new Error("CONCURRENT_MODIFICATION");
          await tx.ledgerTransaction.create({ data: {
            idempotencyKey: "event-tournament-entry:" + tournament.id + ":" + actor.id,
            userId: actor.id, asset, direction: "DEBIT", amount: tournament.entryFeeAmount,
            reason: "EVENT_TOURNAMENT_ENTRY", referenceType: "event-tournament", referenceId: tournament.id,
          } });
        }
        const participant = await tx.eventTournamentParticipant.create({ data: { tournamentId: tournament.id, userId: actor.id, clubId: club.id } });
        return { participantId: participant.id, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { joined: true, ...result };
    } catch (error) {
      const code = error instanceof Error ? error.message : "TOURNAMENT_JOIN_FAILED";
      const status = code === "TOURNAMENT_NOT_FOUND" ? 404 : code === "INSUFFICIENT_FUNDS" ? 409 : code === "TOURNAMENT_FULL" || code === "TOURNAMENT_REGISTRATION_CLOSED" ? 409 : 400;
      return reply.code(status).send({ error: code });
    }
  });

  app.get("/v1/admin/event-tournaments", async (request, reply) => {
    const actor = await authorize(request, reply, "read");
    if (!actor) return;
    const tournaments = await prisma.eventTournament.findMany({
      take: 50, orderBy: { createdAt: "desc" },
      include: { _count: { select: { participants: true } }, prizes: { orderBy: [{ placement: "asc" }, { type: "asc" }] } },
    });
    return { tournaments: tournaments.map((item) => ({
      id: item.id, title: item.title, description: item.description, status: item.status,
      entryFeeAsset: item.entryFeeAsset, entryFeeAmount: item.entryFeeAmount.toString(),
      maxParticipants: item.maxParticipants, participantCount: item._count.participants,
      registrationEndsAt: item.registrationEndsAt.toISOString(), startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt?.toISOString() ?? null,
      prizes: item.prizes.map((prize) => ({ id: prize.id, placement: prize.placement, type: prize.type, amount: prize.amount.toString(), itemKey: prize.itemKey, specialPlayerId: prize.specialPlayerId })),
    })) };
  });

  app.get("/v1/admin/event-tournaments/:id/participants", async (request, reply) => {
    const actor = await authorize(request, reply, "read");
    if (!actor) return;
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_TOURNAMENT_ID" });
    const participants = await prisma.eventTournamentParticipant.findMany({
      where: { tournamentId: params.data.id }, orderBy: [{ score: "desc" }, { joinedAt: "asc" }],
      include: { user: { select: { telegramId: true, username: true, displayName: true } }, club: { select: { name: true } } },
    });
    return { participants: participants.map((item) => ({ id: item.id, telegramId: item.user.telegramId, displayName: item.user.displayName, username: item.user.username, clubName: item.club.name, score: item.score, placement: item.placement, joinedAt: item.joinedAt.toISOString() })) };
  });

  app.post("/v1/admin/event-tournaments", async (request, reply) => {
    const actor = await authorize(request, reply, "competitions");
    if (!actor) return;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_TOURNAMENT", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
    const value = parsed.data;
    try {
      const result = await prisma.$transaction(async (tx) => {
        for (const prize of value.prizes) {
          if (prize.type === "STORE_ITEM" && (!prize.itemKey || !getStoreItem(prize.itemKey))) throw new Error("STORE_ITEM_NOT_AVAILABLE");
          if (prize.type === "SPECIAL_PLAYER") {
            if (!prize.specialPlayerId) throw new Error("SPECIAL_PLAYER_NOT_AVAILABLE");
            const special = await tx.specialPlayer.findUnique({ where: { id: prize.specialPlayerId }, select: { id: true, active: true } });
            if (!special?.active) throw new Error("SPECIAL_PLAYER_NOT_AVAILABLE");
          }
        }
        const tournament = await tx.eventTournament.create({
          data: {
            idempotencyKey: "event-tournament-create:" + value.idempotencyKey,
            title: value.title, description: value.description,
            entryFeeAsset: value.entryFeeAsset, entryFeeAmount: BigInt(value.entryFeeAmount),
            maxParticipants: value.maxParticipants, registrationEndsAt: new Date(value.registrationEndsAt),
            startsAt: new Date(value.startsAt), endsAt: value.endsAt ? new Date(value.endsAt) : undefined,
            createdByTelegramId: actor.telegramId,
            prizes: { create: value.prizes.map((prize) => ({
              placement: prize.placement, type: prize.type, amount: BigInt(prize.amount ?? "0"),
              itemKey: prize.itemKey ?? null, specialPlayerId: prize.specialPlayerId ?? null,
            })) },
          },
          include: { prizes: true },
        });
        await tx.adminAuditLog.create({ data: {
          actorTelegramId: actor.telegramId, action: "create-event-tournament", targetType: "event-tournament",
          targetId: tournament.id, idempotencyKey: "event-tournament-audit:" + value.idempotencyKey,
          metadata: { title: value.title, prizeCount: value.prizes.length },
        } });
        return tournament;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.code(201).send({ tournament: { id: result.id, title: result.title, status: result.status, participantCount: 0 } });
    } catch (error) {
      if (error instanceof Error && ["SPECIAL_PLAYER_NOT_AVAILABLE", "STORE_ITEM_NOT_AVAILABLE"].includes(error.message)) return reply.code(409).send({ error: error.message });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return reply.code(409).send({ error: "DUPLICATE_OR_IDEMPOTENCY_CONFLICT" });
      throw error;
    }
  });

  app.post("/v1/admin/event-tournaments/:id/finalize", async (request, reply) => {
    const actor = await authorize(request, reply, "competitions");
    if (!actor) return;
    const params = idParams.safeParse(request.params);
    const body = z.object({
      idempotencyKey: z.string().min(12).max(128),
      results: z.array(z.object({ participantId: z.string().min(1).max(128), placement: z.number().int().min(1).max(500), score: z.number().int().min(0).max(1_000_000).default(0) })).min(1).max(500),
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_TOURNAMENT_RESULTS" });
    const ids = body.data.results.map((item) => item.participantId);
    if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: "DUPLICATE_PARTICIPANT_RESULT" });
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const tournament = await tx.eventTournament.findUnique({ where: { id: params.data.id }, include: { prizes: true, participants: { include: { user: true, club: true } } } });
        if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
        if (tournament.status === "COMPLETED") throw new Error("TOURNAMENT_ALREADY_FINALIZED");
        if (tournament.status === "CANCELLED") throw new Error("TOURNAMENT_CANCELLED");
        if (tournament.participants.length !== body.data.results.length) throw new Error("ALL_PARTICIPANTS_MUST_BE_RANKED");
        const participantIds = new Set(tournament.participants.map((item) => item.id));
        if (ids.some((id) => !participantIds.has(id))) throw new Error("UNKNOWN_TOURNAMENT_PARTICIPANT");
        const placements = new Set(body.data.results.filter((item) => item.placement <= 3).map((item) => item.placement));
        if (placements.size !== body.data.results.filter((item) => item.placement <= 3).length) throw new Error("TOP_THREE_PLACEMENTS_MUST_BE_UNIQUE");
        const results = new Map(body.data.results.map((item) => [item.participantId, item]));
        let awarded = 0;
        for (const participant of tournament.participants) {
          const result = results.get(participant.id)!;
          await tx.eventTournamentParticipant.update({ where: { id: participant.id }, data: { placement: result.placement, score: result.score } });
          const prizes = tournament.prizes.filter((prize) => prize.placement === result.placement || (result.placement > 3 && prize.placement === 0));
          for (const prize of prizes) {
            const previous = await tx.eventTournamentPrizeAward.findUnique({ where: { participantId_prizeId: { participantId: participant.id, prizeId: prize.id } } });
            if (previous) continue;
            let status = "AWARDED";
            let detail: Prisma.InputJsonObject = {};
            if (["CASH", "GOLD", "HONOR"].includes(prize.type)) {
              const asset = prize.type as WalletAsset;
              const wallet = await tx.wallet.upsert({ where: { userId_asset: { userId: participant.userId, asset } }, create: { userId: participant.userId, asset, balance: 0n }, update: {}, select: { id: true, balance: true, version: true } });
              const nextBalance = wallet.balance + prize.amount;
              const updated = await tx.wallet.updateMany({ where: { id: wallet.id, balance: wallet.balance, version: wallet.version }, data: { balance: nextBalance, version: { increment: 1 } } });
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
              const owned = await tx.player.findFirst({ where: { clubId: participant.clubId, specialPlayerId: special.id }, select: { id: true } });
              if (owned) status = "SKIPPED_ALREADY_OWNED";
              else {
                const allowedPositions: PlayerPosition[] = ["GK","RB","LB","CB","CDM","CM","CAM","RW","LW","ST"];
                const position = (special.positions.find((item) => allowedPositions.includes(item as PlayerPosition)) ?? "ST") as PlayerPosition;
                const age = special.birthDate ? Math.max(16, new Date().getFullYear() - special.birthDate.getFullYear()) : 28;
                const player = await tx.player.create({ data: {
                  clubId: participant.clubId, firstName: special.fullName.split(" ")[0] ?? special.fullName,
                  lastName: special.fullName.split(" ").slice(1).join(" ") || "Legend", nationality: special.nationality,
                  age, position, overall: special.overall, potential: special.potential,
                  marketValue: BigInt(special.overall * 10_000), attributes: special.attributes as Prisma.InputJsonValue,
                  wage: BigInt(special.overall * 50), contractDays: 365, origin: "SPECIAL", status: "ACTIVE", specialPlayerId: special.id,
                }, select: { id: true } });
                await tx.specialPlayerAcquisition.create({ data: {
                  idempotencyKey: "event-tournament-special:" + tournament.id + ":" + participant.id + ":" + prize.id,
                  userId: participant.userId, clubId: participant.clubId, specialPlayerId: special.id,
                  playerId: player.id, method: "EVENT_TOURNAMENT", asset: "HONOR", amount: 0n,
                } });
                detail = { specialPlayerId: special.id, playerId: player.id };
              }
            }
            await tx.eventTournamentPrizeAward.create({ data: { participantId: participant.id, prizeId: prize.id, status, detail } });
            if (status === "AWARDED") awarded += 1;
          }
          await tx.eventTournamentParticipant.update({ where: { id: participant.id }, data: { prizeSettledAt: new Date() } });
        }
        await tx.eventTournament.update({ where: { id: tournament.id }, data: { status: "COMPLETED", finalizedAt: new Date(), endsAt: tournament.endsAt ?? new Date() } });
        await tx.adminAuditLog.create({ data: {
          actorTelegramId: actor.telegramId, action: "finalize-event-tournament", targetType: "event-tournament",
          targetId: tournament.id, idempotencyKey: "event-tournament-finalize:" + body.data.idempotencyKey,
          metadata: { participants: tournament.participants.length, awarded },
        } });
        return { participants: tournament.participants.length, awards: awarded };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return outcome;
    } catch (error) {
      const code = error instanceof Error ? error.message : "TOURNAMENT_FINALIZE_FAILED";
      const status = code === "TOURNAMENT_NOT_FOUND" ? 404 : code === "TOURNAMENT_ALREADY_FINALIZED" || code === "TOURNAMENT_CANCELLED" ? 409 : 400;
      return reply.code(status).send({ error: code });
    }
  });
}
