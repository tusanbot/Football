import type { ClubTicketPricePort, ClubTicketPriceUpdate } from "./club-ticket-price-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";

export class SupabaseClubTicketPriceRepository implements ClubTicketPricePort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async update(userId: string, ticketPrice: bigint, expectedTicketPrice: bigint): Promise<ClubTicketPriceUpdate> {
    const result = await this.client.rpc<ClubTicketPriceUpdate>("update_club_ticket_price", {
      p_user_id: userId,
      p_ticket_price: ticketPrice.toString(),
      p_expected_ticket_price: expectedTicketPrice.toString(),
    });
    if (!result || typeof result !== "object"
      || typeof result.ticketPrice !== "string" || !/^\d+$/.test(result.ticketPrice)
      || typeof result.previousTicketPrice !== "string" || !/^\d+$/.test(result.previousTicketPrice)
      || typeof result.replayed !== "boolean") {
      throw new Error("SUPABASE_CLUB_TICKET_PRICE_INVALID_RESPONSE");
    }
    return result;
  }
}
