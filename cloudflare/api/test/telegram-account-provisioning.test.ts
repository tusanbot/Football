import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseTelegramAccountProvisioningRepository } from "../src/repositories/telegram-account-provisioning.js";

const validAccount = {
  id: "user-1", telegramId: "12345", displayName: "Test Player",
  club: { id: "club-1", name: "Test FC", level: 1, reputation: 0 },
  wallets: [
    { asset: "CASH", balance: "20000" },
    { asset: "GOLD", balance: "50" },
    { asset: "HONOR", balance: "0" },
  ],
};

const command = {
  telegramId: "12345", username: "test", displayName: "Test Player", firstName: "Test",
  starterPlayers: [{
    firstName: "A", lastName: "B", nationality: "IR", age: 20, position: "GK",
    overall: 50, potential: 60,
    attributes: { pace: 40, shooting: 40, passing: 40, dribbling: 40, defending: 40, physical: 40, goalkeeping: 60 },
    wage: 150n, contractDays: 365,
  }],
};

test("account provisioning parses the scalar jsonb RPC result and serializes starter player wages", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const repository = new SupabaseTelegramAccountProvisioningRepository({
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return validAccount;
    },
  } as never);
  const result = await repository.provision(command);
  assert.equal(result.id, "user-1");
  assert.equal(call?.name, "provision_telegram_account");
  const players = call?.args.p_starter_players as { wage: string }[];
  assert.equal(players[0]?.wage, "150");
});

test("account provisioning accepts a single-row array for compatible set-returning RPCs", async () => {
  const repository = new SupabaseTelegramAccountProvisioningRepository({
    rpc: async () => [validAccount],
  } as never);
  const result = await repository.provision(command);
  assert.equal(result.telegramId, "12345");
});

test("account provisioning rejects malformed scalar and array RPC payloads", async () => {
  for (const payload of [null, [], [{ id: "user-1" }], [validAccount, validAccount], { ...validAccount, wallets: [null] }]) {
    const repository = new SupabaseTelegramAccountProvisioningRepository({ rpc: async () => payload } as never);
    await assert.rejects(() => repository.provision(command), /INVALID_RESPONSE/);
  }
});
