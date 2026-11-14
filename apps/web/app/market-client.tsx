"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Player = { id: string; firstName: string; lastName: string; nationality: string; age: number; position: string; overall: number; potential: number; wage: string; status?: string };
type Listing = { id: string; askingPrice: string; status?: string; expiresAt: string; createdAt: string; player: Player; sellerClub?: { name: string } };
type SpecialPlayer = { id: string; fullName: string; nationality: string; positions: string[]; rarity: string; overall: number; potential: number; acquisitionMethods: string[] };
type PackOffer = { method: "epic_pack" | "legendary_pack" | "icon_pack"; rarity: string; priceGold: string };
declare global { interface Window { Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } } } }

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const money = (value: string | number) => new Intl.NumberFormat("en-US").format(Number(value));
const rarityLabel: Record<string, string> = { ICON: "Icon", LEGENDARY: "Legendary", EPIC: "Epic", RARE: "Rare" };

export default function MarketPage() {
  const [initData, setInitData] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [mine, setMine] = useState<Listing[]>([]);
  const [special, setSpecial] = useState<SpecialPlayer[]>([]);
  const [cash, setCash] = useState("0");
  const [gold, setGold] = useState("0");
  const [packOffers, setPackOffers] = useState<PackOffer[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [price, setPrice] = useState("1000");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"market" | "club" | "special">("market");

  const headers = useMemo(() => ({ "content-type": "application/json", "x-telegram-init-data": initData }), [initData]);

  const load = useCallback(async () => {
    if (!initData) return;
    const requests = await Promise.all([
      fetch(API + "/v1/club/players", { headers }),
      fetch(API + "/v1/wallet", { headers }),
      fetch(API + "/v1/market/listings", { headers }),
      fetch(API + "/v1/market/my-listings", { headers }),
      fetch(API + "/v1/players/special", { headers }),
    ]);
    const [p, w, m, own, s] = requests;
    if (p.ok) setPlayers((await p.json()).players);
    if (w.ok) { const data = await w.json(); setCash(data.wallets.find((x: { asset: string }) => x.asset === "CASH")?.balance ?? "0"); setGold(data.wallets.find((x: { asset: string }) => x.asset === "GOLD")?.balance ?? "0"); }
    if (m.ok) setListings((await m.json()).listings);
    if (own.ok) setMine((await own.json()).listings);
    if (s.ok) { const data = await s.json(); setSpecial(data.players); setPackOffers(data.packOffers ?? []); }
  }, [headers, initData]);

  useEffect(() => {
    const data = window.Telegram?.WebApp?.initData ?? "";
    setInitData(data);
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);
  useEffect(() => { void load().catch(() => setError("ارتباط با سرور بازی برقرار نشد.")); }, [load]);

  async function action(key: string, path: string, method = "POST", body?: unknown) {
    setBusy(key); setError(""); setMessage("");
    try {
      const response = await fetch(API + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "درخواست ناموفق بود");
      setMessage(data.acquisition?.specialPlayer?.fullName ? `بازیکن ویژه ${data.acquisition.specialPlayer.fullName} به باشگاه شما اضافه شد.` : "عملیات با موفقیت انجام شد.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "خطای نامشخص"); }
    finally { setBusy(""); }
  }

  if (!initData) return <main className="market-shell"><section className="market-card"><p className="market-kicker">FOOTBALL EMPIRE</p><h1>بازار نقل‌وانتقالات</h1><p>برای استفاده از بازار، بازی را از طریق ربات تلگرام و Mini App باز کنید.</p></section></main>;

  return <main className="market-shell">
    <header className="market-header"><div><p className="market-kicker">FOOTBALL EMPIRE</p><h1>بازار نقل‌وانتقالات</h1><p>خریدوفروش بازیکنان و بررسی ستاره‌های ویژه</p></div><div className="cash-box"><span>موجودی نقدی</span><strong>{money(cash)} <small>Cash</small></strong><span>طلای شما</span><strong>{money(gold)} <small>Gold</small></strong></div></header>
    <nav className="market-tabs">
      <button className={tab === "market" ? "active" : ""} onClick={() => setTab("market")}>بازار بازیکنان</button>
      <button className={tab === "club" ? "active" : ""} onClick={() => setTab("club")}>باشگاه من</button>
      <button className={tab === "special" ? "active" : ""} onClick={() => setTab("special")}>ستاره‌های ویژه</button>
    </nav>
    {message && <div className="notice success">{message}</div>}{error && <div className="notice error">{error}</div>}

    {tab === "market" && <section className="market-grid">
      {listings.length === 0 && <div className="empty-state">در حال حاضر آگهی فعالی وجود ندارد.</div>}
      {listings.map((item) => <article className="player-card" key={item.id}>
        <div className="player-rating"><strong>{item.player.overall}</strong><span>{item.player.position}</span></div>
        <div className="player-info"><h3>{item.player.firstName} {item.player.lastName}</h3><p>{item.player.nationality} · {item.player.age} سال · پتانسیل {item.player.potential}</p><small>فروشنده: {item.sellerClub?.name ?? "باشگاه دیگر"}</small></div>
        <div className="player-buy"><strong>{money(item.askingPrice)} <small>Cash</small></strong><button disabled={busy === item.id} onClick={() => void action(item.id, "/v1/market/listings/" + item.id + "/buy")}>{busy === item.id ? "در حال خرید…" : "خرید بازیکن"}</button></div>
      </article>)}
    </section>}

    {tab === "club" && <section className="club-market">
      <div className="market-card"><h2>ثبت بازیکن برای فروش</h2><p>فقط بازیکنان معمولی فعال قابل عرضه در بازار هستند.</p>
        <label>انتخاب بازیکن<select value={selectedPlayer} onChange={(e) => setSelectedPlayer(e.target.value)}><option value="">انتخاب کنید</option>{players.map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} · {p.position} · OVR {p.overall}</option>)}</select></label>
        <label>قیمت پیشنهادی (Cash)<input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))}/></label>
        <button disabled={!selectedPlayer || !price || busy === "sell"} onClick={() => void action("sell", "/v1/market/listings", "POST", { playerId: selectedPlayer, askingPrice: price, expiresInHours: 72 })}>{busy === "sell" ? "در حال ثبت…" : "ثبت آگهی فروش"}</button>
      </div>
      <div className="market-card"><h2>آگهی‌های من</h2>{mine.length === 0 ? <p className="muted">هنوز آگهی ثبت نکرده‌اید.</p> : mine.map((item) => <div className="my-listing" key={item.id}><div><strong>{item.player.firstName} {item.player.lastName}</strong><p>{money(item.askingPrice)} Cash · {item.status}</p></div>{item.status === "OPEN" && <button className="secondary" disabled={busy === item.id} onClick={() => void action(item.id, "/v1/market/listings/" + item.id, "DELETE")}>لغو آگهی</button>}</div>)}</div>
    </section>}

    {tab === "special" && <><section className="special-packs"><div className="market-card"><h2>جذب ستاره‌های ویژه</h2><p>هر بسته یک بازیکن تصادفی از رده مشخص‌شده می‌دهد. هر بازیکن ویژه را فقط یک‌بار می‌توانید در باشگاه خود داشته باشید.</p><div className="pack-actions">{packOffers.map((offer) => <button key={offer.method} disabled={!!busy || Number(gold) < Number(offer.priceGold)} onClick={() => void action("pack-" + offer.method, "/v1/players/special/acquire", "POST", { method: offer.method, idempotencyKey: crypto.randomUUID() })}>{busy === "pack-" + offer.method ? "در حال جذب…" : `${rarityLabel[offer.rarity] ?? offer.rarity} · ${money(offer.priceGold)} Gold`}</button>)}</div></div></section><section className="special-grid">{special.map((p) => <article className="special-card" key={p.id}><div className="special-top"><span>{rarityLabel[p.rarity] ?? p.rarity}</span><strong>{p.overall}</strong></div><h3>{p.fullName}</h3><p>{p.nationality} · {p.positions.join(" / ")}</p><div className="potential">Potential <strong>{p.potential}</strong></div><small>روش‌های جذب: {p.acquisitionMethods.join("، ")}</small></article>)}</section></>}
    <footer className="market-footer">بازیکنان ویژه در بازار عادی قابل معامله نیستند. خرید بازیکنان معمولی با Cash و بسته‌های جذب ستاره با Gold، به‌صورت امن در سرور ثبت می‌شوند.</footer>
  </main>;
}
