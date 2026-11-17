import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool, type PoolConfig } from "pg";

const requestPrisma = new AsyncLocalStorage<PrismaClient>();

export function createPgPoolConfig(connectionString: string, maxConnections = 10): PoolConfig {
  const parsed = new URL(connectionString);
  const isSupabaseTransactionPooler = parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "6543";
  if (isSupabaseTransactionPooler) {
    // Supavisor transaction mode is selected by port 6543. The pg driver adapter
    // does not use Prisma's URL parser, so enforce TLS in node-postgres directly
    // and normalize the Prisma pooler hint without requiring dashboard URL flags.
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("ssl");
    parsed.searchParams.set("pgbouncer", "true");
  }
  return {
    connectionString: parsed.toString(),
    ...(isSupabaseTransactionPooler ? { ssl: { rejectUnauthorized: true } } : {}),
    max: maxConnections,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  };
}

export function createPrismaClient(connectionString = process.env.DATABASE_URL, maxConnections = 10): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) throw new Error("The database connection must use PostgreSQL.");
  const pool = new Pool(createPgPoolConfig(connectionString, maxConnections));
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

let defaultPrisma: PrismaClient | undefined;
let requestScopeRequired = false;

export function requireRequestScopedPrisma(): void {
  requestScopeRequired = true;
}

const workerRequestClients = new Map<string, PrismaClient>();
export function registerWorkerPrismaRequest(client: PrismaClient): string {
  const requestId = randomUUID();
  workerRequestClients.set(requestId, client);
  return requestId;
}
export function enterWorkerPrismaRequest(requestId: string): boolean {
  const client = workerRequestClients.get(requestId);
  if (!client) return false;
  requestPrisma.enterWith(client);
  return true;
}
export function releaseWorkerPrismaRequest(requestId: string): void {
  workerRequestClients.delete(requestId);
}

function currentPrisma(): PrismaClient {
  const scoped = requestPrisma.getStore();
  if (scoped) return scoped;
  if (requestScopeRequired) throw new Error("Prisma access outside the Worker request context is blocked.");
  defaultPrisma ??= createPrismaClient();
  return defaultPrisma;
}

export function withPrismaClient<T>(client: PrismaClient, operation: () => T): T {
  return requestPrisma.run(client, operation);
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = currentPrisma();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, property, value) {
    const client = currentPrisma();
    return Reflect.set(client, property, value, client);
  },
});
