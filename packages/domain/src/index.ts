export type UserId = string;
export type ClubId = string;
export type TelegramId = string;
export type Asset = "CASH" | "GOLD";

export interface ClubSummary { id: ClubId; ownerId: UserId; name: string; level: number; reputation: number; }
export interface WalletBalance { asset: Asset; balance: bigint; }
export interface GamePrincipal { userId: UserId; telegramId: TelegramId; }

/** Clients identify commands independently of transport. */
export interface GameCommandContext { principal: GamePrincipal; idempotencyKey: string; requestedAt: Date; }

export * from "./economy.js";
export * from "./players.js";

export * from "./lineup.js";

export * from "./player-development.js";
export * from "./club-economy.js";

export * from "./match-engine.js";
export * from "./match-rules.js";
export * from "./match-checkpoints.js";
export * from "./match-runtime.js";
export * from "./match-segments.js";

export * from "./league-pyramid.js";
export * from "./league-pyramid-registration.js";

export * from "./legends-draft.js";
export * from "./missions.js";
