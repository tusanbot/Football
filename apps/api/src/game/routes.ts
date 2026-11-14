import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireTelegramUser } from "../auth/require-telegram-user.js";

const clubUpdateSchema = z.object({
  name: z.string().trim().min(2).max(32).regex(/^[\p{L}\p{N} .'-]+$/u),
});

export function registerGameRoutes(app: FastifyInstance) {
  app.get("/v1/me", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const [club, wallets] = await Promise.all([
      prisma.club.findUnique({ where: { ownerId: user.id }, select: { id: true, name: true, level: true, reputation: true, createdAt: true } }),
      prisma.wallet.findMany({ where: { userId: user.id }, select: { asset: true, balance: true, version: true }, orderBy: { asset: "asc" } }),
    ]);
    return {
      user: { ...user, createdAt: user.createdAt.toISOString() }, club,
      wallets: wallets.map((wallet) => ({ asset: wallet.asset, balance: wallet.balance.toString(), version: wallet.version })),
    };
  });

  app.patch("/v1/club", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = clubUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_CLUB_NAME", details: parsed.error.flatten() });
    const club = await prisma.club.updateMany({ where: { ownerId: user.id }, data: { name: parsed.data.name } });
    if (club.count !== 1) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    return { club: await prisma.club.findUnique({ where: { ownerId: user.id }, select: { id: true, name: true, level: true, reputation: true } }) };
  });

  app.get("/v1/wallet", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const wallets = await prisma.wallet.findMany({ where: { userId: user.id }, select: { asset: true, balance: true, version: true, updatedAt: true }, orderBy: { asset: "asc" } });
    return { wallets: wallets.map((wallet) => ({ asset: wallet.asset, balance: wallet.balance.toString(), version: wallet.version, updatedAt: wallet.updatedAt.toISOString() })) };
  });

  app.get("/v1/club/players", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const club = await prisma.club.findUnique({ where: { ownerId: user.id }, select: { id: true } });
    if (!club) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    const players = await prisma.player.findMany({
      where: { clubId: club.id, status: "ACTIVE" },
      orderBy: [{ position: "asc" }, { overall: "desc" }],
      select: { id: true, firstName: true, lastName: true, nationality: true, age: true, position: true, overall: true, potential: true, attributes: true, wage: true, contractDays: true, morale: true, fitness: true, origin: true, status: true },
    });
    return { players: players.map((player) => ({ ...player, wage: player.wage.toString() })), count: players.length };
  });
}
