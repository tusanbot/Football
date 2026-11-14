export type UserId = string;
export type ClubId = string;
export type TelegramId = string;
export type Asset = "CASH" | "GOLD";

export interface ClubSummary { id: ClubId; ownerId: UserId; name: string; level: number; reputation: number; }
export interface WalletBalance { asset: Asset; balance: bigint; }
export interface GamePrincipal { userId: UserId; telegramId: TelegramId; }

/** Clients identify commands independently of transport. */
export interface GameCommandContext { principal: GamePrincipal; idempotencyKey: string; requestedAt: Date; }
