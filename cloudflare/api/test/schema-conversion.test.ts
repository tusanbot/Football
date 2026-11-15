import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { convertPrismaSchema } from "../scripts/prisma-d1-schema.mjs";
import { fromD1Integer, toD1Integer } from "../src/d1-integer.js";

test("Prisma conversion inventories the complete game schema", () => {
  const source = readFileSync("apps/api/prisma/schema.prisma", "utf8");
  const converted = convertPrismaSchema(source);
  const totals = converted.inventory.totals;

  assert.ok(totals.models >= 50, "expected the full game model inventory");
  assert.ok(totals.enums >= 20, "expected the full game enum inventory");
  assert.ok(totals.relations >= 40, "expected relation coverage");
  assert.ok(totals.scalarColumns >= 250, "expected scalar field coverage");
  assert.ok(totals.bigIntColumns > 0);
  assert.ok(totals.jsonColumns > 0);
  assert.ok(totals.arrayColumns > 0);
  assert.match(converted.sql, /CREATE TABLE IF NOT EXISTS "Wallet"/);
  assert.match(converted.sql, /CREATE TABLE IF NOT EXISTS "LedgerTransaction"/);
  assert.match(converted.sql, /FOREIGN KEY/);
  assert.match(converted.sql, /signed 64-bit/);
});

test("Prisma enum values become database CHECK constraints", () => {
  const converted = convertPrismaSchema([
    "enum WalletAsset {", "  CASH", "  GOLD", "}",
    "model Wallet {",
    " id String @id @default(cuid())",
    " asset WalletAsset",
    " balance BigInt @default(0)",
    "}"
  ].join("\n"));
  assert.deepEqual(converted.inventory.enums.WalletAsset, ["CASH", "GOLD"]);
  assert.match(converted.sql, /CHECK \(asset IN \('CASH', 'GOLD'\)\)/);
  assert.match(converted.sql, /"balance" INTEGER NOT NULL DEFAULT 0/);
});

test("relation defaults preserve Prisma referential actions", () => {
  const converted = convertPrismaSchema([
    "model Parent {",
    " id String @id",
    " requiredChildren Child[]",
    " optionalChildren OptionalChild[]",
    "}",
    "model Child {",
    " id String @id",
    " parentId String",
    " parent Parent @relation(fields: [parentId], references: [id])",
    "}",
    "model OptionalChild {",
    " id String @id",
    " parentId String?",
    " parent Parent? @relation(fields: [parentId], references: [id])",
    "}"
  ].join("\n"));
  assert.match(converted.sql, /ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.match(converted.sql, /ON DELETE SET NULL ON UPDATE CASCADE/);
});

test("D1 integer bridge preserves exact signed 64-bit values", () => {
  const exact = "9007199254740993";
  assert.equal(toD1Integer(exact), exact);
  assert.equal(fromD1Integer(exact), 9007199254740993n);
  assert.equal(toD1Integer(-42n), "-42");
  assert.equal(fromD1Integer(null), null);
});

test("D1 integer bridge rejects precision loss and out-of-range values", () => {
  assert.throws(() => toD1Integer(Number.MAX_SAFE_INTEGER + 1), /Unsafe JavaScript number/);
  assert.throws(() => fromD1Integer(Number.MAX_SAFE_INTEGER + 1), /unsafe Number/);
  assert.throws(() => toD1Integer("9223372036854775808"), /signed 64-bit range/);
  assert.throws(() => fromD1Integer("not-an-integer"), /decimal integer/);
});
