import { AsyncLocalStorage } from "node:async_hooks";

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
  consumeRateLimit(input: { telegramUserId: string; limit: number }): Promise<boolean>;
  redeem(input: GiftCodeRedemptionCommand): Promise<GiftCodeRedemptionResult>;
}


const giftCodeRedemptionScope = new AsyncLocalStorage<GiftCodeRedemptionPort>();

export function withGiftCodeRedemptionPort<T>(port: GiftCodeRedemptionPort, operation: () => T): T {
  return giftCodeRedemptionScope.run(port, operation);
}

export function getGiftCodeRedemptionPort(): GiftCodeRedemptionPort | undefined {
  return giftCodeRedemptionScope.getStore();
}
