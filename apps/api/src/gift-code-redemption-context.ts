export interface GiftCodeRedemptionCommand {
  userId: string;
  code: string;
  idempotencyKey: string;
  telegramGroupId?: string | null;
}

export interface GiftCodeRedemptionResult {
  ok: true;
  reward: { cash: string; gold: string; groupPoints: string };
  replayed: boolean;
}

export interface GiftCodeRedemptionPort {
  redeem(input: GiftCodeRedemptionCommand): Promise<GiftCodeRedemptionResult>;
}
