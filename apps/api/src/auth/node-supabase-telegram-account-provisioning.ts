import type {
  TelegramAccountProvisioningCommand,
  TelegramAccountProvisioningPort,
  ProvisionedTelegramAccount,
} from "./account-provisioning-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";

interface ProvisioningRpcResponse {
  id: string;
  telegramId: string;
  displayName: string;
  club: { id: string; name: string; level: number; reputation: number } | null;
  wallets: { asset: "CASH" | "GOLD" | "HONOR"; balance: string }[];
}

function unwrapProvisioningResponse(value: unknown): ProvisioningRpcResponse | undefined {
  if (Array.isArray(value)) {
    if (value.length !== 1) return undefined;
    value = value[0];
  }
  if (!value || typeof value !== "object") return undefined;
  return value as ProvisioningRpcResponse;
}

function isProvisioningResponse(value: unknown, telegramId: string): value is ProvisioningRpcResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.telegramId !== telegramId || typeof row.displayName !== "string") return false;
  if (row.club !== null) {
    if (!row.club || typeof row.club !== "object" || Array.isArray(row.club)) return false;
    const club = row.club as Record<string, unknown>;
    if (typeof club.id !== "string" || typeof club.name !== "string"
      || !Number.isInteger(club.level) || !Number.isInteger(club.reputation)) return false;
  }
  if (!Array.isArray(row.wallets)) return false;
  return row.wallets.every((wallet) => {
    if (!wallet || typeof wallet !== "object" || Array.isArray(wallet)) return false;
    const item = wallet as Record<string, unknown>;
    return ["CASH", "GOLD", "HONOR"].includes(String(item.asset))
      && typeof item.balance === "string" && /^-?\\d+$/.test(item.balance);
  });
}

/** Server-only HTTPS/PostgREST adapter for atomic Telegram account provisioning. */
export class NodeSupabaseTelegramAccountProvisioningRepository implements TelegramAccountProvisioningPort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async provision(input: TelegramAccountProvisioningCommand): Promise<ProvisionedTelegramAccount> {
    const response = await this.client.rpc<unknown>("provision_telegram_account", {
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
    const row = unwrapProvisioningResponse(response);
    if (!isProvisioningResponse(row, input.telegramId)) {
      throw new Error("SUPABASE_ACCOUNT_PROVISIONING_INVALID_RESPONSE");
    }
    return row as ProvisionedTelegramAccount;
  }
}
