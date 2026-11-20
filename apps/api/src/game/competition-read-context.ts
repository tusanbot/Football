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
  return scope.getStore();
}
