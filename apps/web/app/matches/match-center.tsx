"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createTelegramSession } from "../../lib/telegram-session";

type MatchEvent = { minute:number; type:string; detail:string; playerName:string; relatedPlayerName:string|null };
type Checkpoint = { checkpointKey:string; kind:string; minute:number; status:string; openedAt:string; decisionDeadlineAt:string; nextSegmentAt:string; resolvedAt:string|null; homeDecisionSubmitted:boolean; awayDecisionSubmitted:boolean };
type Match = {
 id:string; type:string; status:string; scheduledAt:string;
 homeClub:{id:string;name:string}; awayClub:{id:string;name:string};
 homeScore:number|null; awayScore:number|null; homePenalties:number|null; awayPenalties:number|null;
 runtime:{status:string;currentMinute:number;nextActionAt:string|null;completedAt:string|null;mySubstitutionsUsed:number;lineups:{home:{formation:string;tactics:{mentality:string;pressing:string;tempo:string;passingStyle:string};players:Array<{id:string;name:string;position:string;overall:number}>;bench:Array<{id:string;name:string;position:string;overall:number}>};away:{formation:string;tactics:{mentality:string;pressing:string;tempo:string;passingStyle:string};players:Array<{id:string;name:string;position:string;overall:number}>;bench:Array<{id:string;name:string;position:string;overall:number}>}}|null}|null;
 checkpoints:Checkpoint[]; events:MatchEvent[];
};
type Instruction = { formation:string; mentality:string; pressing:string; tempo:string; passingStyle:string; substitutions:Array<{outgoingPlayerId:string;incomingPlayerId:string}> };
const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000";
const labels:Record<string,string>={GOAL:"گل",YELLOW_CARD:"کارت زرد",RED_CARD:"کارت قرمز",INJURY:"مصدومیت",SUBSTITUTION:"تعویض"};
const matchStatusLabels:Record<string,string>={SCHEDULED:"برنامه‌ریزی‌شده",IN_PROGRESS:"در حال برگزاری",COMPLETED:"پایان‌یافته",CANCELLED:"لغوشده"};
const runtimeStatusLabels:Record<string,string>={QUEUED:"در صف اجرا",RUNNING:"در حال برگزاری",AWAITING_CHECKPOINT:"فرصت تصمیم تاکتیکی",COMPLETED:"پایان‌یافته"};
const matchTypeLabels:Record<string,string>={FRIENDLY:"دوستانه",LEAGUE:"لیگ",CUP:"جام حذفی"};
const mentalityLabels:Record<string,string>={DEFENSIVE:"دفاعی",BALANCED:"متعادل",ATTACKING:"هجومی"};
const pressingLabels:Record<string,string>={LOW_BLOCK:"دفاع فشرده",MID_BLOCK:"پرس میانه",HIGH_PRESS:"پرس از جلو"};
const tempoLabels:Record<string,string>={SLOW:"آرام",NORMAL:"معمولی",FAST:"سریع"};
const passingLabels:Record<string,string>={SHORT:"کوتاه",MIXED:"ترکیبی",DIRECT:"مستقیم"};
const selectStyle:CSSProperties={width:"100%",padding:"10px",borderRadius:9,border:"1px solid #30465e",background:"#0b1727",color:"#f4f7fb"};
const cardStyle:CSSProperties={border:"1px solid #263b52",background:"#111f32",borderRadius:16,padding:16,marginBottom:12};
const buttonStyle:CSSProperties={border:0,borderRadius:9,padding:"11px 15px",background:"#63d3a5",color:"#092018",fontWeight:800,cursor:"pointer"};

