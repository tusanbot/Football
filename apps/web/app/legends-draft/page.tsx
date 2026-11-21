"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createTelegramSession } from "../../lib/telegram-session";

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } };
  }
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type PoolPlayer = { id: string; name: string; line: "GK" | "DEF" | "MID" | "ATT"; overall: number };
type Pick = { pick_number: number; user_id: string; player_id: string; player_snapshot: PoolPlayer };
type Draft = {
  id: string; creator_user_id: string; opponent_user_id: string | null; status: string;
  player_pool: PoolPlayer[]; current_pick_number: number; version: number;
  creator_formation: string | null; opponent_formation: string | null; expires_at: string;
  match_result?: Record<string, unknown> | null; match_id?: string | null;
};
type DraftData = { challenge: Draft; picks: Pick[] };
type RecordData = { wins: number; losses: number; draws: number; matches: number };

const formations = ["2-2", "1-2-1", "1-1-2", "2-1-1"];

export default function LegendsDraftPage() {
  const params = useSearchParams();
  const [initData, setInitData] = useState("");
  const [token, setToken] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [draftId, setDraftId] = useState(params.get("draft") ?? "");
  const [data, setData] = useState<DraftData | null>(null);
  const [records, setRecords] = useState<RecordData | null>(null);
  const [formation, setFormation] = useState("2-2");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const headers = useMemo(() => ({
    "content-type": "application/json",
    ...(token ? { authorization: "Bearer " + token } : {}),
  }), [token]);

  useEffect(() => {
    const init = window.Telegram?.WebApp?.initData ?? "";
    setInitData(init);
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);

  useEffect(() => {
    if (!initData) return;
    let active = true;
    void createTelegramSession(API, initData)
      .then((value) => { if (active) setToken(value); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "ورود به تلگرام ناموفق بود."); });
    return () => { active = false; };
  }, [initData]);

  const request = useCallback(async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const response = await fetch(API + path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "درخواست ناموفق بود");
    return payload;
  }, [headers]);

  const load = useCallback(async (id = draftId) => {
    if (!id) return;
    const result = await request<DraftData>("/v1/legends-draft/" + encodeURIComponent(id));
    setData(result);
    if (result.challenge.creator_user_id) {
      const r = await request<{ records: RecordData }>("/v1/legends-draft/players/" + encodeURIComponent(result.challenge.creator_user_id) + "/records");
      if (result.challenge.creator_user_id === result.challenge.opponent_user_id) setRecords(r.records);
    }
  }, [draftId, request]);

  useEffect(() => { if (token && draftId) void load().catch((e) => setError(e instanceof Error ? e.message : "بارگذاری درفت ناموفق بود.")); }, [token, draftId, load]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "عملیات ناموفق بود."); }
    finally { setBusy(false); }
  }

  const challenge = data?.challenge;
  const picks = data?.picks ?? [];
  const currentUserId = challenge?.creator_user_id;
  const myPick = challenge && (challenge.current_pick_number % 2 === 1
    ? challenge.creator_user_id : challenge.opponent_user_id);
  const isParticipant = Boolean(challenge && (challenge.creator_user_id || challenge.opponent_user_id));
  const myTurn = Boolean(challenge && myPick && (challenge.status === "DRAFTING"));
  const selectedIds = new Set(picks.map((pick) => pick.player_id));

  async function createDraft() {
    const opponent = telegramId.trim();
    if (!/^\d{1,20}$/.test(opponent)) throw new Error("شناسه عددی تلگرام حریف را وارد کن.");
    const result = await request<{ challenge: Draft }>("/v1/legends-draft", "POST", { opponentTelegramId: opponent });
    setDraftId(result.challenge.id);
    setData({ challenge: result.challenge, picks: [] });
    setNotice("دعوت درفت ساخته شد؛ شناسه را برای حریف بفرست تا در Mini App وارد کند.");
  }

  async function acceptDraft() {
    await request("/v1/legends-draft/" + encodeURIComponent(draftId) + "/accept", "POST", {});
    await load(draftId);
    setNotice("دعوت پذیرفته شد؛ انتخاب بازیکنان شروع شد.");
  }

  async function pickPlayer(playerId: string) {
    if (!challenge) return;
    await request("/v1/legends-draft/" + encodeURIComponent(challenge.id) + "/picks", "POST", {
      playerId, idempotencyKey: crypto.randomUUID(), expectedVersion: challenge.version,
    });
    await load(challenge.id);
  }

  async function saveFormation() {
    if (!challenge) return;
    await request("/v1/legends-draft/" + encodeURIComponent(challenge.id) + "/formation", "POST", {
      formation, expectedVersion: challenge.version,
    });
    await load(challenge.id);
    setNotice("آرایش ثبت شد.");
  }

  async function play() {
    if (!challenge) return;
    const result = await request<{ result: Record<string, unknown>; replayed?: boolean }>(
      "/v1/legends-draft/" + encodeURIComponent(challenge.id) + "/play", "POST", {},
    );
    await load(challenge.id);
    setNotice(result.replayed ? "نتیجه قبلاً ثبت شده بود." : "نتیجه مسابقه ثبت شد.");
  }

  return <main style={{ maxWidth: 760, margin: "0 auto", padding: 20, direction: "rtl", color: "var(--foreground, #f5f5f5)" }}>
    <header style={{ marginBottom: 20 }}>
      <a href="/" style={{ color: "inherit" }}>← بازگشت</a>
      <h1>درفت اسطوره‌ها</h1>
      <p>دو نفر، ۱۰ انتخاب نوبتی، تیم‌های ۵ نفره و ثبت مستقل نتیجه و رکوردها.</p>
    </header>
    {!token && <p>{initData ? "در حال احراز هویت…" : "این بخش را از داخل تلگرام باز کن تا احراز هویت انجام شود."}</p>}
    {token && !challenge && <section style={panel}>
      <h2>ساخت دعوت درفت</h2>
      <label>شناسه عددی تلگرام حریف</label>
      <input value={telegramId} onChange={(e) => setTelegramId(e.target.value)} inputMode="numeric" placeholder="مثلاً 123456789" style={field}/>
      <button disabled={busy} onClick={() => void run(createDraft)} style={button}>ساخت دعوت</button>
      <hr/>
      <label>یا شناسهٔ درفت دریافتی را وارد کن</label>
      <input value={draftId} onChange={(e) => setDraftId(e.target.value)} placeholder="شناسه درفت" style={field}/>
      <button disabled={busy || !draftId} onClick={() => void run(() => load(draftId))} style={button}>بازکردن درفت</button>
    </section>}
    {challenge && <section style={panel}>
      <h2>وضعیت: {challenge.status}</h2>
      <p>شناسه: <code>{challenge.id}</code></p>
      <p>نوبت انتخاب: {challenge.current_pick_number} از ۱۰ · نسخه {challenge.version}</p>
      {challenge.status === "INVITED" && <button disabled={busy} style={button} onClick={() => void run(acceptDraft)}>پذیرش دعوت</button>}
      {challenge.status === "DRAFTING" && <div>
        <h3>بازیکنان قابل انتخاب</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8 }}>
          {challenge.player_pool.filter((player) => !selectedIds.has(player.id)).map((player) =>
            <button key={player.id} disabled={busy || !myTurn} onClick={() => void run(() => pickPlayer(player.id))} style={playerButton}>
              <strong>{player.name}</strong><span>{player.line} · OVR {player.overall}</span>
            </button>)}
        </div>
        {!myTurn && <p>در انتظار انتخاب حریف…</p>}
      </div>}
      {picks.length > 0 && <div><h3>انتخاب‌ها</h3>{picks.map((pick) =>
        <p key={pick.pick_number}>{pick.pick_number}. {pick.player_snapshot.name} — {pick.user_id === challenge.creator_user_id ? "بازیکن اول" : "بازیکن دوم"}</p>)}</div>}
      {challenge.status === "LINEUP" && <div>
        <h3>ثبت آرایش</h3>
        <select value={formation} onChange={(e) => setFormation(e.target.value)} style={field}>{formations.map((f) => <option key={f}>{f}</option>)}</select>
        <button disabled={busy} onClick={() => void run(saveFormation)} style={button}>ثبت آرایش من</button>
        {challenge.creator_formation && challenge.opponent_formation && <button disabled={busy} onClick={() => void run(play)} style={button}>اجرای مسابقه و ثبت نتیجه</button>}
      </div>}
      {challenge.status === "COMPLETED" && <div><h3>نتیجه نهایی</h3><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(challenge.match_result ?? {}, null, 2)}</pre><p>شناسه مسابقه: {challenge.match_id}</p></div>}
      <button disabled={busy} style={button} onClick={() => void run(() => load(challenge.id))}>به‌روزرسانی وضعیت</button>
    </section>}
    {records && <section style={panel}><h2>رکوردها</h2><p>بازی {records.matches} · برد {records.wins} · مساوی {records.draws} · باخت {records.losses}</p></section>}
    {error && <p role="alert" style={{ color: "#ff8b8b" }}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </main>;
}

const panel: React.CSSProperties = { border: "1px solid #374151", borderRadius: 14, padding: 16, marginBottom: 16, background: "rgba(15,23,42,.7)" };
const field: React.CSSProperties = { display: "block", width: "100%", padding: 12, margin: "8px 0 12px", borderRadius: 8, border: "1px solid #64748b", background: "#111827", color: "white" };
const button: React.CSSProperties = { padding: "10px 14px", borderRadius: 8, border: 0, margin: "4px", cursor: "pointer" };
const playerButton: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, padding: 12, textAlign: "right", borderRadius: 8, border: "1px solid #64748b", background: "#1f2937", color: "white", cursor: "pointer" };
