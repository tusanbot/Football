import { AsyncLocalStorage } from "node:async_hooks";
export type ClubManagementAction = "UPGRADE_FACILITY" | "UPGRADE_COACH" | "HIRE_COACH" | "SIGN_SPONSOR" | "SCOUT_ACADEMY" | "RECRUIT_PROSPECT";
export interface ClubManagementPort {
 execute(action: ClubManagementAction, userId: string, idempotencyKey: string, payload: Record<string, unknown>, now: Date): Promise<unknown>;
}
const scope = new AsyncLocalStorage<ClubManagementPort>();
export function withClubManagementPort<T>(port: ClubManagementPort, operation: () => Promise<T>): Promise<T> { return scope.run(port, operation); }
export function getClubManagementPort(): ClubManagementPort | undefined { return scope.getStore(); }
