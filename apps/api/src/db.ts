import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

// Public Supabase Root 2021 CA; SHA-256 fingerprint verified against the published root.
const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;
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
    ...(isSupabaseTransactionPooler ? { ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true } } : {}),
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
  // Production API and Worker runtimes are Supabase HTTP-only. Prisma remains
  // available solely to legacy tests and local migration tooling; it must never
  // establish a PostgreSQL connection in a production process.
  if (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production") {
    throw new Error("PRISMA_RUNTIME_DISABLED_SUPABASE_HTTP_REQUIRED");
  }
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
