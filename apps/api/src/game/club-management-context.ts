import { AsyncLocalStorage } from "node:async_hooks";
export type ClubManagementAction = "UPGRADE_FACILITY" | "UPGRADE_COACH" | "HIRE_COACH" | "SIGN_SPONSOR" | "SCOUT_ACADEMY" | "RECRUIT_PROSPECT";
export interface ClubManagementPort {
 getAcademyLevel(userId: string): Promise<number>;
 getOperationsSnapshot?(userId: string): Promise<ClubOperationsSnapshot | null>;
 getFinanceReport?(userId: string, since: Date): Promise<ClubFinanceReport | null>;
 execute(action: ClubManagementAction, userId: string, idempotencyKey: string, payload: Record<string, unknown>, now: Date): Promise<unknown>;
}
export interface ClubOperationsSnapshot {
 club: {
  id:string; name:string; level:number; reputation:number; stadiumLevel:number; ticketPrice:string|number;
  trainingGroundLevel:number; academyLevel:number; operatingArrears:string|number;
 };
 coach: null | {id:string;name:string;level:number;trainingSkill:number;recoverySkill:number;medicalSkill:number;weeklySalary:string|number};
 sponsors: Array<{id:string;partnerName:string;tier:string;status:string;dailyIncome:string|number;startedAt:string;endsAt:string;createdAt:string}>;
 prospects: Array<Record<string, unknown> & {id:string;recruitmentCost:string|number;createdAt:string}>;
 financeEntries: Array<Record<string, unknown> & {id:string;amount:string|number;occurredAt:string}>;
 cashBalance:string|number|null;
}
export interface ClubFinanceReport {
 income:string|number; expenses:string|number;
 entries:Array<Record<string,unknown>&{id:string;amount:string|number;occurredAt:string}>;
}
const scope = new AsyncLocalStorage<ClubManagementPort>();
export function withClubManagementPort<T>(port: ClubManagementPort, operation: () => Promise<T>): Promise<T> { return scope.run(port, operation); }
export function getClubManagementPort(): ClubManagementPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("CLUB_MANAGEMENT_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
