import type { GameDashboardPort, GameDashboardSnapshot } from "./game-dashboard-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";

export class SupabaseGameDashboardRepository implements GameDashboardPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async getDashboard(userId: string): Promise<GameDashboardSnapshot> {
    const result = await this.client.rpc<GameDashboardSnapshot>("get_game_dashboard", { p_user_id: userId });
    if (!result || typeof result !== "object" || !result.user || !Array.isArray(result.wallets)) {
      throw new Error("SUPABASE_GAME_DASHBOARD_INVALID_RESPONSE");
    }
    return result;
  }
}
