import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { registerTelegramAuthRoutes } from "./auth/routes.js";
import { prisma } from "./db.js";

const healthResponse = z.object({
  status: z.literal("ok"),
  service: z.literal("football-empire-api"),
  version: z.string(),
});

export function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    requestIdHeader: "x-request-id",
    bodyLimit: 1_048_576,
  });

  void app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? false,
    credentials: true,
  });

  app.get("/health", async (_request, reply) =>
    reply.code(200).send(
      healthResponse.parse({
        status: "ok",
        service: "football-empire-api",
        version: "0.1.0",
      }),
    ),
  );

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  // Route registration is synchronous; handlers perform their own async work.
  registerTelegramAuthRoutes(app);

  app.get("/v1", async () => ({
    name: "Football Empire API",
    apiVersion: "v1",
    principle: "Bot and Mini App use the same game API.",
  }));

  return app;
}