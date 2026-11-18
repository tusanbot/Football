import type { WalletAsset } from "@prisma/client";

export type StoreItem = {
  key: string;
  name: string;
  description: string;
  category: "RECOVERY" | "MORALE";
  asset: WalletAsset;
  price: string;
  effect: { fitness?: number; morale?: number };
  maxPerPurchase: number;
};

export const STORE_CATALOG: StoreItem[] = [
  {
    key: "recovery_kit",
    name: "بسته ریکاوری",
    description: "آمادگی جسمانی بازیکن را ۳۵ واحد افزایش می‌دهد.",
    category: "RECOVERY",
    asset: "CASH",
    price: "1200",
    effect: { fitness: 35 },
    maxPerPurchase: 10,
  },
  {
    key: "morale_boost",
    name: "انگیزه‌بخش",
    description: "روحیه بازیکن را ۱۵ واحد افزایش می‌دهد.",
    category: "MORALE",
    asset: "GOLD",
    price: "5",
    effect: { morale: 15 },
    maxPerPurchase: 10,
  },
  {
    key: "honor_elite_recovery",
    name: "اکسیر افتخار",
    description: "با ارز افتخار خریداری می‌شود؛ آمادگی جسمانی را ۱۰۰ و روحیه را ۲۰ واحد افزایش می‌دهد.",
    category: "RECOVERY",
    asset: "HONOR",
    price: "5",
    effect: { fitness: 100, morale: 20 },
    maxPerPurchase: 2,
  },
  {
    key: "premium_recovery",
    name: "ریکاوری ویژه",
    description: "آمادگی جسمانی بازیکن را ۷۵ واحد افزایش می‌دهد.",
    category: "RECOVERY",
    asset: "GOLD",
    price: "12",
    effect: { fitness: 75 },
    maxPerPurchase: 5,
  },
];

export function getStoreItem(key: string): StoreItem | undefined {
  return STORE_CATALOG.find((item) => item.key === key);
}
