import { AsyncLocalStorage } from "node:async_hooks";

export interface CompetitionCreationPort {
  create(input: {
    userId: string;
    name: string;
    maxTeams: number;
    idempotencyKey: string;
    format: "LEAGUE" | "CUP";
    cupLegs: number;
    season: number;
    rules: Record<string, boolean | number>;
    now: Date;
  }): Promise<unknown>;
  join(userId: string, competitionId: string, now: Date): Promise<unknown>;
  start(userId: string, competitionId: string, now: Date): Promise<unknown>;
}
const scope = new AsyncLocalStorage<CompetitionCreationPort>();
export function withCompetitionCreationPort<T>(port: CompetitionCreationPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getCompetitionCreationPort(): CompetitionCreationPort | undefined {
  return scope.getStore();
}
