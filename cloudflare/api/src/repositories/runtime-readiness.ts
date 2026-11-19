import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseRuntimeReadinessRepository {
  constructor(private readonly client: SupabaseHttpClient) {}

  async check(): Promise<boolean> {
    const result = await this.client.rpc<unknown>("football_runtime_readiness", {});
    if (typeof result !== "boolean") throw new Error("SUPABASE_RUNTIME_READINESS_INVALID_RESPONSE");
    return result;
  }
}
