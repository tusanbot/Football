"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { createTelegramSession } from "../../../lib/telegram-session.js";

type Plan = {
  formation: string;
  mentality: string;
  pressing: string;
  tempo: string;
  passingStyle: string;
};
type PlanResponse = { plan: Plan; version: number; isCustom: boolean };
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const fields: Array<{key:keyof Plan;label:string;options:string[]}> = [
  {key:"formation",label:"آرایش",options:["4-3-3","4-4-2","3-5-2","4-2-3-1"]},
  {key:"mentality",label:"ذهنیت",options:["DEFENSIVE","BALANCED","ATTACKING"]},
  {key:"pressing",label:"پرس",options:["LOW_BLOCK","MID_BLOCK","HIGH_PRESS"]},
  {key:"tempo",label:"سرعت بازی",options:["SLOW","NORMAL","FAST"]},
  {key:"passingStyle",label:"سبک پاس",options:["SHORT","MIXED","DIRECT"]},
];
const card:CSSProperties={background:"#111f32",border:"1px solid #263b52",borderRadius:16,padding:18,marginBottom:14};
const select:CSSProperties={width:"100%",padding:12,borderRadius:9,border:"1px solid #30465e",background:"#0b1727",color:"#f4f7fb",marginTop:7};
const label:CSSProperties={display:"block",fontSize:13,color:"#c3cfdd",marginBottom:12};

export default function FallbackPlanPage(){
  const [initData,setInitData]=useState("");
  const [sessionToken,setSessionToken]=useState("");
  const [data,setData]=useState<PlanResponse|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const headers={"content-type":"application/json",...(sessionToken?{authorization:"Bearer "+sessionToken}:{})};
  const load=useCallback(async()=>{
    if(!sessionToken)return;
    const response=await fetch(API+"/v1/matches/fallback-plan",{headers});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error??"دریافت برنامه جایگزین ناموفق بود.");
    setData(result);
  },[sessionToken,headers]);
  useEffect(()=>{setInitData(window.Telegram?.WebApp?.initData??"");window.Telegram?.WebApp?.ready?.();window.Telegram?.WebApp?.expand?.();},[]);
  useEffect(()=>{if(!initData)return;let active=true;void createTelegramSession(API,initData).then(token=>{if(active)setSessionToken(token);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"احراز هویت ناموفق بود.");});return()=>{active=false;};},[initData]);
  useEffect(()=>{if(sessionToken)void load().catch(e=>setError(e instanceof Error?e.message:"خطای ارتباط"));},[sessionToken,load]);
  function change(key:keyof Plan,value:string){setData(current=>current?{...current,plan:{...current.plan,[key]:value}}:current);}
  async function save(){
    if(!data)return;
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch(API+"/v1/matches/fallback-plan",{method:"PUT",headers,body:JSON.stringify({expectedVersion:data.version,plan:data.plan})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error==="FALLBACK_PLAN_VERSION_CONFLICT"?"برنامه در جای دیگری تغییر کرده است؛ صفحه را تازه‌سازی کنید.":result.error??"ذخیره ناموفق بود.");
      setData({...data,version:result.version,isCustom:true});
      setNotice("برنامه جایگزین ذخیره شد و در شروع مسابقات بعدی استفاده می‌شود.");
    }catch(e){setError(e instanceof Error?e.message:"خطای نامشخص");}
    finally{setBusy(false);}
  }
  if(!initData)return <main style={{maxWidth:760,margin:"0 auto",padding:24,color:"#f4f7fb",direction:"rtl"}}>برای مدیریت برنامه جایگزین، این صفحه را از داخل تلگرام باز کنید.<p><a href="/matches" style={{color:"#9ce8c5"}}>بازگشت به مرکز مسابقات</a></p></main>;
  return <main style={{maxWidth:760,minHeight:"100vh",margin:"0 auto",padding:"22px 14px 48px",color:"#f4f7fb",direction:"rtl",fontFamily:"Arial,Tahoma,sans-serif"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:20}}>
      <div><p style={{color:"#70d9ad",fontSize:11,fontWeight:800,letterSpacing:".12em",margin:0}}>FOOTBALL EMPIRE</p><h1 style={{fontSize:26,margin:"6px 0"}}>برنامه تاکتیکی جایگزین</h1><p style={{color:"#9fb0c5",fontSize:13,margin:0}}>برای زمانی که در وقفه‌های مسابقه تصمیمی ثبت نمی‌کنید</p></div>
      <a href="/matches" style={{color:"#9ce8c5",textDecoration:"none",border:"1px solid #36536b",borderRadius:9,padding:"9px 12px",whiteSpace:"nowrap"}}>بازگشت</a>
    </header>
    {error&&<p style={{background:"#3a2027",color:"#ffb6c0",padding:12,borderRadius:9}}>{error}</p>}
    {notice&&<p style={{background:"#15362f",color:"#9ce8c5",padding:12,borderRadius:9}}>{notice}</p>}
    {data&&<section style={card}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:16}}>
        <strong>{data.isCustom?"برنامه اختصاصی ذخیره‌شده":"استفاده از تاکتیک فعلی باشگاه"}</strong>
        <small style={{color:"#9fb0c5"}}>نسخه {data.version}</small>
      </div>
      {fields.map(field=><label key={field.key} style={label}>{field.label}<select style={select} value={data.plan[field.key]} onChange={e=>change(field.key,e.target.value)}>{field.options.map(value=><option key={value} value={value}>{value}</option>)}</select></label>)}
      <button onClick={()=>void save()} disabled={busy} style={{width:"100%",border:0,borderRadius:9,padding:13,background:"#63d3a5",color:"#092018",fontWeight:800,cursor:"pointer",opacity:busy ? 0.65 : 1}}>{busy?"در حال ذخیره…":"ذخیره برنامه جایگزین"}</button>
    </section>}
    <aside style={{...card,color:"#9fb0c5",fontSize:13,lineHeight:1.9}}>
      <strong style={{color:"#f4f7fb"}}>نحوه اعمال برنامه</strong>
      <p>در شروع هر مسابقه، نسخه فعلی این برنامه در snapshot همان مسابقه ثبت می‌شود. اگر در وقفه تاکتیکی تصمیمی ثبت نکنید، سرور از این برنامه برای تیم شما استفاده می‌کند. اگر برنامه اختصاصی نداشته باشید، تاکتیک اصلی باشگاه مبنا قرار می‌گیرد.</p>
      <p>تغییر این صفحه روی مسابقه‌ای که شروع شده یا snapshot آن ساخته شده اثر نمی‌گذارد؛ فقط مسابقات بعدی را تحت تأثیر قرار می‌دهد.</p>
    </aside>
  </main>;
}
