import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import { prisma } from "../db.js";
import { getClubManagementPort } from "./club-management-context.js";
import {
  ClubOperationsError,
  getClubOperations,
  hireClubCoach,
  recruitAcademyProspect,
  scoutAcademy,
  signClubSponsor,
  upgradeClubCoach,
  upgradeClubFacility,
  updateStadiumTicketPrice,
} from "./club-operations-service.js";

const keySchema = z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/);
const keyBody = z.object({ idempotencyKey: keySchema });
const facilityParams = z.object({ facility: z.enum(["STADIUM", "TRAINING_GROUND", "ACADEMY"]) });
const prospectParams = z.object({ id: z.string().min(1).max(64) });
const hireBody = keyBody.extend({ candidateId: z.enum(["balanced", "youth", "performance"]) });
const sponsorBody = keyBody.extend({ offerId: z.enum(["local-partner", "regional-brand", "national-network"]) });

function sendOperationsError(reply: FastifyReply, error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2034" || error.code === "P2002")) {
    return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
  }
  if (!(error instanceof ClubOperationsError)) throw error;
  const status = error.code === "CLUB_NOT_FOUND" || error.code === "PROSPECT_NOT_AVAILABLE" || error.code === "COACH_NOT_FOUND" ? 404
    : ["INSUFFICIENT_CASH", "CONCURRENT_MODIFICATION", "ACTIVE_SPONSOR_EXISTS", "SPONSOR_OFFER_LOCKED", "ACADEMY_NOT_BUILT", "ACADEMY_CAPACITY_REACHED", "IDEMPOTENCY_CONFLICT", "FACILITY_MAX_LEVEL", "COACH_MAX_LEVEL", "TICKET_PRICE_CONFLICT"].includes(error.code) ? 409
    : 400;
  return reply.code(status).send({ error: error.code, ...(error.details ? { details: error.details } : {}) });
}

export function registerClubOperationsRoutes(app: FastifyInstance) {
  app.get("/v1/club/operations", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try { return await getClubOperations(user.id); }
    catch (error) { return sendOperationsError(reply, error); }
  });

  app.get("/v1/club/finance", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const query = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_FINANCE_QUERY" });
    try {
      const operations = await getClubOperations(user.id);
      const since = new Date(Date.now() - query.data.days * 86_400_000);
      const httpPort = getClubManagementPort();
      if (httpPort) {
        const report = await httpPort.getFinanceReport(user.id, since);
        if (!report) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
        const income = BigInt(report.income);
        const expenses = BigInt(report.expenses);
        return {
          periodDays: query.data.days, income: income.toString(), expenses: expenses.toString(),
          net: (income - expenses).toString(), operatingArrears: operations.club.operatingArrears,
          entries: report.entries.map((entry) => ({ ...entry, amount: String(entry.amount), occurredAt: new Date(entry.occurredAt).toISOString() })),
        };
      }
      const clubId = operations.club.id;
      const [entries, totals] = await Promise.all([
        prisma.clubFinanceEntry.findMany({
          where: { clubId, occurredAt: { gte: since } },
          orderBy: { occurredAt: "desc" }, take: 200,
        }),
        prisma.clubFinanceEntry.groupBy({
          by: ["direction"], where: { clubId, occurredAt: { gte: since } },
          _sum: { amount: true },
        }),
      ]);
      const income = totals.find((item) => item.direction === "CREDIT")?._sum.amount ?? 0n;
      const expenses = totals.find((item) => item.direction === "DEBIT")?._sum.amount ?? 0n;
      return {
        periodDays: query.data.days,
        income: income.toString(), expenses: expenses.toString(),
        net: (income - expenses).toString(),
        operatingArrears: operations.club.operatingArrears,
        entries: entries.map((entry) => ({ ...entry, amount: entry.amount.toString(), occurredAt: entry.occurredAt.toISOString() })),
      };
    } catch (error) { return sendOperationsError(reply, error); }
  });

  app.patch("/v1/club/stadium/ticket-price", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = z.object({
      ticketPrice: z.string().regex(/^[0-9]{1,3}$/),
      expectedTicketPrice: z.string().regex(/^[0-9]{1,3}$/),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_TICKET_PRICE" });
    try {
      return { ticketing: await updateStadiumTicketPrice(user.id, BigInt(body.data.ticketPrice), BigInt(body.data.expectedTicketPrice)) };
    } catch (error) { return sendOperationsError(reply, error); }
  });

  app.post("/v1/club/facilities/:facility/upgrade", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = facilityParams.safeParse(request.params);
    const body = keyBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_FACILITY_UPGRADE" });
    try { return { upgrade: await upgradeClubFacility(user.id, params.data.facility, body.data.idempotencyKey) }; }
    catch (error) { return sendOperationsError(reply, error); }
  });

  app.post("/v1/club/academy/scout", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = keyBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_SCOUT_REQUEST" });
    try { return { scouting: await scoutAcademy(user.id, body.data.idempotencyKey) }; }
    catch (error) { return sendOperationsError(reply, error); }
  });

  app.post("/v1/club/academy/:id/recruit", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = prospectParams.safeParse(request.params);
    const body = keyBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_RECRUITMENT_REQUEST" });
    try { return { recruitment: await recruitAcademyProspect(user.id, params.data.id, body.data.idempotencyKey) }; }
    catch (error) { return sendOperationsError(reply, error); }
  });

  app.post("/v1/club/coach/upgrade", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = keyBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_COACH_UPGRADE" });
    try { return { upgrade: await upgradeClubCoach(user.id, body.data.idempotencyKey) }; }
    catch (error) { return sendOperationsError(reply, error); }
  });

  app.post("/v1/club/coach/hire", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = hireBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_COACH_HIRE" });
    try { return { hiring: await hireClubCoach(user.id, body.data.candidateId, body.data.idempotencyKey) }; }
    catch (error) { return sendOperationsError(reply, error); }
  });

  app.post("/v1/club/sponsors/sign", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = sponsorBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_SPONSOR_CONTRACT" });
    try { return { contract: await signClubSponsor(user.id, body.data.offerId, body.data.idempotencyKey) }; }
    catch (error) { return sendOperationsError(reply, error); }
  });
}
