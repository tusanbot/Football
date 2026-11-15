"use client";
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
declare global { interface Window { Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } } } }

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Status = "DRAFT" | "REGISTRATION" | "ACTIVE" | "COMPLETED" | "CANCELLED";
type League = {
  id: string; competitionId: string; tier: number; season: number; groupNumber: number; name: string; status: Status;
  startsAt: string | null; completedAt: string | null; matchCount: number; promotionProcessedAt: string | null;
  teams: { id: string; name: string; ownerId: string; finalPosition: number | null }[];
  standings: { position: number; clubId: string; clubName: string; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number }[];
  awards: { id: string; placement: number; awardName: string; awardType: string; clubName: string }[];
  promotionOffers: { id: string; clubId: string; clubName: string; targetTier: number; finalPosition: number; status: string; expiresAt: string }[];
};
type Queue = { id: string; tier: number; season: number; appliedAt: string; club: { id: string; name: string }; user: { displayName: string | null; telegramId: string } };
type Offer = { id: string; club: { id: string; name: string }; tier: number; season: number; groupNumber: number; leagueName: string; targetTier: number; finalPosition: number; status: string; offeredAt: string; expiresAt: string };
type Payload = { leagues: League[]; queues: Queue[]; offers: Offer[]; applicationCounts: Record<string, number> };
const panel: CSSProperties = { background: "#1b293b", border: "1px solid #31445d", borderRadius: 12, padding: 14 };
const button: React.CSSProperties = { border: 0, borderRadius: 7, padding: "8px 11px", color: "white", background: "#315b91", cursor: "pointer" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("fa-IR") : "—";
export default function LeagueManagementClient() {
  const [init, setInit] = useState("");
  const [data, setData] = useState<Payload>({ leagues: [], queues: [], offers: [], applicationCounts: {} });
  const [season, setSeason] = useState(String(new Date().getUTCFullYear() + 1));
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setInit(window.Telegram?.WebApp?.initData ?? "");
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);

  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = await fetch(API + path, {
      ...options,
      headers: { "content-type": "application/json", "x-telegram-init-data": init, ...options.headers },
    });
    const body = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "REQUEST_FAILED");
    return body;
  }, [init]);

  const load = useCallback(async () => {
    if (!init) return;
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (season) params.set("season", season);
      if (tier) params.set("tier", tier);
      if (status) params.set("status", status);
      if (query.trim()) params.set("q", query.trim());
      const result = await request("/v1/admin/pyramid-leagues?" + params.toString());
      setData(result);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "خطا در دریافت اطلاعات");
    } finally {
      setBusy(false);
    }
  }, [init, request, season, tier, status, query]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: string, targetId: string, extra: Record<string, string | number> = {}) => {
    try {
      await request("/v1/admin/pyramid-leagues/actions", {
        method: "POST",
        body: JSON.stringify({ action, targetId, ...extra, idempotencyKey: crypto.randomUUID() }),
      });
      setMessage("تغییر با موفقیت ثبت شد.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "عملیات ناموفق بود");
    }
  };

  return <section dir="rtl" style={{ display: "grid", gap: 14, color: "#e9eff8" }}>
    <header style={panel}>
      <h2 style={{ margin: "0 0 6px" }}>مدیریت هرم لیگ‌ها</h2>
      <p style={{ color: "#aebbd0", margin: 0 }}>کنترل فصل‌ها، گروه‌های ۸ تیمی، صف ثبت‌نام، پیشنهادهای صعود و جوایز.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <span style={{ ...panel, padding: 8 }}>در صف: {data.applicationCounts.QUEUED ?? 0}</span>
        <span style={{ ...panel, padding: 8 }}>تخصیص‌یافته: {data.applicationCounts.ASSIGNED ?? 0}</span>
        <span style={{ ...panel, padding: 8 }}>انصراف‌داده: {data.applicationCounts.WITHDRAWN ?? 0}</span>
      </div>
    </header>
    <div style={{ ...panel, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <input aria-label="فصل" value={season} onChange={e => setSeason(e.target.value)} placeholder="فصل" style={{ padding: 9, borderRadius: 7, width: 100 }} />
      <select aria-label="سطح لیگ" value={tier} onChange={e => setTier(e.target.value)} style={{ padding: 9, borderRadius: 7 }}>
        <option value="">همه سطوح</option>{Array.from({ length: 7 }, (_, i) => <option key={i + 1} value={String(i + 1)}>سطح {i + 1}</option>)}
      </select>
      <select aria-label="وضعیت لیگ" value={status} onChange={e => setStatus(e.target.value)} style={{ padding: 9, borderRadius: 7 }}>
        <option value="">همه وضعیت‌ها</option><option value="DRAFT">پیش‌نویس</option><option value="REGISTRATION">ثبت‌نام</option><option value="ACTIVE">فعال</option><option value="COMPLETED">پایان‌یافته</option><option value="CANCELLED">لغوشده</option>
      </select>
      <input aria-label="جست‌وجو" value={query} onChange={e => setQuery(e.target.value)} placeholder="نام لیگ یا باشگاه" style={{ flex: 1, minWidth: 150, padding: 9, borderRadius: 7 }} />
      <button style={button} onClick={() => void load()}>اعمال فیلتر</button>
      <button style={{ ...button, background: "#46566c" }} onClick={() => { setSeason(""); setTier(""); setStatus(""); setQuery(""); }}>پاک‌کردن فیلتر</button>
    </div>
    {message && <p role="status" style={{ ...panel, background: "#432b34" }}>{message}</p>}
    {busy ? <p>در حال دریافت اطلاعات…</p> : <>
      <div style={{ display: "grid", gap: 10 }}>
        <h3 style={{ marginBottom: 0 }}>لیگ‌ها ({data.leagues.length})</h3>
        {data.leagues.map(league => <article key={league.id} style={panel}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
            <div><strong>{league.name}</strong><div style={{ color: "#aebbd0", fontSize: 13, marginTop: 5 }}>سطح {league.tier} · فصل {league.season} · گروه {league.groupNumber} · {league.teams.length}/۸ تیم · {league.matchCount} مسابقه · {league.status}</div></div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {league.status !== "COMPLETED" && league.status !== "CANCELLED" && <button style={button} onClick={() => void act("league-status", league.id, { status: league.status === "ACTIVE" ? "CANCELLED" : "ACTIVE", reason: "تغییر وضعیت توسط مدیر" })}>{league.status === "ACTIVE" ? "لغو لیگ" : "فعال‌سازی"}</button>}
              <button style={{ ...button, background: "#46566c" }} onClick={() => setExpanded(expanded === league.id ? null : league.id)}>{expanded === league.id ? "بستن جزئیات" : "جزئیات"}</button>
            </div>
          </div>
          {expanded === league.id && <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            <div><strong>جدول رده‌بندی</strong><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", marginTop: 7, fontSize: 13 }}><thead><tr>{["رتبه","باشگاه","بازی","برد","مساوی","باخت","گل","امتیاز"].map(label => <th key={label} style={{ textAlign: "right", padding: 7, borderBottom: "1px solid #40536d" }}>{label}</th>)}</tr></thead><tbody>{league.standings.map(row => <tr key={row.clubId}>{[row.position,row.clubName,row.played,row.won,row.drawn,row.lost,row.goalsFor + ":" + row.goalsAgainst,row.points].map((value, i) => <td key={i} style={{ padding: 7, borderBottom: "1px solid #31445d" }}>{value}</td>)}</tr>)}</tbody></table></div></div>
            <div><strong>تیم‌های ثبت‌شده</strong><p style={{ color: "#aebbd0", margin: "5px 0" }}>{league.teams.map(team => team.name).join("، ") || "بدون تیم"}</p></div>
            <div><strong>جوایز</strong>{league.awards.length ? league.awards.map(award => <div key={award.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}><span>{award.placement}. {award.awardName} — {award.clubName} ({award.awardType})</span><button style={button} onClick={() => { const name = window.prompt("عنوان جایزه", award.awardName); if (name) void act("update-award", award.id, { awardName: name, reason: "ویرایش جایزه توسط مدیر" }); }}>ویرایش عنوان</button></div>) : <p style={{ color: "#aebbd0" }}>هنوز جایزه‌ای ثبت نشده است.</p>}</div>
            <div><strong>پیشنهادهای صعود</strong>{league.promotionOffers.length ? league.promotionOffers.map(offer => <div key={offer.id} style={{ marginTop: 5, color: "#aebbd0" }}>{offer.clubName} · رتبه {offer.finalPosition} · سطح مقصد {offer.targetTier} · {offer.status} · مهلت {date(offer.expiresAt)} <button style={button} onClick={() => { const hours = Number(window.prompt("چند ساعت به مهلت اضافه شود؟", "24")); if (Number.isInteger(hours) && hours > 0 && hours <= 72) void act("extend-promotion-deadline", offer.id, { hours, reason: "تمدید مهلت توسط مدیر" }); }}>تمدید مهلت</button></div>) : <p style={{ color: "#aebbd0" }}>پیشنهادی وجود ندارد.</p>}</div>
            <small style={{ color: "#aebbd0" }}>شروع: {date(league.startsAt)} · پایان: {date(league.completedAt)} · پردازش صعود: {date(league.promotionProcessedAt)}</small>
          </div>}
        </article>)}
        {!data.leagues.length && <p style={{ color: "#aebbd0" }}>لیگی با این فیلترها پیدا نشد.</p>}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <h3>صف انتظار تشکیل لیگ ({data.queues.length})</h3>
        {data.queues.map((item, index) => <article key={item.id} style={{ ...panel, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}><span>{index + 1}. {item.club.name} · سطح {item.tier} · فصل {item.season} · {item.user.displayName ?? item.user.telegramId} · {date(item.appliedAt)}</span><button style={{ ...button, background: "#8b3948" }} onClick={() => void act("withdraw-application", item.id, { reason: "حذف درخواست توسط مدیر" })}>حذف از صف</button></article>)}
        {!data.queues.length && <p style={{ color: "#aebbd0" }}>درخواست در صفی وجود ندارد.</p>}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <h3>پیگیری پیشنهادهای صعود ({data.offers.length})</h3>
        {data.offers.map(offer => <article key={offer.id} style={panel}><strong>{offer.club.name}</strong><div style={{ color: "#aebbd0", fontSize: 13, marginTop: 5 }}>{offer.leagueName} · فصل {offer.season} · سطح {offer.tier} به {offer.targetTier} · رتبه {offer.finalPosition} · {offer.status} · مهلت {date(offer.expiresAt)}</div>{offer.status === "PENDING" && <button style={{ ...button, marginTop: 8 }} onClick={() => { const hours = Number(window.prompt("چند ساعت تمدید شود؟", "24")); if (Number.isInteger(hours) && hours > 0 && hours <= 72) void act("extend-promotion-deadline", offer.id, { hours, reason: "تمدید مهلت توسط مدیر" }); }}>تمدید مهلت پاسخ</button>}</article>)}
        {!data.offers.length && <p style={{ color: "#aebbd0" }}>پیشنهاد صعودی وجود ندارد.</p>}
      </div>
    </>}
  </section>;
}
