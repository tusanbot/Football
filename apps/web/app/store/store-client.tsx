"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createTelegramSession } from "../lib/telegram-session";

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } };
  }
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type StoreItem = { key: string; name: string; description: string; category: string; asset: "CASH" | "GOLD"; price: string; maxPerPurchase: number };
type InventoryItem = { itemKey: string; quantity: number };
type Player = { id: string; firstName: string; lastName: string; overall: number; fitness: number; morale: number };

const format = (value: string | number) => new Intl.NumberFormat("fa-IR").format(Number(value));
const assetLabel = (asset: string) => asset === "CASH" ? "کش" : "طلا";

export default function StoreClient() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<StoreItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [wallets, setWallets] = useState<Array<{ asset: string; balance: string }>>([]);
  const [players, setPlayers] = useState<Player[]>([]);
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
    <section style={{ marginTop: 24, padding: 18, borderRadius: 16, background: "var(--tg-theme-secondary-bg-color, #202a37)" }}>
      <h2 style={{ marginTop: 0 }}>انتخاب بازیکن برای مصرف آیتم</h2>
      {players.length ? <select value={selectedPlayer} onChange={(e) => setSelectedPlayer(e.target.value)} style={{ width: "100%", maxWidth: 480, padding: 12, borderRadius: 10, background: "var(--tg-theme-bg-color, #111923)", color: "inherit" }}>{players.map((player) => <option key={player.id} value={player.id}>{player.firstName} {player.lastName} · OVR {player.overall} · آمادگی {player.fitness} · روحیه {player.morale}</option>)}</select> : <p>برای استفاده از آیتم‌ها ابتدا باشگاه و بازیکن داشته باشید.</p>}
    </section>
    <p style={{ opacity: .6, fontSize: 12, marginTop: 24 }}>خریدها در سرور ثبت می‌شوند و موجودی، کیف پول و دفترکل مالی به‌صورت تراکنشی به‌روزرسانی می‌شوند. بازیکنان از بازار نقل‌وانتقالات و بسته‌های ستاره ویژه قابل تهیه هستند.</p>
  </main>;
}
