import { AsyncLocalStorage } from "node:async_hooks";

export interface CompetitionReadPort {
  listOpen(userId: string): Promise<Array<Record<string, unknown>>>;
  get(userId: string, competitionId: string): Promise<Record<string, unknown>>;
}
const scope = new AsyncLocalStorage<CompetitionReadPort>();
export function withCompetitionReadPort<T>(port: CompetitionReadPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getCompetitionReadPort(): CompetitionReadPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) throw new Error("COMPETITION_READ_SUPABASE_REPOSITORY_REQUIRED");
  return port;
}
