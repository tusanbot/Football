import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { getTelegramAccountProvisioningPort } from "../src/auth/account-provisioning-context.js";
import { getTelegramUserLookupPort } from "../src/auth/telegram-user-lookup-context.js";
import { getWalletEntryPort } from "../src/economy/wallet-entry-context.js";
import { getWalletReadPort } from "../src/economy/wallet-read-context.js";
import { getEventTournamentReadPort } from "../src/event-tournament-read-context.js";
import { getClubEconomySettlementPort } from "../src/game/club-economy-settlement-context.js";
import { getClubLineupPort } from "../src/game/club-lineup-context.js";
import { getClubManagementPort } from "../src/game/club-management-context.js";
import { getClubTicketPricePort } from "../src/game/club-ticket-price-context.js";
import { getGameDashboardPort } from "../src/game/game-dashboard-context.js";
import { getGiftCodeRedemptionPort } from "../src/gift-code-redemption-context.js";
import { getActionRateLimitPort } from "../src/groups/action-rate-limit-context.js";
import { getAlliancePort } from "../src/groups/alliance-context.js";
import { getGroupMembershipPort } from "../src/groups/group-membership-context.js";
import { getMarketListingPort } from "../src/players/market-listing-context.js";
import { getMarketPurchasePort } from "../src/players/market-purchase-context.js";
import { getPlayerDevelopmentPort } from "../src/players/player-development-context.js";
import { getSpecialAcquisitionPort } from "../src/players/special-acquisition-context.js";
import { getStoreItemUsePort } from "../src/store/store-item-use-context.js";
import { getStorePurchasePort } from "../src/store/store-purchase-context.js";
import { getStoreSnapshotPort } from "../src/store/store-snapshot-context.js";

test("production service contexts fail closed when a Supabase repository is absent", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnvironment = process.env.ENVIRONMENT;
  process.env.NODE_ENV = "production";
  delete process.env.ENVIRONMENT;
  const cases: Array<[() => unknown, RegExp]> = [
    [getTelegramAccountProvisioningPort, /TELEGRAM_ACCOUNT_PROVISIONING_SUPABASE_REPOSITORY_REQUIRED/],
    [getTelegramUserLookupPort, /TELEGRAM_USER_LOOKUP_SUPABASE_REPOSITORY_REQUIRED/],
    [getWalletEntryPort, /WALLET_ENTRY_SUPABASE_REPOSITORY_REQUIRED/],
    [getWalletReadPort, /WALLET_READ_SUPABASE_REPOSITORY_REQUIRED/],
    [getEventTournamentReadPort, /EVENT_TOURNAMENT_READ_SUPABASE_REPOSITORY_REQUIRED/],
    [getClubEconomySettlementPort, /CLUB_ECONOMY_SETTLEMENT_SUPABASE_REPOSITORY_REQUIRED/],
    [getClubLineupPort, /CLUB_LINEUP_SUPABASE_REPOSITORY_REQUIRED/],
    [getClubManagementPort, /CLUB_MANAGEMENT_SUPABASE_REPOSITORY_REQUIRED/],
    [getClubTicketPricePort, /CLUB_TICKET_PRICE_SUPABASE_REPOSITORY_REQUIRED/],
    [getGameDashboardPort, /GAME_DASHBOARD_SUPABASE_REPOSITORY_REQUIRED/],
    [getGiftCodeRedemptionPort, /GIFT_CODE_REDEMPTION_SUPABASE_REPOSITORY_REQUIRED/],
    [getActionRateLimitPort, /ACTION_RATE_LIMIT_SUPABASE_REPOSITORY_REQUIRED/],
    [getAlliancePort, /ALLIANCE_SUPABASE_REPOSITORY_REQUIRED/],
    [getGroupMembershipPort, /GROUP_MEMBERSHIP_SUPABASE_REPOSITORY_REQUIRED/],
    [getMarketListingPort, /MARKET_LISTING_SUPABASE_REPOSITORY_REQUIRED/],
    [getMarketPurchasePort, /MARKET_PURCHASE_SUPABASE_REPOSITORY_REQUIRED/],
    [getPlayerDevelopmentPort, /PLAYER_DEVELOPMENT_SUPABASE_REPOSITORY_REQUIRED/],
    [getSpecialAcquisitionPort, /SPECIAL_ACQUISITION_SUPABASE_REPOSITORY_REQUIRED/],
    [getStoreItemUsePort, /STORE_ITEM_USE_SUPABASE_REPOSITORY_REQUIRED/],
    [getStorePurchasePort, /STORE_PURCHASE_SUPABASE_REPOSITORY_REQUIRED/],
    [getStoreSnapshotPort, /STORE_SNAPSHOT_SUPABASE_REPOSITORY_REQUIRED/],
  ];
  try {
    for (const [getPort, expected] of cases) assert.throws(getPort, expected);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = previousEnvironment;
  }
});

test("production API refuses to start without the complete Supabase repository set", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnvironment = process.env.ENVIRONMENT;
  process.env.NODE_ENV = "production";
  delete process.env.ENVIRONMENT;
  try {
    assert.throws(() => buildApp({ logger: false }), /SUPABASE_RUNTIME_REPOSITORIES_REQUIRED/);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = previousEnvironment;
  }
});
