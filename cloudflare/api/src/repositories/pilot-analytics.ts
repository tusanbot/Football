import type { SupabaseHttpClient } from "../supabase-http.js";

export interface PilotAnalyticsEventInput {
  eventName: string;
  userKey: string;
  actionKey: string;
  chatType: string;
  source: string;
}

export class SupabasePilotAnalyticsRepository {
  constructor(private readonly client: SupabaseHttpClient) {}

  async record(event: PilotAnalyticsEventInput): Promise<void> {
    await this.client.insert("PilotAnalyticsEvent", {
      eventName: event.eventName,
      userKey: event.userKey,
      actionKey: event.actionKey,
      chatType: event.chatType,
      source: event.source,
    });
  }
}
