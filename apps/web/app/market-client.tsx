"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Player = { id: string; firstName: string; lastName: string; nationality: string; age: number; position: string; overall: number; potential: number; wage: string; attributes?: Record<string, number>; status?: string; fitness?: number; morale?: number; contractDays?: number; injuryUntil?: string | null; minimumWeeklyWage?: string; maximumWeeklyWage?: string; trainingFocus?: string; lineupSlot?: number | null };
type Listing = { id: string; askingPrice: string; status?: string; expiresAt: string; createdAt: string; player: Player; sellerClub?: { name: string } };
type SpecialPlayer = { id: string; fullName: string; nationality: string; positions: string[]; rarity: string; overall: number; potential: number; acquisitionMethods: string[] };
type PackOffer = { method: "epic_pack" | "legendary_pack" | "icon_pack"; rarity: string; priceGold: string };
type FinanceSummary = { periodDays: number; income: string; expenses: string; net: string; operatingArrears: string; entries: Array<{ id: string; category: string; direction: string; amount: string; description: string; occurredAt: string }> };
type ClubOperations = {
  stadiumLevel: number; stadiumCapacity: number; ticketPrice: string; trainingGroundLevel: number; academyLevel: number;
  dailyMaintenance: string; operatingArrears: string; cashBalance: string;
  nextUpgradeCosts: { stadium: string | null; trainingGround: string | null; academy: string | null };
  scoutingCost: string | null; coachUpgradeCost: string | null;
  coach: { name: string; level: number; trainingSkill: number; recoverySkill: number; medicalSkill: number; weeklySalary: string } | null;
  activeSponsor: { partnerName: string; tier: string; dailyIncome: string; endsAt: string } | null;
  sponsorOffers: Array<{ id: string; partnerName: string; tier: string; dailyIncome: string; signingBonus: string; durationDays: number }>;
  coachOffers: Array<{ id: string; name: string; signingFee: string; weeklySalary: string; trainingSkill: number; recoverySkill: number; medicalSkill: number }>;
  prospects: Array<{ id: string; firstName: string; lastName: string; age: number; position: string; overall: number; potential: number; recruitmentCost: string }>;
  financeEntries: Array<{ id: string; category: string; direction: string; amount: string; description: string; occurredAt: string }>;
};
type MatchRecord = {
  id: string; type: string; status: string; scheduledAt: string;
  homeClub: { id: string; name: string }; awayClub: { id: string; name: string };
  homeScore: number | null; awayScore: number | null; attendance: number; ticketRevenue: string;
  events: Array<{ minute: number; type: string; detail: string; playerId: string }>;
};
type OpenLeague = { id: string; name: string; season: number; status: string; maxTeams: number; teams: number; joined: boolean; isCreator: boolean; creator: string };
type ClubCompetition = { id: string; name: string; season: number; status: string };
type LeagueDetails = {
  competition: { id: string; name: string; season: number; status: string; startsAt: string | null };
  standings: Array<{ position: number; clubId: string; clubName: string; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; goalDifference: number; points: number }>;
  matches: Array<{ id: string; round: number | null; scheduledAt: string; status: string; homeClub: { id: string; name: string }; awayClub: { id: string; name: string }; homeScore: number | null; awayScore: number | null }>;
};
type Lineup = {
  formation: string;
  tactics: { mentality: string; pressing: string; tempo: string; passingStyle: string };
  lineupVersion: number;
  players: Array<{ id: string; firstName: string; lastName: string; position: string; overall: number; lineupSlot: number }>;
};
const formationOptions = ["4-3-3", "4-4-2", "3-5-2", "4-2-3-1"];
declare global { interface Window { Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } } } }

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const money = (value: string | number) => new Intl.NumberFormat("en-US").format(Number(value));
const rarityLabel: Record<string, string> = { ICON: "Icon", LEGENDARY: "Legendary", EPIC: "Epic", RARE: "Rare" };
const financeCategoryLabel: Record<string, string> = {
  PLAYER_TRAINING: "تمرین بازیکن",
  PLAYER_MARKET_PURCHASE: "خرید بازیکن",
  PLAYER_MARKET_SALE: "فروش بازیکن",
  SPONSOR_SIGNING_BONUS: "پاداش امضای اسپانسر",
  SPONSOR_INCOME: "درآمد اسپانسر",
  FACILITY_MAINTENANCE: "نگهداری امکانات",
  FACILITY_UPGRADE: "ارتقای امکانات",
  ACADEMY_SCOUTING: "استعدادیابی",
  ACADEMY_RECRUITMENT: "جذب استعداد",
  COACH_SIGNING: "استخدام مربی",
  COACH_DEVELOPMENT: "ارتقای مربی",
  PLAYER_AND_COACH_PAYROLL: "پرداخت حقوق",
};

