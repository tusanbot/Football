"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createTelegramSession } from "../../lib/telegram-session";

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } };
  }
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type StoreItem = { key: string; name: string; description: string; category: string; asset: "CASH" | "GOLD"; price: string; maxPerPurchase: number };
type InventoryItem = { itemKey: string; quantity: number };
type Listing = { id: string; askingPrice: string; player: { id: string; firstName: string; lastName: string; overall: number; position: string; potential: number }; sellerClub: { name: string } };
type SpecialPlayer = { id: string; fullName: string; rarity: string; overall: number; potential: number; positions: string[] };
type PackOffer = { method: "epic_pack" | "legendary_pack" | "icon_pack"; rarity: string; priceGold: string };
type Player = { id: string; firstName: string; lastName: string; overall: number; fitness: number; morale: number };

const format = (value: string | number) => new Intl.NumberFormat("fa-IR").format(Number(value));
const assetLabel = (asset: string) => asset === "CASH" ? "کش" : "طلا";

export default function StoreClient() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<StoreItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [wallets, setWallets] = useState<Array<{ asset: string; balance: string }>>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerListings, setPlayerListings] = useState<Listing[]>([]);
  const [specialPlayers, setSpecialPlayers] = useState<SpecialPlayer[]>([]);
  const [packOffers, setPackOffers] = useState<PackOffer[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const headers = useMemo(() => token ? { authorization: "Bearer " + token, "content-type": "application/json" } : null, [token]);

  const load = useCallback(async (auth: string) => {
    const h = { authorization: "Bearer " + auth };
    const [storeResponse, playersResponse] = await Promise.all([
      fetch(API + "/v1/store", { headers: h }),
      fetch(API + "/v1/club/players", { headers: h }),
    ]);
    const storeData = await storeResponse.json();
    if (!storeResponse.ok) throw new Error(storeData.error ?? "دریافت فروشگاه ناموفق بود.");
    setItems(storeData.items ?? []);
    setInventory(storeData.inventory ?? []);
    setWallets(storeData.wallets ?? []);
    setPlayerListings(storeData.playerListings ?? []);
    setSpecialPlayers(storeData.specialPlayers ?? []);
    setPackOffers(storeData.packOffers ?? []);
    if (playersResponse.ok) {
      const playerData = await playersResponse.json();
      setPlayers(playerData.players ?? []);
      if (!selectedPlayer && playerData.players?.[0]) setSelectedPlayer(playerData.players[0].id);
    }
  }, [selectedPlayer]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const initData = window.Telegram?.WebApp?.initData ?? "";
        if (!initData) throw new Error("برای استفاده از فروشگاه، این صفحه را از داخل تلگرام باز کنید.");
        window.Telegram?.WebApp?.ready?.();
        window.Telegram?.WebApp?.expand?.();
        const auth = await createTelegramSession(API, initData);
        if (!active) return;
        setToken(auth);
        await load(auth);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "خطای نامشخص");
      }
    })();
    return () => { active = false; };
  }, [load]);

  const refresh = async () => { if (token) await load(token); };

  async function purchase(item: StoreItem) {
    if (!headers) return;
    setBusy(item.key); setError(""); setMessage("");
    try {
      const response = await fetch(API + "/v1/store/purchase", {
        method: "POST", headers,
        body: JSON.stringify({ itemKey: item.key, quantity: 1, idempotencyKey: "web-store-" + crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "خرید ناموفق بود.");
      setMessage("«" + item.name + "» با موفقیت خریداری شد و به انبار اضافه شد.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "خرید ناموفق بود."); }
    finally { setBusy(""); }
  }

  async function useItem(itemKey: string) {
    if (!headers || !selectedPlayer) { setError("ابتدا بازیکن موردنظر را انتخاب کنید."); return; }
    setBusy("use-" + itemKey); setError(""); setMessage("");
    try {
      const response = await fetch(API + "/v1/store/use", {
        method: "POST", headers,
        body: JSON.stringify({ itemKey, playerId: selectedPlayer, idempotencyKey: "web-use-" + crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "استفاده از آیتم ناموفق بود.");
      setMessage("آیتم استفاده شد. آمادگی بازیکن: " + data.usage.player.fitness + " · روحیه: " + data.usage.player.morale);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "استفاده از آیتم ناموفق بود."); }
    finally { setBusy(""); }
  }

  async function buyPlayer(listingId: string) {
    if (!headers) return;
    setBusy("player-" + listingId); setError(""); setMessage("");
    try {
      const response = await fetch(API + "/v1/market/listings/" + encodeURIComponent(listingId) + "/buy", { method: "POST", headers, body: JSON.stringify({}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "خرید بازیکن ناموفق بود.");
      setMessage("بازیکن با موفقیت به باشگاه شما منتقل شد.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "خرید بازیکن ناموفق بود."); }
    finally { setBusy(""); }
  }

  async function buyPack(method: PackOffer["method"]) {
    if (!headers) return;
    setBusy("pack-" + method); setError(""); setMessage("");
    try {
      const response = await fetch(API + "/v1/players/special/acquire", { method: "POST", headers, body: JSON.stringify({ method, idempotencyKey: "web-pack-" + crypto.randomUUID() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "جذب بازیکن ویژه ناموفق بود.");
      setMessage("بازیکن ویژه " + data.acquisition.specialPlayer.fullName + " به باشگاه اضافه شد.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "جذب بازیکن ویژه ناموفق بود."); }
    finally { setBusy(""); }
  }

  const owned = (key: string) => inventory.find((item) => item.itemKey === key)?.quantity ?? 0;

  return <main style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 18px", color: "var(--tg-theme-text-color, #f4f6fa)" }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
      <div><p style={{ opacity: .65, letterSpacing: 2, margin: 0 }}>FOOTBALL EMPIRE</p><h1 style={{ margin: "8px 0" }}>فروشگاه باشگاه</h1><p style={{ opacity: .75, marginTop: 0 }}>آیتم‌های کاربردی را با کش یا طلا تهیه کنید.</p></div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{wallets.map((wallet) => <div key={wallet.asset} style={{ background: "var(--tg-theme-secondary-bg-color, #202a37)", borderRadius: 12, padding: "12px 16px" }}><small>{assetLabel(wallet.asset)}</small><strong style={{ display: "block", fontSize: 20 }}>{format(wallet.balance)}</strong></div>)}</div>
    </header>
    <nav style={{ display: "flex", gap: 10, margin: "16px 0 22px" }}><a href="/" style={{ color: "inherit" }}>بازار و مدیریت باشگاه</a><span style={{ opacity: .5 }}>/</span><span>فروشگاه</span></nav>
    {message && <p role="status" style={{ padding: 12, borderRadius: 10, background: "#173d32" }}>{message}</p>}
    {error && <p role="alert" style={{ padding: 12, borderRadius: 10, background: "#4a252b" }}>{error}</p>}
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14 }}>
      {items.map((item) => <article key={item.key} style={{ border: "1px solid var(--tg-theme-hint-color, #435064)", borderRadius: 16, padding: 18, background: "var(--tg-theme-secondary-bg-color, #202a37)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ opacity: .7, fontSize: 12 }}>{item.category === "RECOVERY" ? "ریکاوری" : "روحیه"}</span><strong>{format(owned(item.key))} عدد در انبار</strong></div>
        <h2 style={{ fontSize: 20 }}>{item.name}</h2><p style={{ minHeight: 48, opacity: .8 }}>{item.description}</p>
        <p style={{ fontSize: 18, fontWeight: 700 }}>{format(item.price)} {assetLabel(item.asset)}</p>
        <button disabled={!!busy} onClick={() => void purchase(item)} style={{ width: "100%", padding: 12, border: 0, borderRadius: 10, background: "var(--tg-theme-button-color, #2d8cff)", color: "var(--tg-theme-button-text-color, white)", fontWeight: 700 }}>{busy === item.key ? "در حال خرید…" : "خرید آیتم"}</button>
        {owned(item.key) > 0 && <button disabled={!!busy || !players.length} onClick={() => void useItem(item.key)} style={{ width: "100%", padding: 10, marginTop: 8, border: "1px solid currentColor", borderRadius: 10, background: "transparent", color: "inherit" }}>{busy === "use-" + item.key ? "در حال استفاده…" : "استفاده برای بازیکن انتخاب‌شده"}</button>}
      </article>)}
    </section>
    <section style={{ marginTop: 28 }}>
      <h2>بازار بازیکنان</h2>
      <p style={{ opacity: .7 }}>بازیکنان سایر باشگاه‌ها را با کش خریداری کنید.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14 }}>
        {playerListings.map((listing) => <article key={listing.id} style={{ border: "1px solid var(--tg-theme-hint-color, #435064)", borderRadius: 14, padding: 16, background: "var(--tg-theme-secondary-bg-color, #202a37)" }}>
          <h3>{listing.player.firstName} {listing.player.lastName}</h3><p>OVR {listing.player.overall} · پتانسیل {listing.player.potential} · {listing.player.position}</p><small>فروشنده: {listing.sellerClub.name}</small>
          <p><strong>{format(listing.askingPrice)} کش</strong></p>
          <button disabled={!!busy} onClick={() => void buyPlayer(listing.id)} style={{ width: "100%", padding: 11, border: 0, borderRadius: 9, background: "var(--tg-theme-button-color, #2d8cff)", color: "var(--tg-theme-button-text-color, white)" }}>{busy === "player-" + listing.id ? "در حال خرید…" : "خرید بازیکن"}</button>
        </article>)}
        {!playerListings.length && <p style={{ opacity: .65 }}>در حال حاضر بازیکنی برای فروش ثبت نشده است.</p>}
      </div>
    </section>
    <section style={{ marginTop: 28 }}>
      <h2>بسته‌های ستاره ویژه</h2>
      <p style={{ opacity: .7 }}>با طلا بسته بخر و یک بازیکن ویژه تصادفی دریافت کن.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
        {packOffers.map((offer) => <article key={offer.method} style={{ padding: 16, borderRadius: 14, background: "var(--tg-theme-secondary-bg-color, #202a37)" }}>
          <strong>{offer.rarity === "ICON" ? "آیکون" : offer.rarity === "LEGENDARY" ? "افسانه‌ای" : "حماسی"}</strong>
          <p>{format(offer.priceGold)} طلا</p>
          <button disabled={!!busy} onClick={() => void buyPack(offer.method)} style={{ width: "100%", padding: 11, border: 0, borderRadius: 9, background: "var(--tg-theme-button-color, #2d8cff)", color: "var(--tg-theme-button-text-color, white)" }}>{busy === "pack-" + offer.method ? "در حال جذب…" : "خرید بسته"}</button>
        </article>)}
      </div>
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 8 }}>
        {specialPlayers.slice(0, 12).map((player) => <div key={player.id} style={{ padding: 12, borderRadius: 10, background: "var(--tg-theme-secondary-bg-color, #202a37)" }}><strong>{player.fullName}</strong><div>OVR {player.overall} · POT {player.potential}</div><small>{player.rarity} · {player.positions.join(" / ")}</small></div>)}
      </div>
    </section>
    <section style={{ marginTop: 24, padding: 18, borderRadius: 16, background: "var(--tg-theme-secondary-bg-color, #202a37)" }}>
      <h2 style={{ marginTop: 0 }}>انتخاب بازیکن برای مصرف آیتم</h2>
      {players.length ? <select value={selectedPlayer} onChange={(e) => setSelectedPlayer(e.target.value)} style={{ width: "100%", maxWidth: 480, padding: 12, borderRadius: 10, background: "var(--tg-theme-bg-color, #111923)", color: "inherit" }}>{players.map((player) => <option key={player.id} value={player.id}>{player.firstName} {player.lastName} · OVR {player.overall} · آمادگی {player.fitness} · روحیه {player.morale}</option>)}</select> : <p>برای استفاده از آیتم‌ها ابتدا باشگاه و بازیکن داشته باشید.</p>}
    </section>
    <p style={{ opacity: .6, fontSize: 12, marginTop: 24 }}>خریدها در سرور ثبت می‌شوند و موجودی، کیف پول و دفترکل مالی به‌صورت تراکنشی به‌روزرسانی می‌شوند. بازیکنان از بازار نقل‌وانتقالات و بسته‌های ستاره ویژه قابل تهیه هستند.</p>
  </main>;
}