export default function MatchCenter(){
 const [initData,setInitData]=useState("");
 const [sessionToken,setSessionToken]=useState("");
 const [clubId,setClubId]=useState("");
 const [matches,setMatches]=useState<Match[]>([]);
 const [busy,setBusy]=useState("");
 const [notice,setNotice]=useState("");
 const [error,setError]=useState("");
 const [selected,setSelected]=useState("");
 const [formation,setFormation]=useState("4-3-3");
 const [mentality,setMentality]=useState("BALANCED");
 const [pressing,setPressing]=useState("MID_BLOCK");
 const [tempo,setTempo]=useState("NORMAL");
 const [passingStyle,setPassingStyle]=useState("MIXED");
 const [subs,setSubs]=useState<Array<{outgoingPlayerId:string;incomingPlayerId:string}>>([]);
 const headers=useMemo(()=>({"content-type":"application/json",...(sessionToken?{authorization:"Bearer "+sessionToken}:{})}),[sessionToken]);
 const load=useCallback(async()=>{
  if(!sessionToken)return;
  const [meResponse,matchResponse]=await Promise.all([
   fetch(API+"/v1/me",{headers}),fetch(API+"/v1/matches",{headers})
  ]);
  if(!meResponse.ok||!matchResponse.ok)throw new Error("دریافت اطلاعات مسابقات ناموفق بود.");
  const me=await meResponse.json();const matchData=await matchResponse.json();
  setClubId(me.club?.id??"");setMatches(matchData.matches??[]);
 },[headers,sessionToken]);
 useEffect(()=>{setInitData(window.Telegram?.WebApp?.initData??"");window.Telegram?.WebApp?.ready?.();window.Telegram?.WebApp?.expand?.();},[]);
 useEffect(()=>{if(!initData)return;let active=true;void createTelegramSession(API,initData).then(token=>{if(active)setSessionToken(token);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"احراز هویت ناموفق بود.");});return()=>{active=false;};},[initData]);
 useEffect(()=>{if(!sessionToken)return;let alive=true;const refresh=()=>load().catch(e=>{if(alive)setError(e instanceof Error?e.message:"خطای ارتباط");});void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>{alive=false;clearInterval(timer);};},[sessionToken,load]);
 const activeMatch=matches.find(m=>m.id===selected)??matches.find(m=>m.checkpoints.some(c=>c.status==="OPEN"))??matches[0];
 const openCheckpoint=activeMatch?.checkpoints.find(c=>c.status==="OPEN");
 const activeSide=activeMatch?.runtime?.lineups
  ? clubId===activeMatch.homeClub.id ? activeMatch.runtime.lineups.home
    : clubId===activeMatch.awayClub.id ? activeMatch.runtime.lineups.away : null
  : null;
 const starters=activeSide?.players??[];
 const bench=activeSide?.bench??[];
 const usedSubstitutions=activeMatch?.runtime?.mySubstitutionsUsed??0;
 const remainingSubstitutions=Math.max(0,5-usedSubstitutions);
 const activeMatchId=activeMatch?.id??"";
 const openCheckpointKey=openCheckpoint?.checkpointKey??"";
 const sideFormation=activeSide?.formation??"";
 const sideMentality=activeSide?.tactics.mentality??"";
 const sidePressing=activeSide?.tactics.pressing??"";
 const sideTempo=activeSide?.tactics.tempo??"";
 const sidePassingStyle=activeSide?.tactics.passingStyle??"";
 useEffect(()=>{
  if(!activeMatchId||!openCheckpointKey||!sideFormation)return;
  setFormation(sideFormation);setMentality(sideMentality);setPressing(sidePressing);
  setTempo(sideTempo);setPassingStyle(sidePassingStyle);setSubs([]);
 },[activeMatchId,openCheckpointKey,sideFormation,sideMentality,sidePressing,sideTempo,sidePassingStyle]);
 function addSub(){if(subs.length<remainingSubstitutions)setSubs(current=>[...current,{outgoingPlayerId:"",incomingPlayerId:""}]);}
 function updateSub(index:number,key:"outgoingPlayerId"|"incomingPlayerId",value:string){setSubs(current=>current.map((s,i)=>i===index?{...s,[key]:value}:s));}
 async function submitDecision(){
  if(!activeMatch||!openCheckpoint)return;
  if(subs.length>remainingSubstitutions)return setError("سقف پنج تعویض در کل مسابقه تکمیل شده است.");
  if(subs.some(s=>!s.outgoingPlayerId||!s.incomingPlayerId))return setError("برای هر تعویض، بازیکن خارج‌شونده و واردشونده را انتخاب کنید.");
  if(subs.some(s=>s.outgoingPlayerId===s.incomingPlayerId))return setError("بازیکن ورودی و خروجی نمی‌توانند یکسان باشند.");
  setBusy("decision");setError("");setNotice("");
  const instruction:Instruction={formation,mentality,pressing,tempo,passingStyle,substitutions:subs};
  try{
   const response=await fetch(API+"/v1/matches/"+encodeURIComponent(activeMatch.id)+"/checkpoints/"+encodeURIComponent(openCheckpoint.checkpointKey)+"/decisions",{
    method:"POST",headers,body:JSON.stringify({idempotencyKey:"mini-match-"+crypto.randomUUID(),instruction})
   });
   const data=await response.json();if(!response.ok)throw new Error(data.error??"ثبت تصمیم ناموفق بود.");
   setNotice("تصمیم تاکتیکی ثبت شد و برای ادامه مسابقه در نظر گرفته می‌شود.");setSubs([]);await load();
  }catch(e){setError(e instanceof Error?e.message:"خطای نامشخص");}finally{setBusy("");}
 }
 if(!initData)return <main style={{maxWidth:900,margin:"0 auto",padding:24,color:"#f4f7fb",direction:"rtl"}}><p>برای ورود به مرکز مسابقات، این صفحه را از داخل تلگرام باز کنید.</p><a href="/" style={{color:"#9ce8c5"}}>بازگشت به بازی</a></main>;
 return <main style={{maxWidth:980,minHeight:"100vh",margin:"0 auto",padding:"22px 14px 48px",color:"#f4f7fb",direction:"rtl",fontFamily:"Arial,Tahoma,sans-serif"}}>
  <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:20}}>
   <div><p style={{color:"#70d9ad",fontSize:11,fontWeight:800,letterSpacing:".12em",margin:0}}>FOOTBALL EMPIRE</p><h1 style={{fontSize:28,margin:"6px 0"}}>مرکز مسابقات</h1><p style={{color:"#9fb0c5",margin:0,fontSize:13}}>گزارش زنده، خط زمانی و تصمیم‌های تاکتیکی</p></div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a href="/matches/fallback" style={{color:"#9ce8c5",textDecoration:"none",border:"1px solid #36536b",borderRadius:9,padding:"9px 12px",whiteSpace:"nowrap"}}>برنامه جایگزین</a><a href="/" style={{color:"#9ce8c5",textDecoration:"none",border:"1px solid #36536b",borderRadius:9,padding:"9px 12px",whiteSpace:"nowrap"}}>بازگشت</a></div>
  </header>
  {notice&&<p style={{background:"#15362f",color:"#9ce8c5",padding:12,borderRadius:9}}>{notice}</p>}
  {error&&<p style={{background:"#3a2027",color:"#ffb6c0",padding:12,borderRadius:9}}>{error}</p>}
  {!matches.length&&<section style={cardStyle}>هنوز مسابقه‌ای برای باشگاه شما ثبت نشده است.</section>}
  {matches.length>0&&<div className="match-center-grid">
   <section><h2 style={{fontSize:17}}>مسابقات شما</h2>
    {matches.map(match=><button key={match.id} onClick={()=>setSelected(match.id)} style={{...cardStyle,width:"100%",textAlign:"right",color:"#f4f7fb",cursor:"pointer",borderColor:activeMatch?.id===match.id?"#63d3a5":"#263b52"}}>
     <strong>{match.homeClub.name} {match.homeScore??"–"} : {match.awayScore??"–"} {match.awayClub.name}</strong>
     <div style={{color:"#9fb0c5",fontSize:12,marginTop:7}}>{"دقیقه "+(match.runtime?.currentMinute??0)+" · "+(match.runtime?.status??match.status)} · {new Date(match.scheduledAt).toLocaleString("fa-IR")}</div>
     {match.checkpoints.some(c=>c.status==="OPEN")&&<small style={{display:"block",color:"#9ce8c5",marginTop:7}}>نیازمند تصمیم تاکتیکی</small>}
    </button>)}
   </section>
   {activeMatch&&<section>
    <article style={cardStyle}><div style={{color:"#9fb0c5",fontSize:12}}>{matchTypeLabels[activeMatch.type]??activeMatch.type} · {matchStatusLabels[activeMatch.status]??activeMatch.status}</div>
     <h2 style={{fontSize:22,margin:"8px 0"}}>{activeMatch.homeClub.name} {activeMatch.homeScore??"–"} : {activeMatch.awayScore??"–"} {activeMatch.awayClub.name}</h2>
     <div style={{display:"flex",justifyContent:"space-between",color:"#9ce8c5",fontSize:13}}><span>دقیقه {activeMatch.runtime?.currentMinute??0}</span><span>{activeMatch.runtime?.status??activeMatch.status}</span></div>
     <div style={{height:7,background:"#263b52",borderRadius:10,overflow:"hidden",marginTop:10}}><div style={{height:"100%",width:Math.min(100,(activeMatch.runtime?.currentMinute??0)/90*100)+"%",background:"#63d3a5"}}/></div>
    </article>
    {openCheckpoint&&<article style={cardStyle}><h2 style={{marginTop:0,fontSize:18}}>تصمیم تاکتیکی · دقیقه {openCheckpoint.minute}</h2>
     <p style={{color:"#9fb0c5",fontSize:13}}>مهلت پاسخ تا {new Date(openCheckpoint.decisionDeadlineAt).toLocaleTimeString("fa-IR")}؛ در صورت بی‌پاسخی، برنامه ذخیره‌شده یا تاکتیک پیش‌فرض اعمال می‌شود و مسابقه خودکار ادامه می‌یابد. {clubId===activeMatch.homeClub.id?(openCheckpoint.homeDecisionSubmitted?"تصمیم شما ثبت شده":"تصمیم شما هنوز ثبت نشده"):clubId===activeMatch.awayClub.id?(openCheckpoint.awayDecisionSubmitted?"تصمیم شما ثبت شده":"تصمیم شما هنوز ثبت نشده"):"باشگاه شما در این مسابقه نیست"}</p>
     <div className="match-tactics-grid">
      <label>آرایش<select style={selectStyle} value={formation} onChange={e=>setFormation(e.target.value)}>{["4-3-3","4-4-2","3-5-2","4-2-3-1"].map(v=><option key={v}>{v}</option>)}</select></label>
      <label>ذهنیت<select style={selectStyle} value={mentality} onChange={e=>setMentality(e.target.value)}>{["DEFENSIVE","BALANCED","ATTACKING"].map(v=><option key={v} value={v}>{mentalityLabels[v]}</option>)}</select></label>
      <label>پرس<select style={selectStyle} value={pressing} onChange={e=>setPressing(e.target.value)}>{["LOW_BLOCK","MID_BLOCK","HIGH_PRESS"].map(v=><option key={v} value={v}>{pressingLabels[v]}</option>)}</select></label>
      <label>سرعت بازی<select style={selectStyle} value={tempo} onChange={e=>setTempo(e.target.value)}>{["SLOW","NORMAL","FAST"].map(v=><option key={v} value={v}>{tempoLabels[v]}</option>)}</select></label>
      <label className="match-tactic-wide">سبک پاس<select style={selectStyle} value={passingStyle} onChange={e=>setPassingStyle(e.target.value)}>{["SHORT","MIXED","DIRECT"].map(v=><option key={v} value={v}>{passingLabels[v]}</option>)}</select></label>
     </div>
     <div style={{marginTop:14}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><strong>تعویض‌ها ({usedSubstitutions+subs.length}/۵)</strong><button type="button" className="secondary" onClick={addSub} disabled={subs.length>=remainingSubstitutions}>افزودن تعویض</button></div>
      {subs.map((sub,index)=><div className="match-tactics-grid" key={index} style={{marginTop:8}}>
       <select aria-label="بازیکن خارج‌شونده" style={selectStyle} value={sub.outgoingPlayerId} onChange={e=>updateSub(index,"outgoingPlayerId",e.target.value)}><option value="">بازیکن خارج‌شونده</option>{starters.map(p=><option key={p.id} value={p.id}>{p.name} · {p.position}</option>)}</select>
       <select aria-label="بازیکن واردشونده" style={selectStyle} value={sub.incomingPlayerId} onChange={e=>updateSub(index,"incomingPlayerId",e.target.value)}><option value="">بازیکن واردشونده</option>{bench.map(p=><option key={p.id} value={p.id}>{p.name} · {p.position}</option>)}</select>
      </div>)}
     </div>
     <button style={{...buttonStyle,width:"100%",marginTop:15}} disabled={busy==="decision"||(clubId!==activeMatch.homeClub.id&&clubId!==activeMatch.awayClub.id)} onClick={()=>void submitDecision()}>{busy==="decision"?"در حال ثبت…":"ثبت تصمیم تاکتیکی"}</button>
    </article>}
    <article style={cardStyle}><h2 style={{fontSize:18,marginTop:0}}>خط زمانی مسابقه</h2>{activeMatch.events.length?activeMatch.events.map((event,index)=><div key={index} style={{borderTop:"1px solid #263b52",padding:"10px 0",fontSize:13}}><strong style={{color:"#9ce8c5"}}>{event.minute}′ · {labels[event.type]??event.type}</strong><div style={{color:"#c3cfdd",marginTop:4}}>{event.playerName||labels[event.type]||event.type}{event.relatedPlayerName?" · "+(event.type==="SUBSTITUTION"?"ورود: ":"پاس گل: ")+event.relatedPlayerName:""}</div></div>):<p style={{color:"#9fb0c5",fontSize:13}}>رویداد مهمی ثبت نشده است.</p>}</article>
    {activeMatch.runtime?.lineups&&<article style={cardStyle}>
     <h2 style={{fontSize:18,marginTop:0}}>ترکیب و نیمکت</h2>
     <div className="match-lineup-grid">
      {[{title:activeMatch.homeClub.name,side:activeMatch.runtime.lineups.home},{title:activeMatch.awayClub.name,side:activeMatch.runtime.lineups.away}].map(({title,side})=><div key={title} style={{minWidth:0}}>
       <strong>{title} · {side.formation}</strong>
       <p style={{color:"#9ce8c5",fontSize:12,margin:"9px 0 5px"}}>بازیکنان داخل زمین</p>
       {side.players.map((player,index)=><div key={player.id} style={{display:"flex",justifyContent:"space-between",gap:8,borderTop:"1px solid #263b52",padding:"6px 0",fontSize:12}}><span>{index+1}. {player.name} · {player.position}</span><strong>{player.overall}</strong></div>)}
       <p style={{color:"#9ce8c5",fontSize:12,margin:"12px 0 5px"}}>نیمکت</p>
       {side.bench.map(player=><div key={player.id} style={{display:"flex",justifyContent:"space-between",gap:8,borderTop:"1px solid #263b52",padding:"6px 0",fontSize:12}}><span>{player.name} · {player.position}</span><strong>{player.overall}</strong></div>)}
      </div>)}
     </div>
    </article>}
   </section>}
  </div>}
  <p style={{color:"#72869d",fontSize:11,textAlign:"center",marginTop:20}}>وضعیت مسابقات هر ۵ ثانیه از سرور به‌روزرسانی می‌شود؛ زمان و نتیجه فقط توسط سرور تعیین می‌شود.</p>
 </main>;
}
