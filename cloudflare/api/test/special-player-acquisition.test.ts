import test from "node:test";
import assert from "node:assert/strict";
import {
  SpecialAcquisitionD1Database,
  SpecialAcquisitionStatement,
  SpecialPlayerAcquisitionRepository,
} from "../src/repositories/special-player-acquisition.js";

class FakeStatement implements SpecialAcquisitionStatement {
  values: unknown[] = [];
  constructor(readonly sql: string) {}
  bind(...values: unknown[]): SpecialAcquisitionStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> { return null; }
}
class FakeD1 implements SpecialAcquisitionD1Database {
  statements: FakeStatement[] = [];
  batches = 0;
  prepare(sql: string): SpecialAcquisitionStatement {
    const s = new FakeStatement(sql);
    this.statements.push(s);
    return s;
  }
  async batch(statements: SpecialAcquisitionStatement[]) {
    this.batches++;
    this.statements = statements as FakeStatement[];
    return statements.map(() => ({ meta: { changes: 1 } }));
  }
}
const input = {
  id: "acq-1", playerId: "player-1", ledgerId: "ledger-1",
  idempotencyKey: "special-acquisition-key-01",
  userId: "user-1", clubId: "club-1", specialPlayerId: "special-1",
  asset: "GOLD" as const, amount: "9007199254740993",
  method: "icon_pack", position: "ST", firstName: "Test", lastName: "Legend",
  now: "2026-11-15T10:00:00.000Z",
};

test("special player acquisition performs debit, player creation and ownership record in one guarded D1 batch", async () => {
  const db = new FakeD1();
  const repo = new SpecialPlayerAcquisitionRepository(db);
  // Preflight reads are stubbed to the persisted rows required by the repository.
  const original = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    const s = new FakeStatement(sql);
    s.first = async <T>() => {
      if (sql.includes('FROM "SpecialPlayer" WHERE')) return {
        id: "special-1", fullName: "Test Legend", nationality: "GB", birthDate: "1990-01-01",
        positions: '["ST","CAM"]', rarity: "ICON", acquisitionMethods: '["icon_pack"]',
        overall: 90, potential: 95, attributes: '{"pace":90}', active: 1,
      } as T;
      if (sql.includes('FROM "Club"')) return { id: "club-1" } as T;
      if (sql.includes('FROM "Player"')) return null;
      if (sql.includes('FROM "Wallet"')) return { balance: "9007199254740994", version: 0 } as T;
      return null;
    };
    return s;
  };
  const result = await repo.acquire(input);
  assert.deepEqual(result, { status: "acquired", playerId: "player-1" });
  assert.equal(db.batches, 1);
  assert.equal(db.statements.length, 9);
  assert.match(db.statements[0].sql, /SPECIAL_PLAYER_ACQUISITION/);
  assert.match(db.statements[2].sql, /"balance" >= CAST\(\? AS INTEGER\)/);
  assert.match(db.statements[4].sql, /json_each\(s\."positions"\)/);
  assert.match(db.statements[4].sql, /json_each\(s\."acquisitionMethods"\)/);
  assert.match(db.statements[6].sql, /"SpecialPlayerAcquisition"/);
  assert.equal(db.statements[0].values[4], "9007199254740993");
  assert.equal(db.statements[4].values[6], "9007199254740993");
  void original;
});

test("special player acquisition validates supported method and position before financial writes", async () => {
  const db = new FakeD1();
  db.prepare = (sql: string) => {
    const s = new FakeStatement(sql);
    s.first = async <T>() => {
      if (sql.includes('FROM "SpecialPlayer" WHERE')) return {
        id: "special-1", fullName: "Test Legend", nationality: "GB", birthDate: null,
        positions: '["ST"]', rarity: "ICON", acquisitionMethods: '["icon_pack"]',
        overall: 90, potential: 95, attributes: '{}', active: 1,
      } as T;
      return null;
    };
    return s;
  };
  await assert.rejects(
    new SpecialPlayerAcquisitionRepository(db).acquire({ ...input, method: "direct_purchase" }),
    /unavailable for this acquisition method/,
  );
  assert.equal(db.batches, 0);
});

test("special player acquisition rejects non-positive prices and invalid idempotency keys", async () => {
  const db = new FakeD1();
  const repo = new SpecialPlayerAcquisitionRepository(db);
  await assert.rejects(repo.acquire({ ...input, amount: "0" }), /positive/);
  await assert.rejects(repo.acquire({ ...input, idempotencyKey: "short" }), /length/);
  assert.equal(db.batches, 0);
});
