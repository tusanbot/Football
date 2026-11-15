"use client";

import { useEffect, useState } from "react";

type RecordRow = { playerId: string; playerName: string; position: string; clubName: string; appearances: number; goals: number; assists: number; minutesPlayed: number; averageRating: number };
type Payload = { season: number; matches: number; minimumAppearances: number; awards: { topScorer: RecordRow | null; topAssists: RecordRow | null; playerOfSeason: RecordRow | null; teamOfSeason: RecordRow[] }; leaders: { scorers: RecordRow[]; assists: RecordRow[]; ratings: RecordRow[] } };
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const panel: React.CSSProperties = { background: "#1b293b", border: "1px solid #31445d", borderRadius: 12, padding: 14 };
const label: React.CSSProperties = { color: "#aebbd0", fontSize: 13 };
const dateSeason = new Date().getUTCFullYear();

export default function SeasonAwardsClient() {
  const [season, setSeason] = useState(String(dateSeason));
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const value = Number(season);
    if (!Number.isInteger(value) || value < 2020 || value > 2200) { setError("سال فصل معتبر نیست."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(API + "/v1/seasons/" + value + "/awards");
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "دریافت آرشیو فصل ناموفق بود.");
      setData(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "خطای نامشخص"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  const card = (title: string, row: RecordRow | null) => <article style={panel}><h3>{title}</h3>{row ? <><strong>{row.playerName}</strong><p>{row.clubName} · {row.position}</p><p style={label}>{row.appearances} بازی · {row.goals} گل · {row.assists} پاس گل · میانگین {row.averageRating.toFixed(2)}</p></> : <p style={label}>هنوز داده‌ای ثبت نشده است.</p>}</article>;
  const list = (title: string, rows: RecordRow[]) => <section style={panel}><h3>{title}</h3>{rows.length ? rows.map((row, index) => <p key={row.playerId}>{index + 1}. <strong>{row.playerName}</strong> · {row.clubName} · {row.goals} گل · {row.assists} پاس گل · {row.averageRating.toFixed(2)}</p>) : <p style={label}>بدون داده</p>}</section>;
  return <main dir="rtl" style={{ maxWidth: 960, margin: "auto", padding: 18, color: "#e9eff8", fontFamily: "sans-serif", display: "grid", gap: 12 }}>
    <header style={panel}><h1>آرشیو فصل‌ها و جوایز بازیکنان</h1><p style={label}>آمار فقط از مسابقات رسمی تکمیل‌شده همان فصل محاسبه می‌شود.</p><div style={{ display: "flex", gap: 8 }}><input value={season} onChange={(event) => setSeason(event.target.value)} inputMode="numeric" aria-label="سال فصل" style={{ padding: 10, borderRadius: 7, width: 120 }} /><button onClick={() => void load()} disabled={busy} style={{ padding: "9px 14px" }}>{busy ? "در حال دریافت…" : "نمایش فصل"}</button></div>{data && <p style={label}>فصل {data.season} · {data.matches} مسابقه تکمیل‌شده · حداقل حضور برای جوایز عملکردی: {data.minimumAppearances}</p>}{error && <p role="alert">{error}</p>}</header>
    {data && <><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>{card("بهترین گلزن فصل", data.awards.topScorer)}{card("بهترین پاسور فصل", data.awards.topAssists)}{card("بازیکن فصل", data.awards.playerOfSeason)}</div><section style={panel}><h2>تیم منتخب فصل · ۴-۳-۳</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>{data.awards.teamOfSeason.map((row) => <article key={row.playerId} style={{ border: "1px solid #31445d", borderRadius: 8, padding: 10 }}><strong>{row.playerName}</strong><p>{row.position} · {row.clubName}</p><small style={label}>{row.appearances} بازی · نمره {row.averageRating.toFixed(2)}</small></article>)}</div></section><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>{list("۱۰ گلزن برتر", data.leaders.scorers)}{list("۱۰ پاسور برتر", data.leaders.assists)}{list("۱۰ بازیکن برتر از نظر نمره", data.leaders.ratings)}</div></>}
  </main>;
}
