"use client";
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { createTelegramSession } from "../../lib/telegram-session";
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
type ReportPayload = {
  totals: { leagues: number; completedLeagues: number; seasons: number; clubs: number; promotions: number; relegations: number };
  seasons: { season: number; leagues: number; completed: number; teams: number; matches: number; champions: number; promotions: number; relegations: number }[];
  clubRankings: { clubId: string; clubName: string; seasons: number; championships: number; podiums: number; promotions: number; relegations: number; leagueEntries: number }[];
  movements: { clubId: string; clubName: string; season: number; tier: number; groupNumber: number; position: number; movement: "PROMOTION" | "RELEGATION"; offerStatus?: string }[];
  leagueHistory: { id: string; name: string; season: number; tier: number; groupNumber: number; status: string; completedAt: string | null; champion: string | null; runnerUp: string | null; relegated: string[]; promotions: { clubName: string; position: number; targetTier: number; status: string }[]; awards: { clubName: string; placement: number; awardName: string }[] }[];
  auditLogs: { id: string; actorTelegramId: string; action: string; targetType: string; targetId: string; reason: string | null; createdAt: string }[];
};
const panel: CSSProperties = { background: "#1b293b", border: "1px solid #31445d", borderRadius: 12, padding: 14 };
const button: React.CSSProperties = { border: 0, borderRadius: 7, padding: "8px 11px", color: "white", background: "#315b91", cursor: "pointer" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("fa-IR") : "—";
export default function LeagueManagementClient() {
  const [init, setInit] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [data, setData] = useState<Payload>({ leagues: [], queues: [], offers: [], applicationCounts: {} });
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [tab, setTab] = useState<"management" | "reports">("management");
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
  useEffect(() => {
    if (!init) return;
    let active = true;
    void createTelegramSession(API, init)
      .then((token) => { if (active) setSessionToken(token); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "احراز هویت ناموفق بود."); });
    return () => { active = false; };
  }, [init]);

  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = await fetch(API + path, {
      ...options,
      headers: { "content-type": "application/json", ...(sessionToken ? { authorization: "Bearer " + sessionToken } : {}), ...options.headers },
    });
    const body = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "REQUEST_FAILED");
    return body;
  }, [sessionToken]);

  const load = useCallback(async () => {
    if (!sessionToken || tab !== "management") return;
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
  }, [sessionToken, request, season, tier, status, query, tab]);

  const loadReports = useCallback(async () => {
    if (!sessionToken || tab !== "reports") return;
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (season) params.set("season", season);
      if (tier) params.set("tier", tier);
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", "100");
      const result = await request("/v1/admin/pyramid-leagues/reports?" + params.toString());
      setReport(result as unknown as ReportPayload);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "خطا در دریافت گزارش‌ها");
    } finally {
      setBusy(false);
    }
  }, [sessionToken, request, season, tier, query, tab]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadReports(); }, [loadReports]);

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
    <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button style={{ ...button, background: tab === "management" ? "#315b91" : "#46566c" }} onClick={() => setTab("management")}>مدیریت لیگ‌ها</button>
      <button style={{ ...button, background: tab === "reports" ? "#315b91" : "#46566c" }} onClick={() => setTab("reports")}>گزارش‌ها و تاریخچه</button>
    </nav>
    {tab === "management" && <div style={{ ...panel, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
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
    </div>}
    {tab === "reports" && <div style={{ ...panel, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <input aria-label="فصل گزارش" value={season} onChange={e => setSeason(e.target.value)} placeholder="فصل" style={{ padding: 9, borderRadius: 7, width: 100 }} />
      <select aria-label="سطح گزارش" value={tier} onChange={e => setTier(e.target.value)} style={{ padding: 9, borderRadius: 7 }}><option value="">همه سطوح</option>{Array.from({ length: 7 }, (_, i) => <option key={i + 1} value={String(i + 1)}>سطح {i + 1}</option>)}</select>
      <input aria-label="جست‌وجوی گزارش" value={query} onChange={e => setQuery(e.target.value)} placeholder="نام لیگ یا باشگاه" style={{ flex: 1, minWidth: 150, padding: 9, borderRadius: 7 }} />
      <button style={button} onClick={() => void loadReports()}>اعمال فیلتر گزارش</button>
    </div>}
    {message && <p role="status" style={{ ...panel, background: "#432b34" }}>{message}</p>}
    {busy ? <p>در حال دریافت اطلاعات…</p> : tab === "reports" ? (report ? <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(125px,1fr))", gap: 8 }}>
        {[
          ["لیگ‌ها", report.totals.leagues], ["پایان‌یافته", report.totals.completedLeagues],
          ["فصل‌ها", report.totals.seasons], ["باشگاه‌ها", report.totals.clubs],
          ["صعودهای قطعی", report.totals.promotions], ["سقوط‌ها", report.totals.relegations],
        ].map(([label, value]) => <div key={String(label)} style={panel}><small style={{ color: "#aebbd0" }}>{label}</small><div style={{ fontSize: 23, fontWeight: 700, marginTop: 4 }}>{value}</div></div>)}
      </div>
      <article style={panel}>
        <h3 style={{ marginTop: 0 }}>گزارش فصل‌ها</h3>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["فصل","لیگ‌ها","تکمیل‌شده","تیم‌ها","مسابقات","قهرمانان","صعود","سقوط"].map(x => <th key={x} style={{ textAlign: "right", padding: 7, borderBottom: "1px solid #40536d" }}>{x}</th>)}</tr></thead>
          <tbody>{report.seasons.map(row => <tr key={row.season}>{[row.season,row.leagues,row.completed,row.teams,row.matches,row.champions,row.promotions,row.relegations].map((v,i)=><td key={i} style={{ padding: 7, borderBottom: "1px solid #31445d" }}>{v}</td>)}</tr>)}</tbody>
        </table></div>
        {!report.seasons.length && <p style={{ color: "#aebbd0" }}>اطلاعاتی برای این فیلترها ثبت نشده است.</p>}
      </article>
      <article style={panel}>
        <h3 style={{ marginTop: 0 }}>رتبه‌بندی تاریخی باشگاه‌ها</h3>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["رتبه","باشگاه","قهرمانی","سکو","صعود","سقوط","حضور"].map(x=><th key={x} style={{ textAlign: "right", padding: 7, borderBottom: "1px solid #40536d" }}>{x}</th>)}</tr></thead>
          <tbody>{report.clubRankings.map((row,index)=><tr key={row.clubId}>{[index+1,row.clubName,row.championships,row.podiums,row.promotions,row.relegations,row.leagueEntries].map((v,i)=><td key={i} style={{ padding: 7, borderBottom: "1px solid #31445d" }}>{v}</td>)}</tr>)}</tbody>
        </table></div>
        {!report.clubRankings.length && <p style={{ color: "#aebbd0" }}>هنوز سابقه‌ای برای رتبه‌بندی وجود ندارد.</p>}
      </article>
      <article style={panel}>
        <h3 style={{ marginTop: 0 }}>تاریخچه صعود و سقوط</h3>
        {report.movements.map((item,index)=><div key={item.clubId+"-"+item.season+"-"+item.tier+"-"+index} style={{ padding: "8px 0", borderBottom: "1px solid #31445d", display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
          <strong>{item.clubName}</strong><span>{item.movement === "PROMOTION" ? "صعود" : "سقوط"} · فصل {item.season} · سطح {item.tier} · رتبه {item.position} · گروه {item.groupNumber}{item.offerStatus ? " · " + item.offerStatus : ""}</span>
        </div>)}
        {!report.movements.length && <p style={{ color: "#aebbd0" }}>رکورد صعود یا سقوطی ثبت نشده است.</p>}
      </article>
      <article style={panel}>
        <h3 style={{ marginTop: 0 }}>آرشیو فصل‌ها و گروه‌ها</h3>
        {report.leagueHistory.map(league=><details key={league.id} style={{ padding: "9px 0", borderBottom: "1px solid #31445d" }}>
          <summary style={{ cursor: "pointer" }}>{league.name} · فصل {league.season} · سطح {league.tier} · گروه {league.groupNumber} · {league.status}</summary>
          <div style={{ color: "#c2cede", fontSize: 13, marginTop: 8, display: "grid", gap: 5 }}>
            <span>قهرمان: {league.champion ?? "—"} · نایب‌قهرمان: {league.runnerUp ?? "—"}</span>
            <span>تیم‌های سقوط‌کرده: {league.relegated.join("، ") || "—"}</span>
            <span>پیشنهادهای صعود: {league.promotions.map(x=>x.clubName+" ("+x.status+"، سطح "+x.targetTier+")").join("، ") || "—"}</span>
            <span>جوایز: {league.awards.map(x=>x.placement+". "+x.awardName+" — "+x.clubName).join("، ") || "—"}</span>
            <span>پایان فصل: {date(league.completedAt)}</span>
          </div>
        </details>)}
      </article>
      <article style={panel}>
        <h3 style={{ marginTop: 0 }}>سوابق مدیریتی لیگ</h3>
        {report.auditLogs.map(log=><div key={log.id} style={{ padding: "8px 0", borderBottom: "1px solid #31445d", fontSize: 13 }}>
          <strong>{log.action}</strong> · {log.actorTelegramId} · {log.targetType} / {log.targetId}
          <div style={{ color: "#aebbd0", marginTop: 4 }}>{log.reason ?? "بدون توضیح"} · {date(log.createdAt)}</div>
        </div>)}
        {!report.auditLogs.length && <p style={{ color: "#aebbd0" }}>سابقه مدیریتی برای این فیلتر ثبت نشده است.</p>}
      </article>
    </div> : <p style={{ color: "#aebbd0" }}>گزارشی برای نمایش وجود ندارد.</p>) : <>
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
