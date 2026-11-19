import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseClubTicketPriceRepository } from "../src/repositories/club-ticket-price.js";

test("ticket price repository calls the compare-and-set RPC using decimal strings", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const repository = new SupabaseClubTicketPriceRepository({
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return { ticketPrice: "75", previousTicketPrice: "50", replayed: false };
    },
  } as never);
  const result = await repository.update("user-1", 75n, 50n);
  assert.deepEqual(call, {
    name: "update_club_ticket_price",
    args: { p_user_id: "user-1", p_ticket_price: "75", p_expected_ticket_price: "50" },
  });
  assert.deepEqual(result, { ticketPrice: "75", previousTicketPrice: "50", replayed: false });
});

test("ticket price repository rejects malformed RPC responses", async () => {
  const repository = new SupabaseClubTicketPriceRepository({ rpc: async () => ({ ticketPrice: 75 }) } as never);
  await assert.rejects(() => repository.update("user-1", 75n, 50n), /INVALID_RESPONSE/);
});
