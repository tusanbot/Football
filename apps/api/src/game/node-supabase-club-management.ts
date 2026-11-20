import type { ClubManagementAction, ClubManagementPort, ClubOperationsSnapshot, ClubFinanceReport } from "./club-management-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";
export class SupabaseClubManagementRepository implements ClubManagementPort {
 constructor(private readonly client: SupabaseHttpClient) {}
 async getAcademyLevel(userId: string): Promise<number> {
  const rows = await this.client.select<Array<{ academyLevel: number }>>("Club", {
   select: "academyLevel", ownerId: "eq." + userId, limit: "1",
  });
  if (!Array.isArray(rows) || !rows[0] || !Number.isInteger(rows[0].academyLevel)) throw new Error("CLUB_NOT_FOUND");
  return rows[0].academyLevel;
 }
 async getOperationsSnapshot(userId: string): Promise<ClubOperationsSnapshot | null> {
  const clubs = await this.client.select<Array<ClubOperationsSnapshot["club"]>>("Club", {
   select: "id,name,level,reputation,stadiumLevel,ticketPrice,trainingGroundLevel,academyLevel,operatingArrears",
   ownerId: "eq." + userId, limit: "1",
  });
  const club = clubs[0];
  if (!club) return null;
  const [coaches,sponsors,prospects,financeEntries,wallets] = await Promise.all([
   this.client.select<ClubOperationsSnapshot["coach"][]>("Coach", {
    select: "id,name,level,trainingSkill,recoverySkill,medicalSkill,weeklySalary", clubId: "eq." + club.id, limit: "1",
   }),
   this.client.select<ClubOperationsSnapshot["sponsors"]>("SponsorContract", {
    select: "id,partnerName,tier,status,dailyIncome,startedAt,endsAt,createdAt",
    clubId: "eq." + club.id, order: "createdAt.desc", limit: "5",
   }),
   this.client.select<ClubOperationsSnapshot["prospects"]>("AcademyProspect", {
    select: "*", clubId: "eq." + club.id, status: "eq.AVAILABLE", order: "createdAt.desc", limit: "12",
   }),
   this.client.select<ClubOperationsSnapshot["financeEntries"]>("ClubFinanceEntry", {
    select: "*", clubId: "eq." + club.id, order: "occurredAt.desc", limit: "20",
   }),
   this.client.select<Array<{balance:string|number}>>("Wallet", {
    select: "balance", userId: "eq." + userId, asset: "eq.CASH", limit: "1",
   }),
  ]);
  return { club, coach: coaches[0] ?? null, sponsors, prospects, financeEntries, cashBalance: wallets[0]?.balance ?? null };
 }
 async getFinanceReport(userId: string, since: Date): Promise<ClubFinanceReport | null> {
  const clubs = await this.client.select<Array<{id:string}>>("Club", {
   select: "id", ownerId: "eq." + userId, limit: "1",
  });
  const club = clubs[0];
  if (!club) return null;
  const [entries,totals] = await Promise.all([
   this.client.select<ClubFinanceReport["entries"]>("ClubFinanceEntry", {
    select: "*", clubId: "eq." + club.id, occurredAt: "gte." + since.toISOString(),
    order: "occurredAt.desc", limit: "200",
   }),
   this.client.rpc<Array<{income:string|number;expenses:string|number}>>("get_club_finance_totals_http", {
    p_club_id: club.id, p_since: since.toISOString(),
   }),
  ]);
  return { income: totals[0]?.income ?? "0", expenses: totals[0]?.expenses ?? "0", entries };
 }
 async execute(action: ClubManagementAction, userId: string, idempotencyKey: string, payload: Record<string, unknown>, now: Date): Promise<unknown> {
  return this.client.rpc("club_management_command", { p_action: action, p_user_id: userId, p_idempotency_key: idempotencyKey, p_payload: payload, p_now: now.toISOString() });
 }
}
