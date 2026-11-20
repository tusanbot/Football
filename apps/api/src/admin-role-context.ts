export interface AdminRoleAssignment {
  role: string;
  active: boolean;
}
export interface AdminRoleLookupPort {
  getAssignment(telegramId: string): Promise<AdminRoleAssignment | null>;
}