export default function MarketPage() {
  const [initData, setInitData] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [mine, setMine] = useState<Listing[]>([]);
  const [special, setSpecial] = useState<SpecialPlayer[]>([]);
  const [cash, setCash] = useState("0");
  const [gold, setGold] = useState("0");
  const [packOffers, setPackOffers] = useState<PackOffer[]>([]);
  const [lineup, setLineup] = useState<Lineup | null>(null);\n  const [matches, setMatches] = useState<MatchRecord[]>([]);\n  const [opponents, setOpponents] = useState<Array<{ id: string; name: string; level: number; reputation: number }>>([]);\n  const [openLeagues, setOpenLeagues] = useState<OpenLeague[]>([]);\n  const [clubCompetitions, setClubCompetitions] = useState<ClubCompetition[]>([]);\n  const [leagueDetail, setLeagueDetail] = useState<LeagueDetails | null>(null);\n  const [leagueName, setLeagueName] = useState("");\n  const [leagueCapacity, setLeagueCapacity] = useState("8");
  const [coach, setCoach] = useState<{ name: string; level: number; trainingSkill: number; recoverySkill: number; medicalSkill: number; weeklySalary: string } | null>(null);
  const [trainingGroundLevel, setTrainingGroundLevel] = useState(1);
  const [weeklyWageBill, setWeeklyWageBill] = useState("0");
  const [wageArrears, setWageArrears] = useState("0");
  const [operations, setOperations] = useState<ClubOperations | null>(null);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);
  const [ticketPriceInput, setTicketPriceInput] = useState("50");
  const [recentPayrolls, setRecentPayrolls] = useState<Array<{ payrollDate: string; totalDue: string; cashPaid: string; arrearsAfter: string }>>([]);
  const [recentTraining, setRecentTraining] = useState<Array<{ id: string; playerId: string; focus: string; intensity: string; overallBefore: number; overallAfter: number; injuryOccurred: boolean; createdAt: string }>>([]);
  const [developmentPlayerId, setDevelopmentPlayerId] = useState("");
  const [trainingFocus, setTrainingFocus] = useState("BALANCED");
  const [trainingIntensity, setTrainingIntensity] = useState("NORMAL");
  const [contractLength, setContractLength] = useState("180");
  const [contractWage, setContractWage] = useState("");
  const [formation, setFormation] = useState("4-3-3");
  const [selectedLineupIds, setSelectedLineupIds] = useState<string[]>([]);
  const [tactics, setTactics] = useState({ mentality: "BALANCED", pressing: "MID_BLOCK", tempo: "NORMAL", passingStyle: "MIXED" });
  const [packKeys, setPackKeys] = useState<Record<string, string>>({});
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [price, setPrice] = useState("1000");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"market" | "club" | "operations" | "lineup" | "development" | "matches" | "special">("market");

  const headers = useMemo(() => ({ "content-type": "application/json", "x-telegram-init-data": initData }), [initData]);

  const load = useCallback(async () => {
    if (!initData) return;
    const authResponse = await fetch(API + "/v1/auth/telegram", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    if (!authResponse.ok) {
      const authError = await authResponse.json().catch(() => ({}));
      throw new Error(authError.error ?? "احراز هویت تلگرام ناموفق بود.");
    }
    const requests = await Promise.all([
      fetch(API + "/v1/club/players", { headers }),
      fetch(API + "/v1/wallet", { headers }),
      fetch(API + "/v1/market/listings", { headers }),
      fetch(API + "/v1/market/my-listings", { headers }),
      fetch(API + "/v1/players/special", { headers }),
      fetch(API + "/v1/club/lineup", { headers }),
      fetch(API + "/v1/club/development", { headers }),
      fetch(API + "/v1/club/operations", { headers }),
      fetch(API + "/v1/matches", { headers }),
      fetch(API + "/v1/matches/opponents", { headers }),
      fetch(API + "/v1/competitions", { headers }),
    ]);
    const [p, w, m, own, s, l, d, o, matchResponse, opponentResponse, leagueResponse] = requests;
    if (p.ok) setPlayers((await p.json()).players);
    if (o.ok) { const clubOperations = (await o.json()).club as ClubOperations; setOperations(clubOperations); setTicketPriceInput(clubOperations.ticketPrice); }
    if (matchResponse.ok) { const data = await matchResponse.json(); setMatches(data.matches ?? []); setClubCompetitions(data.competitions ?? []); }
    if (opponentResponse.ok) setOpponents((await opponentResponse.json()).opponents ?? []);
    if (leagueResponse.ok) setOpenLeagues((await leagueResponse.json()).competitions ?? []);
    const financeResponse = await fetch(API + "/v1/club/finance?days=30", { headers });
    if (financeResponse.ok) setFinanceSummary(await financeResponse.json());
    if (d.ok) {
      const development = (await d.json()).club;
      setPlayers(development.players);
      setCoach(development.coach);
      setTrainingGroundLevel(development.trainingGroundLevel);
      setWeeklyWageBill(development.weeklyWageBill);
      setWageArrears(development.wageArrears);
      setRecentPayrolls(development.recentPayrolls ?? []);
      setRecentTraining(development.recentTraining ?? []);
      setDevelopmentPlayerId((current) => development.players.some((player: Player) => player.id === current) ? current : (development.players.find((player: Player) => player.status === "ACTIVE")?.id ?? development.players[0]?.id ?? ""));
      const chosen = development.players.find((player: Player) => player.status === "ACTIVE") ?? development.players[0];
      if (chosen?.minimumWeeklyWage) setContractWage((current) => current || chosen.minimumWeeklyWage);
    }
    if (w.ok) { const data = await w.json(); setCash(data.wallets.find((x: { asset: string }) => x.asset === "CASH")?.balance ?? "0"); setGold(data.wallets.find((x: { asset: string }) => x.asset === "GOLD")?.balance ?? "0"); }
    if (m.ok) setListings((await m.json()).listings);
    if (own.ok) setMine((await own.json()).listings);
    if (s.ok) { const data = await s.json(); setSpecial(data.players); setPackOffers(data.packOffers ?? []); }
    if (l.ok) {
      const data = await l.json();
      const currentLineup: Lineup = data.club;
      setLineup(currentLineup);
      setFormation(currentLineup.formation);
      setTactics(currentLineup.tactics);
      setSelectedLineupIds([...currentLineup.players].sort((a, b) => a.lineupSlot - b.lineupSlot).map((player) => player.id));
    }
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
      if (!response.ok) { const detail = data.details?.minimumWeeklyWage ? ` (حداقل ${money(data.details.minimumWeeklyWage)} و حداکثر ${money(data.details.maximumWeeklyWage)} Cash در هفته)` : ""; throw new Error((data.error ?? "درخواست ناموفق بود") + detail); }
      setMessage(data.training ? `تمرین انجام شد: OVR ${data.training.overallBefore} ← ${data.training.overallAfter}، آمادگی ${data.training.fitnessBefore} ← ${data.training.fitnessAfter}، هزینه ${money(data.training.cashCost)} Cash.${data.training.injuryOccurred ? " بازیکن مصدوم شد و نیاز به استراحت دارد." : ""}` : data.contract ? `قرارداد تمدید شد؛ ${data.contract.contractDays} روز باقی‌مانده و دستمزد هفتگی ${money(data.contract.weeklyWage)} Cash.` : data.acquisition?.specialPlayer?.fullName ? `بازیکن ویژه ${data.acquisition.specialPlayer.fullName} به باشگاه شما اضافه شد.` : "عملیات با موفقیت انجام شد.");
      await load();
      if (data.acquisition?.specialPlayer?.fullName) setPackKeys((current) => { const next = { ...current }; delete next[data.acquisition.method ?? ""]; return next; });
    } catch (e) { setError(e instanceof Error ? e.message : "خطای نامشخص"); }
    finally { setBusy(""); }
  }

  if (!initData) return <main className="market-shell"><section className="market-card"><p className="market-kicker">FOOTBALL EMPIRE</p><h1>بازار نقل‌وانتقالات</h1><p>برای استفاده از بازار، بازی را از طریق ربات تلگرام و Mini App باز کنید.</p></section></main>;

  return <main className="market-shell">
    <header className="market-header"><div><p className="market-kicker">FOOTBALL EMPIRE</p><h1>بازار نقل‌وانتقالات</h1><p>خریدوفروش بازیکنان و بررسی ستاره‌های ویژه</p></div><div className="cash-box"><span>موجودی نقدی</span><strong>{money(cash)} <small>Cash</small></strong><span>طلای شما</span><strong>{money(gold)} <small>Gold</small></strong></div></header>
    <nav className="market-tabs">
      <button className={tab === "market" ? "active" : ""} onClick={() => setTab("market")}>بازار بازیکنان</button>
      <button className={tab === "club" ? "active" : ""} onClick={() => setTab("club")}>بازار باشگاه</button>
      <button className={tab === "operations" ? "active" : ""} onClick={() => setTab("operations")}>امکانات و اقتصاد</button>
      <button className={tab === "lineup" ? "active" : ""} onClick={() => setTab("lineup")}>ترکیب</button>
      <button className={tab === "development" ? "active" : ""} onClick={() => setTab("development")}>توسعه بازیکن</button>\n      <button className={tab === "matches" ? "active" : ""} onClick={() => setTab("matches")}>مسابقات و لیگ</button>
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
        <label>انتخاب بازیکن<select value={selectedPlayer} onChange={(e) => setSelectedPlayer(e.target.value)}><option value="">انتخاب کنید</option>{players.filter((p) => p.status === "ACTIVE").map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} · {p.position} · OVR {p.overall}</option>)}</select></label>
        <label>قیمت پیشنهادی (Cash)<input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))}/></label>
        <button disabled={!selectedPlayer || !price || busy === "sell"} onClick={() => void action("sell", "/v1/market/listings", "POST", { playerId: selectedPlayer, askingPrice: price, expiresInHours: 72 })}>{busy === "sell" ? "در حال ثبت…" : "ثبت آگهی فروش"}</button>
      </div>
      <div className="market-card"><h2>آگهی‌های من</h2>{mine.length === 0 ? <p className="muted">هنوز آگهی ثبت نکرده‌اید.</p> : mine.map((item) => <div className="my-listing" key={item.id}><div><strong>{item.player.firstName} {item.player.lastName}</strong><p>{money(item.askingPrice)} Cash · {item.status}</p></div>{item.status === "OPEN" && <button className="secondary" disabled={busy === item.id} onClick={() => void action(item.id, "/v1/market/listings/" + item.id, "DELETE")}>لغو آگهی</button>}</div>)}</div>
    </section>}

    {tab === "operations" && operations && <section className="operations-grid">
      <div className="market-card">
        <h2>امکانات باشگاه</h2>
        <p>ارتقای امکانات ظرفیت و توان توسعه باشگاه را افزایش می‌دهد؛ هزینه نگهداری روزانه نیز با هر ارتقا بیشتر می‌شود.</p>
        <div className="operation-stat"><span>ورزشگاه · سطح {operations.stadiumLevel}</span><strong>{money(operations.stadiumCapacity)} صندلی</strong>
          <button disabled={!operations.nextUpgradeCosts.stadium || !!busy} onClick={() => void action("upgrade-stadium", "/v1/club/facilities/STADIUM/upgrade", "POST", { idempotencyKey: `mini-stadium-${crypto.randomUUID()}` })}>{operations.nextUpgradeCosts.stadium ? `ارتقا · ${money(operations.nextUpgradeCosts.stadium)} Cash` : "حداکثر سطح"}</button>
        </div>
        <div className="ticket-price-setting">
          <label>قیمت بلیت هر تماشاگر (۱۰ تا ۵۰۰ Cash)
            <input inputMode="numeric" value={ticketPriceInput} onChange={(event) => setTicketPriceInput(event.target.value.replace(/[^0-9]/g, ""))}/>
          </label>
          <button className="secondary" disabled={!!busy || !ticketPriceInput || ticketPriceInput === operations.ticketPrice || Number(ticketPriceInput) < 10 || Number(ticketPriceInput) > 500} onClick={() => void action("ticket-price", "/v1/club/stadium/ticket-price", "PATCH", { ticketPrice: ticketPriceInput, expectedTicketPrice: operations.ticketPrice })}>ذخیره قیمت بلیت</button>
          <p className="muted">درآمد بلیت پس از اتصال برنامه مسابقات به ورزشگاه و ثبت نتیجه بازی محاسبه می‌شود.</p>
        </div>
        <div className="operation-stat"><span>زمین تمرین · سطح {operations.trainingGroundLevel}</span><strong>تأثیر بر رشد بازیکنان</strong>
          <button disabled={!operations.nextUpgradeCosts.trainingGround || !!busy} onClick={() => void action("upgrade-training-ground", "/v1/club/facilities/TRAINING_GROUND/upgrade", "POST", { idempotencyKey: `mini-training-${crypto.randomUUID()}` })}>{operations.nextUpgradeCosts.trainingGround ? `ارتقا · ${money(operations.nextUpgradeCosts.trainingGround)} Cash` : "حداکثر سطح"}</button>
        </div>
        <div className="operation-stat"><span>آکادمی · سطح {operations.academyLevel}</span><strong>کشف و پرورش استعداد</strong>
          <button disabled={!operations.nextUpgradeCosts.academy || !!busy} onClick={() => void action("upgrade-academy", "/v1/club/facilities/ACADEMY/upgrade", "POST", { idempotencyKey: `mini-academy-${crypto.randomUUID()}` })}>{operations.nextUpgradeCosts.academy ? `ارتقا · ${money(operations.nextUpgradeCosts.academy)} Cash` : "حداکثر سطح"}</button>
        </div>
        <p className="muted">هزینه نگهداری روزانه: {money(operations.dailyMaintenance)} Cash · معوقات عملیاتی: {money(operations.operatingArrears)} Cash</p>
      </div>
      <div className="market-card">
        <h2>مربی و کادر فنی</h2>
        {operations.coach ? <><p><strong>{operations.coach.name}</strong> · سطح {operations.coach.level}</p>
          <div className="operation-skills"><span>تمرین {operations.coach.trainingSkill}</span><span>بازیابی {operations.coach.recoverySkill}</span><span>پزشکی {operations.coach.medicalSkill}</span></div>
          <p className="muted">حقوق هفتگی {money(operations.coach.weeklySalary)} Cash</p>
          <button disabled={!operations.coachUpgradeCost || !!busy} onClick={() => void action("upgrade-coach", "/v1/club/coach/upgrade", "POST", { idempotencyKey: `mini-coach-upgrade-${crypto.randomUUID()}` })}>{operations.coachUpgradeCost ? `ارتقای مربی · ${money(operations.coachUpgradeCost)} Cash` : "حداکثر سطح مربی"}</button>
        </> : <p>مربی برای باشگاه ثبت نشده است.</p>}
        <h3>گزینه‌های استخدام</h3>
        {operations.coachOffers.map((candidate) => <div className="operation-row" key={candidate.id}>
          <div><strong>{candidate.name}</strong><small>تمرین {candidate.trainingSkill} · بازیابی {candidate.recoverySkill} · پزشکی {candidate.medicalSkill}</small><small>هزینه استخدام {money(candidate.signingFee)} · حقوق هفتگی {money(candidate.weeklySalary)} Cash</small></div>
          <button className="secondary" disabled={!!busy} onClick={() => void action("hire-coach", "/v1/club/coach/hire", "POST", { candidateId: candidate.id, idempotencyKey: `mini-coach-hire-${crypto.randomUUID()}` })}>استخدام</button>
        </div>)}
      </div>
      <div className="market-card">
        <h2>آکادمی جوانان</h2>
        <p>استعدادهای ۱۶ تا ۱۸ ساله را کشف کنید. سطح بالاتر آکادمی امکان جذب استعدادهای قوی‌تر را فراهم می‌کند.</p>
        <button disabled={!operations.scoutingCost || !!busy} onClick={() => void action("scout-academy", "/v1/club/academy/scout", "POST", { idempotencyKey: `mini-scout-${crypto.randomUUID()}` })}>{operations.scoutingCost ? `استعدادیابی سه بازیکن · ${money(operations.scoutingCost)} Cash` : "ابتدا آکادمی را ارتقا دهید"}</button>
        {operations.prospects.map((prospect) => <div className="operation-row" key={prospect.id}>
          <div><strong>{prospect.firstName} {prospect.lastName}</strong><small>{prospect.age} سال · {prospect.position} · OVR {prospect.overall} · POT {prospect.potential}</small><small>هزینه جذب {money(prospect.recruitmentCost)} Cash</small></div>
          <button className="secondary" disabled={!!busy} onClick={() => void action("recruit-" + prospect.id, `/v1/club/academy/${prospect.id}/recruit`, "POST", { idempotencyKey: `mini-recruit-${prospect.id}-${crypto.randomUUID()}` })}>جذب</button>
        </div>)}
        {operations.academyLevel > 0 && operations.prospects.length === 0 && <p className="muted">استعداد فعالی در فهرست آکادمی نیست؛ استعدادیابی جدید انجام دهید.</p>}
      </div>
      <div className="market-card">
        <h2>قرارداد اسپانسرینگ</h2>
        {operations.activeSponsor ? <><p><strong>{operations.activeSponsor.partnerName}</strong> · {operations.activeSponsor.tier}</p><p>درآمد روزانه {money(operations.activeSponsor.dailyIncome)} Cash · پایان قرارداد {new Date(operations.activeSponsor.endsAt).toLocaleDateString("fa-IR")}</p></>
          : <><p>یک حامی مالی انتخاب کنید تا درآمد روزانه و پاداش امضای قرارداد دریافت کنید.</p>
            {operations.sponsorOffers.map((offer) => <div className="operation-row" key={offer.id}>
              <div><strong>{offer.partnerName} · {offer.tier}</strong><small>{money(offer.dailyIncome)} Cash روزانه · پاداش {money(offer.signingBonus)} Cash · {offer.durationDays} روز</small></div>
              <button className="secondary" disabled={!!busy} onClick={() => void action("sponsor-" + offer.id, "/v1/club/sponsors/sign", "POST", { offerId: offer.id, idempotencyKey: `mini-sponsor-${offer.id}-${crypto.randomUUID()}` })}>امضای قرارداد</button>
            </div>)}
          </>}
      </div>
      <div className="market-card">
        <h2>صورت‌حساب مالی · ۳۰ روز اخیر</h2>
        {financeSummary && <div className="finance-summary"><div><span>درآمد</span><strong>{money(financeSummary.income)} Cash</strong></div><div><span>هزینه پرداخت‌شده</span><strong>{money(financeSummary.expenses)} Cash</strong></div><div><span>خالص</span><strong className={Number(financeSummary.net) >= 0 ? "finance-credit" : "finance-debit"}>{money(financeSummary.net)} Cash</strong></div></div>}
        {!(financeSummary?.entries.length ?? operations.financeEntries.length) ? <p className="muted">هنوز گردش مالی عملیاتی ثبت نشده است.</p> : (financeSummary?.entries ?? operations.financeEntries).map((entry) => <div className="operation-row" key={entry.id}>
          <div><strong>{entry.description}</strong><small>{new Date(entry.occurredAt).toLocaleDateString("fa-IR")} · {financeCategoryLabel[entry.category] ?? entry.category}</small></div>
          <strong className={entry.direction === "CREDIT" ? "finance-credit" : "finance-debit"}>{entry.direction === "CREDIT" ? "+" : "−"}{money(entry.amount)} Cash</strong>
        </div>)}
      </div>
    </section>}
    {tab === "lineup" && <section className="club-market">
      <div className="market-card">
        <h2>ترکیب اصلی و تاکتیک‌ها</h2>
        <p>۱۱ بازیکن اصلی را به ترتیب جایگاه انتخاب کنید. سرور مالکیت بازیکنان، پست و اعتبار نسخه ترکیب را بررسی می‌کند.</p>
        <label>آرایش تیم
          <select value={formation} onChange={(e) => setFormation(e.target.value)}>
            {formationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <div className="lineup-grid">
          {Array.from({ length: 11 }, (_, index) => {
            const currentId = selectedLineupIds[index] ?? "";
            const usedElsewhere = new Set(selectedLineupIds.filter((id, slot) => slot !== index));
            return <label key={index}>جایگاه {index + 1}
              <select value={currentId} onChange={(e) => setSelectedLineupIds((current) => {
                const next = [...current];
                next[index] = e.target.value;
                return next;
              })}>
                <option value="">انتخاب بازیکن</option>
                {players.filter((player) => player.status === "ACTIVE" && !usedElsewhere.has(player.id)).map((player) => (
                  <option key={player.id} value={player.id}>{player.firstName} {player.lastName} · {player.position} · OVR {player.overall}</option>
                ))}
              </select>
            </label>;
          })}
        </div>
        <h3>دستورهای تاکتیکی</h3>
        <div className="lineup-grid">
          <label>ذهنیت
            <select value={tactics.mentality} onChange={(e) => setTactics((current) => ({ ...current, mentality: e.target.value }))}>
              <option value="DEFENSIVE">دفاعی</option><option value="BALANCED">متعادل</option><option value="ATTACKING">هجومی</option>
            </select>
          </label>
          <label>فشار
            <select value={tactics.pressing} onChange={(e) => setTactics((current) => ({ ...current, pressing: e.target.value }))}>
              <option value="LOW_BLOCK">بلوک پایین</option><option value="MID_BLOCK">بلوک میانی</option><option value="HIGH_PRESS">پرس شدید</option>
            </select>
          </label>
          <label>سرعت بازی
            <select value={tactics.tempo} onChange={(e) => setTactics((current) => ({ ...current, tempo: e.target.value }))}>
              <option value="SLOW">آرام</option><option value="NORMAL">معمولی</option><option value="FAST">سریع</option>
            </select>
          </label>
          <label>سبک پاس
            <select value={tactics.passingStyle} onChange={(e) => setTactics((current) => ({ ...current, passingStyle: e.target.value }))}>
              <option value="SHORT">کوتاه</option><option value="MIXED">ترکیبی</option><option value="DIRECT">مستقیم</option>
            </select>
          </label>
        </div>
        <button disabled={busy === "lineup" || selectedLineupIds.length !== 11 || selectedLineupIds.some((id) => !id)} onClick={() => void action("lineup", "/v1/club/lineup", "PUT", { formation, playerIds: selectedLineupIds, expectedVersion: lineup?.lineupVersion ?? 0, tactics })}>
          {busy === "lineup" ? "در حال ذخیره…" : "ذخیره ترکیب و تاکتیک‌ها"}
        </button>
        <p className="muted">نسخه فعلی ترکیب: {lineup?.lineupVersion ?? 0} · پس از هر ذخیره موفق، نسخه افزایش می‌یابد.</p>
      </div>
    </section>}
    {tab === "development" && <section className="development-layout">
      <div className="market-card">
        <h2>مرکز تمرین و توسعه بازیکنان</h2>
        <p>تمرین روزانه، رشد مهارت‌ها و مدیریت آمادگی جسمانی بازیکنان. هر بازیکن فقط یک جلسه در روز می‌تواند تمرین کند.</p>
        {coach && <div className="coach-panel">
          <strong>{coach.name} · سطح {coach.level}</strong>
          <span>مهارت تمرین {coach.trainingSkill} · بازیابی {coach.recoverySkill} · پزشکی {coach.medicalSkill}</span>
          <small>زمین تمرین سطح {trainingGroundLevel} · دستمزد مربی {money(coach.weeklySalary)} Cash در هفته</small>
          <small>کل حقوق هفتگی: {money(weeklyWageBill)} Cash · معوقات حقوق: {money(wageArrears)} Cash</small>
        </div>}
        <label>بازیکن
          <select value={developmentPlayerId} onChange={(e) => {
            const id = e.target.value;
            setDevelopmentPlayerId(id);
            const player = players.find((item) => item.id === id);
            if (player?.trainingFocus) setTrainingFocus(player.trainingFocus);
            if (player?.minimumWeeklyWage) setContractWage(player.minimumWeeklyWage);
            if (player?.position !== "GK" && trainingFocus === "GOALKEEPING") setTrainingFocus("BALANCED");
            if (player?.trainingFocus) setTrainingFocus(player.trainingFocus);
          }}>
            <option value="">انتخاب بازیکن</option>
            {players.map((player) => <option key={player.id} value={player.id}>{player.firstName} {player.lastName} · {player.position} · OVR {player.overall} · {player.status}</option>)}
          </select>
        </label>
        {(() => {
          const player = players.find((item) => item.id === developmentPlayerId);
          if (!player) return <p className="muted">بازیکنی برای مدیریت وجود ندارد.</p>;
          return <>
            <div className="development-stats">
              <div><span>قدرت</span><strong>{player.overall}/{player.potential}</strong></div>
              <div><span>آمادگی</span><strong>{player.fitness ?? 0}%</strong></div>
              <div><span>روحیه</span><strong>{player.morale ?? 0}%</strong></div>
              <div><span>قرارداد</span><strong>{player.contractDays ?? 0} روز</strong></div>
            </div>
            {player.status === "INJURED" && <p className="notice error">بازیکن مصدوم است و تا {player.injuryUntil ? new Date(player.injuryUntil).toLocaleDateString("fa-IR") : "پایان دوره درمان"} امکان تمرین ندارد.</p>}
            {player.status === "CONTRACT_EXPIRED" && <p className="notice error">قرارداد بازیکن تمام شده است؛ ابتدا قرارداد را تمدید کنید.</p>}
            <div className="attribute-grid">
              {[
                ["سرعت", "pace"], ["شوت", "shooting"], ["پاس", "passing"],
                ["دریبل", "dribbling"], ["دفاع", "defending"], ["قدرت بدنی", "physical"],
                ["دروازه‌بانی", "goalkeeping"],
              ].map(([label, key]) => <div key={key}><span>{label}</span><strong>{player.attributes?.[key] ?? "—"}</strong></div>)}
            </div>
            <h3>برنامه تمرینی</h3>
            <div className="lineup-grid">
              <label>تمرکز تمرین
                <select value={trainingFocus} onChange={(e) => setTrainingFocus(e.target.value)}>
                  <option value="BALANCED">متعادل</option>{player.position === "GK" && <option value="GOALKEEPING">دروازه‌بانی</option>}<option value="DEFENDING">دفاع</option><option value="PASSING">پاس</option><option value="PLAYMAKING">بازی‌سازی</option><option value="DRIBBLING">دریبل</option><option value="SHOOTING">شوت</option><option value="PHYSICAL">قدرت و سرعت</option>
                </select>
              </label>
              <label>شدت تمرین
                <select value={trainingIntensity} onChange={(e) => setTrainingIntensity(e.target.value)}>
                  <option value="LIGHT">سبک · {Math.round(20 * (1 + (trainingGroundLevel - 1) * 0.1))} Cash</option><option value="NORMAL">عادی · {Math.round(40 * (1 + (trainingGroundLevel - 1) * 0.1))} Cash</option><option value="INTENSE">سنگین · {Math.round(70 * (1 + (trainingGroundLevel - 1) * 0.1))} Cash</option>
                </select>
              </label>
            </div>
            <button disabled={busy === "training" || player.status !== "ACTIVE"} onClick={() => void action("training", `/v1/club/players/${player.id}/train`, "POST", { focus: trainingFocus, intensity: trainingIntensity, idempotencyKey: `mini-train-${player.id}-${new Date().toISOString().slice(0,10)}` })}>
              {busy === "training" ? "در حال تمرین…" : "اجرای تمرین امروز"}
            </button>
            <h3>تمدید قرارداد</h3>
            <div className="lineup-grid">
              <label>مدت تمدید
                <select value={contractLength} onChange={(e) => setContractLength(e.target.value)}>
                  <option value="90">۹۰ روز</option><option value="180">۱۸۰ روز</option><option value="365">۳۶۵ روز</option>
                </select>
              </label>
              <label>دستمزد هفتگی (Cash)
                <input inputMode="numeric" value={contractWage} onChange={(e) => setContractWage(e.target.value.replace(/[^0-9]/g, ""))}/>
              </label>
            </div>
            <p className="muted">محدوده دستمزد قابل قبول: {money(player.minimumWeeklyWage ?? player.wage)} تا {money(player.maximumWeeklyWage ?? player.wage)} Cash در هفته.</p>
            <button className="secondary" disabled={busy === "renew" || player.status === "RETIRED" || player.status === "LISTED" || !contractWage} onClick={() => void action("renew", `/v1/club/players/${player.id}/contract/renew`, "POST", { extensionDays: Number(contractLength), weeklyWage: contractWage, idempotencyKey: `mini-renew-${player.id}-${contractLength}-${contractWage}-${Date.now()}` })}>
              {busy === "renew" ? "در حال تمدید…" : "تمدید قرارداد بازیکن"}
            </button>
          </>;
        })()}
      </div>
      <div className="market-card">
        <h2>وضعیت تیم</h2>
        <p>بازیکنان مصدوم و قراردادهای منقضی‌شده در این فهرست باقی می‌مانند تا امکان مدیریت و تمدید آن‌ها را داشته باشید.</p>
        {recentPayrolls.length > 0 && <div className="payroll-history">
          <h3>آخرین پرداخت حقوق</h3>
          {recentPayrolls.map((payroll) => <div className="development-player-row" key={payroll.payrollDate}>
            <div><strong>{new Date(payroll.payrollDate).toLocaleDateString("fa-IR")}</strong><small>مطالبات {money(payroll.totalDue)} Cash</small></div>
            <div><strong>{money(payroll.cashPaid)} Cash</strong><small>معوقات {money(payroll.arrearsAfter)}</small></div>
          </div>)}
        </div>}
        {recentTraining.length > 0 && <div className="payroll-history">
          <h3>آخرین جلسات تمرین</h3>
          {recentTraining.map((log) => <div className="development-player-row" key={log.id}>
            <div><strong>{players.find((player) => player.id === log.playerId)?.firstName ?? "بازیکن"} · {log.focus}</strong><small>{new Date(log.createdAt).toLocaleDateString("fa-IR")} · {log.intensity}</small></div>
            <div><strong>{log.overallBefore} ← {log.overallAfter}</strong><small>{log.injuryOccurred ? "مصدومیت در تمرین" : "بدون مصدومیت"}</small></div>
          </div>)}
        </div>}
        {players.map((player) => <div className="development-player-row" key={player.id}>
          <div><strong>{player.firstName} {player.lastName}</strong><small>{player.position} · OVR {player.overall} · POT {player.potential}</small></div>
          <div><strong>{player.fitness ?? 0}%</strong><small>{player.status === "ACTIVE" ? "آماده" : player.status === "INJURED" ? "مصدوم" : player.status === "LISTED" ? "در بازار" : "قرارداد تمام‌شده"}</small></div>
        </div>)}
      </div>
    </section>}
    {tab === "special" && <><section className="special-packs"><div className="market-card"><h2>جذب ستاره‌های ویژه</h2><p>هر بسته یک بازیکن تصادفی از رده مشخص‌شده می‌دهد. هر بازیکن ویژه را فقط یک‌بار می‌توانید در باشگاه خود داشته باشید.</p><div className="pack-actions">{packOffers.map((offer) => <button key={offer.method} disabled={!!busy || Number(gold) < Number(offer.priceGold)} onClick={() => { const key = packKeys[offer.method] ?? crypto.randomUUID(); if (!packKeys[offer.method]) setPackKeys((current) => ({ ...current, [offer.method]: key })); void action("pack-" + offer.method, "/v1/players/special/acquire", "POST", { method: offer.method, idempotencyKey: key }); }}>{busy === "pack-" + offer.method ? "در حال جذب…" : `${rarityLabel[offer.rarity] ?? offer.rarity} · ${money(offer.priceGold)} Gold`}</button>)}</div></div></section><section className="special-grid">{special.map((p) => <article className="special-card" key={p.id}><div className="special-top"><span>{rarityLabel[p.rarity] ?? p.rarity}</span><strong>{p.overall}</strong></div><h3>{p.fullName}</h3><p>{p.nationality} · {p.positions.join(" / ")}</p><div className="potential">Potential <strong>{p.potential}</strong></div><small>روش‌های جذب: {p.acquisitionMethods.join("، ")}</small></article>)}</section></>}
    <footer className="market-footer">بازیکنان ویژه در بازار عادی قابل معامله نیستند. خرید بازیکنان معمولی با Cash و بسته‌های جذب ستاره با Gold، به‌صورت امن در سرور ثبت می‌شوند.</footer>
  </main>;
}
