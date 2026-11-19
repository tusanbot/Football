import type { TelegramAccountProvisioningCommand, TelegramAccountProvisioningPort, ProvisionedTelegramAccount } from "../../../../apps/api/src/auth/account-provisioning-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

interface ProvisioningRpcResponse {
  id: string;
  telegramId: string;
  displayName: string;
  club: { id: string; name: string; level: number; reputation: number } | null;
  wallets: { asset: "CASH" | "GOLD" | "HONOR"; balance: string }[];
}

export class SupabaseTelegramAccountProvisioningRepository implements TelegramAccountProvisioningPort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async provision(input: TelegramAccountProvisioningCommand): Promise<ProvisionedTelegramAccount> {
    const rows = await this.client.rpc<ProvisioningRpcResponse[]>("provision_telegram_account", {
      p_telegram_id: input.telegramId,
      p_username: input.username,
      p_display_name: input.displayName,
      p_first_name: input.firstName,
      p_starter_players: input.starterPlayers.map((player) => ({
        firstName: player.firstName,
        lastName: player.lastName,
        nationality: player.nationality,
        age: player.age,
        position: player.position,
        overall: player.overall,
        potential: player.potential,
        attributes: player.attributes,
        wage: player.wage.toString(),
        contractDays: player.contractDays,
      })),
    });
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || typeof row.id !== "string" || row.telegramId !== input.telegramId
      || typeof row.displayName !== "string" || !Array.isArray(row.wallets)
      || (row.club !== null && (typeof row.club?.id !== "string" || typeof row.club?.name !== "string"
        || !Number.isInteger(row.club?.level) || !Number.isInteger(row.club?.reputation)))
      || row.wallets.some((wallet) => !["CASH", "GOLD", "HONOR"].includes(wallet.asset)
        || typeof wallet.balance !== "string" || !/^-?\d+$/.test(wallet.balance))) {
      throw new Error("SUPABASE_ACCOUNT_PROVISIONING_INVALID_RESPONSE");
    }
    return row;
  }
}
