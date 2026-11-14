import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Bot, Keyboard } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required to start the bot.");
const webAppUrl = process.env.TELEGRAM_WEB_APP_URL;
const apiUrl = process.env.FOOTBALL_API_URL;
const botApiSecret = process.env.BOT_API_SECRET;
const bot = new Bot(token);

// Group replies are transient by default; preserve administrative and ranking messages.
const persistentGroupCommands = new Set([
  "group-register", "group-check", "group-give", "group-challenge",
  "group-challenge-complete", "group-challenge-cancel",
  "group-league", "group-league-start", "group-league-table", "group-leagues",
  "alliance", "alliance-create", "alliance-invite", "alliance-accept",
  "alliance-decline", "alliance-championship", "alliance-championship-join",
  "alliance-championship-start", "alliance-season-start", "alliance-season-close",
  "alliance-season-review", "alliance-contribute",
]);
function isPersistentGroupReply(command: string | undefined, messageText: string): boolean {
  if (command && persistentGroupCommands.has(command)) return true;
  return /(?:ranking|leaderboard|standings|rank|رنbot.use(async (ctx, next) => {
  const chat = ctx.chat;
  if (chat && (chat.type === "group" || chat.type === "supergroup")) {
    const chatId = chat.id;
    const originalReply = ctx.reply.bind(ctx);
    const command = ctx.message?.text?.match(/^\/([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
    Object.defineProperty(ctx, "reply", {
      configurable: true,
      value: async (...args: Parameters<typeof ctx.reply>) => {
        const sent = await originalReply(...args);
        if (!isPersistentGroupReply(command, String(args[0] ?? ""))) {
          const timer = setTimeout(() => {
            void ctx.api.deleteMessage(chatId, sent.message_id).catch((error: unknown) => {
              console.debug("Transient group reply could not be deleted:", error instanceof Error ? error.message : error);
            });
          }, 60_000);
          timer.unref();
        }
        return sent;
      },
    });
  }
  await next();
});   },
    });
  }
  await next();
});

type ApiPlayer = { id: string; firstName: string; lastName: string; position: string; overall: number; potential: number; status?: string; lineupSlot?: number | null; age?: number; fitness?: number; morale?: number; contractDays?: number; wage?: string };
type ApiListing = { id: string; askingPrice: string; player: ApiPlayer; sellerClub?: { name: string } };

async function api<T>(path: string, telegramId: number, method = "GET", body?: unknown): Promise<T> {
  if (!apiUrl || !botApiSecret) throw new Error("Bot API is not configured. Set FOOTBALL_API_URL and BOT_API_SECRET.");
  const response = await fetch(new URL(path, apiUrl), {
    method,
    headers: {
      "content-type": "application/json",
      "x-football-bot-secret": botApiSecret,
      "x-telegram-user-id": String(telegramId),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json() as T & { error?: string; details?: Record<string, string> };
  if (!response.ok) {
    const range = data.details?.minimumWeeklyWage ? ` (acceptable weekly wage: ${cash(data.details.minimumWeeklyWage)}–${cash(data.details.maximumWeeklyWage ?? data.details.minimumWeeklyWage)} Cash)` : "";
    throw new Error((data.error ?? `API request failed (${response.status})`) + range);
  }
  return data;
}


async function awardGroupActivity(ctx: { chat: { type: string; id: number }; from: { id: number } | undefined }, activityType: "CHALLENGE_JOIN"|"CHALLENGE_CREATE"|"LEAGUE_JOIN"|"LEAGUE_CREATE"|"MATCH_PLAYED", referenceId: string) {
 if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;
 try{await api(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/activity/award`,ctx.from.id,"POST",{activityType,referenceId});}
 catch(error){console.warn("Group activity reward skipped:",error instanceof Error?error.message:error);}
}
async function apiSystem(path:string,body:unknown):Promise<void>{
 if(!apiUrl||!botApiSecret)throw new Error("Bot API is not configured.");
 const response=await fetch(new URL(path,apiUrl),{method:"POST",headers:{"content-type":"application/json","x-football-bot-secret":botApiSecret},body:JSON.stringify(body)});
 if(!response.ok)throw new Error("System API failed ("+response.status+")");
}
function privateMenuKeyboard() {
  const keyboard = new Keyboard()
    .text("/club").text("/wallet").row()
    .text("/players").text("/lineup").row()
    .text("/development").text("/operations").row()
    .text("/finance").text("/scout").row()
    .text("/opponents").text("/matches").row()
    .text("/leagues").text("/market").row()
    .text("/special").text("/help").row()
    .text("/menu");
  if (webAppUrl) keyboard.webApp("Open Football Empire", webAppUrl);
  return keyboard.resized().persistent();
}
function cash(value: string) { return BigInt(value).toLocaleString("en-US"); }
function playerName(player: ApiPlayer) { return `${player.firstName} ${player.lastName}`; }

bot.command("start", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") {
    return ctx.reply("To create or open your Football Empire club, start a private chat with me.");
  }

  try {
    const account = await api<{
      user: { displayName: string };
      club: { name: string; level: number } | null;
      wallets: Array<{ asset: "CASH" | "GOLD"; balance: string }>;
    }>("/v1/auth/bot", ctx.from.id, "POST", {
      firstName: ctx.from.first_name,
      ...(ctx.from.last_name ? { lastName: ctx.from.last_name } : {}),
      ...(ctx.from.username ? { username: ctx.from.username } : {}),
    });

    const cashBalance = account.wallets.find((wallet) => wallet.asset === "CASH")?.balance ?? "0";
    const goldBalance = account.wallets.find((wallet) => wallet.asset === "GOLD")?.balance ?? "0";
    const keyboard = privateMenuKeyboard();

    await ctx.reply(
      `Welcome, ${account.user.displayName}! Your club is ready.\n\n` +
      `Club: ${account.club?.name ?? "Not created"} (Level ${account.club?.level ?? 1})\n` +
      `Starter balance: ${cash(cashBalance)} Cash · ${cash(goldBalance)} Gold\n\n` +
      `You can manage your club directly here or continue in the Mini App.\n\n` +
      `Commands: /club /wallet /rename /players /lineup /development /train /renew /market /special /pack /sell /buy /menu`,
      { reply_markup: keyboard },
    );
  } catch (error) {
    await ctx.reply(`Could not create or load your club: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("menu", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  await ctx.reply("منوی اصلی Football Empire آماده است. برای عملیات دارای ورودی، از /help راهنمای دستورها را ببینید.", {
    reply_markup: privateMenuKeyboard(),
  });
});

bot.command("help", async (ctx) => ctx.reply(
  "Football Empire commands:\n/menu — show the private Reply Keyboard again\n/club — club profile\n/wallet — Cash and Gold balances\n/rename NEW NAME — rename your club\n/players — your active squad\n/lineup — view starting XI and tactics\n/setlineup FORMATION ID1 ... ID11 — set your XI\n/development — player development overview\n/train PLAYER_ID FOCUS INTENSITY — train a player\n/renew PLAYER_ID DAYS WEEKLY_WAGE — renew a contract\n/operations — facilities, academy, sponsors and finance\n/finance [DAYS] — income and expense statement\n/upgrade stadium|training|academy — upgrade a facility\n/ticket-price PRICE — set stadium ticket price\n/scout — find academy prospects\n/recruit PROSPECT_ID — sign an academy prospect\n/sponsor OFFER_ID — sign a sponsor\n/coach-upgrade — develop your coach\n/hire-coach balanced|youth|performance — hire a coach\n/opponents — clubs available for friendlies\n/friendly CLUB_ID — schedule a friendly\n/matches — your fixtures and results\n/play MATCH_ID — simulate a due match\n/league NAME [4-10] — create a league\n/cup NAME [4|8] — create a knockout cup\n/leagues — open leagues\n/joinleague ID — join a league\n/startleague ID — start your league\n/startcup ID — start your cup\n/table ID — league table or cup bracket\n/group-register — register this Telegram group (admins only)\n/group-join — join this group with your club\n/group — show group status and treasury\n/group-activity — earn one daily group point\n/group-shop — reward shop\n/group-buy ITEM [USER_ID] — purchase reward\n/group-challenges — list challenges\n/group-challenge TITLE|START_ISO|END_ISO|POINTS — create challenge\n/group-challenge-join ID — join challenge\n/group-challenge-complete ID USER_ID — settle challenge\n/group-check — refresh member threshold\n/group-league NAME [4-10] — create local league\n/group-league-join ID — join local league\n/group-league-start ID — start local league\n/group-league-table ID — standings\n/alliance — alliance status and invitations\n/alliance-create NAME — create an alliance\n/alliance-invite GROUP_ID — invite a group\n/alliance-contribute AMOUNT — contribute group points to alliance treasury\n/alliance-accept ID / /alliance-decline ID — respond to invite\n/alliance-championship NAME|TEAMS — cross-group tournament\n/alliance-championship-join ID / alliance-championship-start ID\n/alliance-season-start [DAYS] / alliance-season-close\n/alliance-season-review SEASON_ID approve|reject — flagged prize review (authorized reviewer)\n/market — open transfer listings\n/sell PLAYER_ID PRICE — list a generated player\n/buy LISTING_ID — buy a listed player\n/special — view special players and pack prices\n/pack epic|legendary|icon — acquire a special player\n\nSpecial players are not tradeable in the regular market.",
));

bot.command("group-register", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return ctx.reply("Run /group-register inside the Telegram group you want to register.");
  try {
    const memberCount = await ctx.api.getChatMemberCount(ctx.chat.id);
    if (memberCount < 10) return ctx.reply("This group needs at least 10 Telegram members to activate Football Empire. Current members: " + memberCount + ".");
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    const role = member.status === "creator" ? "OWNER" : member.status === "administrator" ? "ADMIN" : null;
    if (!role) return ctx.reply("Only a group owner or administrator can register this group.");
    const result = await api<{ registration: { group: { title: string; memberCount: number; isActive: boolean; points: string }; role: string; registeredManagers: number; minimumMembers: number } }>("/v1/groups/register", ctx.from.id, "POST", { telegramGroupId: String(ctx.chat.id), title: ctx.chat.title, role, memberCount });
    await ctx.reply("Football Empire group connected: " + result.registration.group.title + "\nRegistered role: " + result.registration.role + "\nRegistered club managers: " + result.registration.registeredManagers + "\n\nMembers can join with /group-join after starting the Bot privately.");
  } catch (error) { await ctx.reply("Could not register this group: " + (error instanceof Error ? error.message : "unknown error")); }
});

bot.command("group-join", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return ctx.reply("Run /group-join inside a registered Telegram group.");
  try {
    const memberCount = await ctx.api.getChatMemberCount(ctx.chat.id);
    if (memberCount < 10) return ctx.reply("This group currently has fewer than 10 Telegram members and is inactive.");
    const result = await api<{ membership: { group: { title: string }; role: string; registeredManagers: number; memberCount: number; alreadyJoined: boolean } }>("/v1/groups/join", ctx.from.id, "POST", { telegramGroupId: String(ctx.chat.id), memberCount });
    await ctx.reply(result.membership.alreadyJoined ? "Your club is already registered in " + result.membership.group.title + ". Role: " + result.membership.role + "." : "Your club joined " + result.membership.group.title + ". Registered club managers: " + result.membership.registeredManagers + ".");
  } catch (error) { await ctx.reply("Could not join this group: " + (error instanceof Error ? error.message : "unknown error")); }
});

bot.command("group", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return ctx.reply("Use /group inside a registered Telegram group.");
  try {
    const result = await api<{ group: { title: string; memberCount: number; isActive: boolean; points: string }; role: string; registeredManagers: number; minimumMembers: number }>("/v1/groups/" + encodeURIComponent(String(ctx.chat.id)), ctx.from.id);
    await ctx.reply("Football Empire · " + result.group.title + "\nStatus: " + (result.group.isActive ? "ACTIVE" : "INACTIVE") + "\nTelegram members: " + result.group.memberCount + "\nRegistered club managers: " + result.registeredManagers + "\nGroup points: " + result.group.points + "\nMinimum members: " + result.minimumMembers);
  } catch (error) { await ctx.reply("Group status unavailable: " + (error instanceof Error ? error.message : "unknown error") + "\nUse /group-register (admins) or /group-join (members)."); }
});
bot.command("group-activity", async (ctx) => {
  if (!ctx.from || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return;
  try {
    const result = await api<{ activity: { awarded: boolean; replayed: boolean; points: string; award: string } }>("/v1/groups/activity", ctx.from.id, "POST", { telegramGroupId: String(ctx.chat.id) });
    await ctx.reply(result.activity.awarded ? "Daily group activity recorded. +1 group point. Treasury: " + result.activity.points : "Your activity was already counted today. Group treasury: " + result.activity.points);
  } catch (error) { await ctx.reply("Could not record group activity: " + (error instanceof Error ? error.message : "unknown error")); }
});

bot.command("group-shop",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;try{const d=await api<{points:string;items:Array<{slug:string;name:string;cost:string;scope:string}>}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/shop`,ctx.from.id);await ctx.reply("Treasury: "+cash(d.points)+" points\n"+d.items.map(i=>i.slug+" — "+i.name+" "+cash(i.cost)+" ["+i.scope+"]").join("\n"));}catch(e){await ctx.reply("Shop unavailable: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-buy",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const [itemSlug,recipientTelegramId]=String(ctx.match??"").trim().split(/\s+/);if(!itemSlug)return ctx.reply("Usage: /group-buy ITEM [USER_ID]");try{const d=await api<{item:string;points:string}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/shop/purchase`,ctx.from.id,"POST",{itemSlug,...(recipientTelegramId?{recipientTelegramId}:{}),idempotencyKey:"group-buy:"+randomUUID()});await ctx.reply("Purchased "+d.item+" · treasury "+cash(d.points));}catch(e){await ctx.reply("Purchase failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-challenges",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;try{const d=await api<{challenges:Array<{id:string;title:string;status:string;participants:number;rewardPoints:string}>}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges`,ctx.from.id);await ctx.reply(d.challenges.length?d.challenges.map(c=>c.id+" "+c.title+" ["+c.status+"] · "+c.participants+" participants · "+cash(c.rewardPoints)+" points").join("\n"):"No challenges.");}catch(e){await ctx.reply("Challenges unavailable: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-challenge",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const [title,startsAt,endsAt,rewardPoints]=String(ctx.match??"").split("|").map(x=>x.trim());if(!title||!startsAt||!endsAt||!rewardPoints)return ctx.reply("Usage: /group-challenge TITLE|START_ISO|END_ISO|POINTS");try{const d=await api<{challenge:{id:string}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges`,ctx.from.id,"POST",{title,startsAt,endsAt,rewardPoints,idempotencyKey:"group-challenge:"+randomUUID()});await awardGroupActivity(ctx,"CHALLENGE_CREATE",d.challenge.id);await ctx.reply("Created: "+d.challenge.id+" · join /group-challenge-join "+d.challenge.id);}catch(e){await ctx.reply("Create failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-challenge-join",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("Usage: /group-challenge-join ID");try{await api(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges/${encodeURIComponent(id)}/join`,ctx.from.id,"POST",{});await awardGroupActivity(ctx,"CHALLENGE_JOIN",id);await ctx.reply("Joined challenge.");}catch(e){await ctx.reply("Join failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-challenge-complete",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const [id,winnerTelegramId]=String(ctx.match??"").trim().split(/\s+/);if(!id||!winnerTelegramId)return ctx.reply("Usage: /group-challenge-complete ID WINNER_USER_ID");try{await api(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges/${encodeURIComponent(id)}/complete`,ctx.from.id,"POST",{winnerTelegramId});await ctx.reply("Challenge settled.");}catch(e){await ctx.reply("Settle failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-check",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;try{const m=await ctx.api.getChatMember(ctx.chat.id,ctx.from.id);if(m.status!=="creator"&&m.status!=="administrator")return ctx.reply("Admins only.");const memberCount=await ctx.api.getChatMemberCount(ctx.chat.id);const d=await api<{isActive:boolean;memberCount:number}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/check`,ctx.from.id,"POST",{memberCount});await ctx.reply("Group "+(d.isActive?"ACTIVE":"INACTIVE")+" · "+d.memberCount+" members.");}catch(e){await ctx.reply("Check failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-league",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const m=String(ctx.match??"").trim().match(/^(.*?)(?:\s+(\\d+))?$/),name=m?.[1]?.trim(),maxTeams=Number(m?.[2]??8);if(!name||maxTeams<4||maxTeams>10)return ctx.reply("Usage: /group-league NAME [4-10]");try{const d=await api<{competition:{id:string}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues`,ctx.from.id,"POST",{name,maxTeams,idempotencyKey:"group-league:"+randomUUID()});await awardGroupActivity(ctx,"LEAGUE_CREATE",d.competition.id);await ctx.reply("League: "+d.competition.id+" · join /group-league-join "+d.competition.id);}catch(e){await ctx.reply("Create failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-league-join",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("Usage: /group-league-join ID");try{const d=await api<{teams:number}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues/${encodeURIComponent(id)}/join`,ctx.from.id,"POST",{});await awardGroupActivity(ctx,"LEAGUE_JOIN",id);await ctx.reply("Joined · teams "+d.teams);}catch(e){await ctx.reply("Join failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-league-start",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("Usage: /group-league-start ID");try{const d=await api<{fixturesCreated:number;rounds:number}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues/${encodeURIComponent(id)}/start`,ctx.from.id,"POST",{});await ctx.reply("Started · fixtures "+d.fixturesCreated+" · rounds "+d.rounds);}catch(e){await ctx.reply("Start failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-league-table",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("Usage: /group-league-table ID");try{const d=await api<{competition:{name:string;teams:Array<{rank:number;club:string;points:number;played:number}>}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues/${encodeURIComponent(id)}`,ctx.from.id);await ctx.reply(d.competition.name+"\n"+d.competition.teams.map(t=>t.rank+". "+t.club+" · "+t.points+" pts · "+t.played+" P").join("\n"));}catch(e){await ctx.reply("Table failed: "+(e instanceof Error?e.message:"unknown"));}});


bot.command("group-rewards",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;try{const d=await api<{personal:{points:string;rewards:Array<{item:string;grantedAt:string}>}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/workspace`,ctx.from.id);await ctx.reply("Personal group points: "+cash(d.personal.points)+"\n"+(d.personal.rewards.map(r=>r.item+" · "+new Date(r.grantedAt).toLocaleDateString()).join("\n")||"No rewards yet."));}catch(e){await ctx.reply("Rewards unavailable: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-treasury",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;try{const d=await api<{group:{points:string;memberCount:number;isActive:boolean};personal:{history:Array<{amount:string;description:string}>}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/workspace`,ctx.from.id);await ctx.reply("Treasury: "+cash(d.group.points)+" points · "+d.group.memberCount+" members · "+(d.group.isActive?"active":"inactive")+"\n"+d.personal.history.slice(0,6).map(x=>(BigInt(x.amount)>=0n?"+":"")+cash(x.amount)+" · "+x.description).join("\n"));}catch(e){await ctx.reply("Treasury unavailable: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-give",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;const [recipientTelegramId,itemSlug]=String(ctx.match??"").trim().split(/\s+/);if(!recipientTelegramId||!itemSlug)return ctx.reply("Usage: /group-give USER_ID ITEM_SLUG");try{const d=await api<{item:string;points:string}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/shop/purchase`,ctx.from.id,"POST",{itemSlug,recipientTelegramId,idempotencyKey:"group-give:"+randomUUID()});await ctx.reply("Granted "+d.item+" · treasury "+cash(d.points));}catch(e){await ctx.reply("Grant failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-challenge-cancel",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("Usage: /group-challenge-cancel ID");try{const d=await api<{replayed:boolean;points:string}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges/${encodeURIComponent(id)}/cancel`,ctx.from.id,"POST",{});await ctx.reply("Challenge cancelled. Treasury: "+cash(d.points)+" points.");}catch(e){await ctx.reply("Cancel failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-leagues",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;try{const d=await api<{leagues:Array<{id:string;name:string;status:string;teams:number;maxTeams:number}>}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues`,ctx.from.id);await ctx.reply(d.leagues.length?d.leagues.map(c=>c.name+" ["+c.status+"] "+c.teams+"/"+c.maxTeams+" · "+c.id).join("\n"):"No local leagues.");}catch(e){await ctx.reply("Leagues unavailable: "+(e instanceof Error?e.message:"unknown"));}});

bot.command("club", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /club in a private chat to view your club.");
  try {
    const result = await api<{
      club: { name: string; level: number; reputation: number; createdAt: string } | null;
      user: { displayName: string };
    }>("/v1/me", ctx.from.id);
    if (!result.club) return ctx.reply("You do not have a club yet. Send /start to create one.");
    await ctx.reply(
      `Club: ${result.club.name}\nManager: ${result.user.displayName}\nLevel: ${result.club.level}\nReputation: ${result.club.reputation}\nFounded: ${new Date(result.club.createdAt).toLocaleDateString("en-US")}`,
    );
  } catch (error) {
    await ctx.reply(`Could not load club: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("wallet", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /wallet in a private chat to view your balances.");
  try {
    const result = await api<{ wallets: Array<{ asset: "CASH" | "GOLD"; balance: string }> }>("/v1/wallet", ctx.from.id);
    const balances = result.wallets.map((wallet) => `${wallet.asset}: ${cash(wallet.balance)}`).join("\n");
    await ctx.reply(`Your club wallet:\n${balances || "No wallet balances found."}`);
  } catch (error) {
    await ctx.reply(`Could not load wallet: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("rename", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /rename in a private chat to rename your club.");
  const name = String(ctx.match ?? "").trim();
  if (name.length < 2 || name.length > 32) return ctx.reply("Usage: /rename NEW CLUB NAME (2–32 characters)");
  try {
    const result = await api<{ club: { name: string } }>("/v1/club", ctx.from.id, "PATCH", { name });
    await ctx.reply(`Your club is now called ${result.club.name}.`);
  } catch (error) {
    await ctx.reply(`Could not rename club: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("players", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /players in a private chat to view your squad.");
  try {
    await api("/v1/club/development", ctx.from.id);
    const result = await api<{ players: ApiPlayer[] }>("/v1/club/players", ctx.from.id);
    if (!result.players.length) return ctx.reply("Your squad is empty. Open the Mini App to complete club setup.");
    const lines = result.players.map((p) => `• ${playerName(p)} | ${p.position} | OVR ${p.overall} | POT ${p.potential}${p.lineupSlot ? ` | XI #${p.lineupSlot}` : ""}\n  Fitness ${p.fitness ?? "-"} · Morale ${p.morale ?? "-"} · Contract ${p.contractDays ?? "-"}d · Wage ${p.wage ? cash(p.wage) : "-"} / week · ${p.status ?? "ACTIVE"}\n  ID: ${p.id}`);
    await ctx.reply("Your active squad:\n\n" + lines.join("\n"));
  } catch (error) { await ctx.reply(`Could not load squad: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("lineup", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /lineup in a private chat to view your starting XI.");
  try {
    await api("/v1/club/development", ctx.from.id);
    const result = await api<{ club: {
      formation: string;
      tactics: { mentality: string; pressing: string; tempo: string; passingStyle: string };
      lineupVersion: number;
      players: Array<{ id: string; firstName: string; lastName: string; position: string; overall: number; lineupSlot: number }>;
    } }>("/v1/club/lineup", ctx.from.id);
    const players = result.club.players.map((player) => `${player.lineupSlot}. ${player.firstName} ${player.lastName} — ${player.position} · OVR ${player.overall}`);
    await ctx.reply(
      `Formation: ${result.club.formation} · Version: ${result.club.lineupVersion}\n` +
      `Tactics: ${result.club.tactics.mentality}, ${result.club.tactics.pressing}, ${result.club.tactics.tempo}, ${result.club.tactics.passingStyle}\n\n` +
      (players.join("\n") || "No starting XI configured.") +
      "\n\nUse /players to find IDs, then /setlineup FORMATION ID1 ... ID11.\nFormations: 4-3-3, 4-4-2, 3-5-2, 4-2-3-1",
    );
  } catch (error) {
    await ctx.reply(`Could not load lineup: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("setlineup", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /setlineup in a private chat to change your starting XI.");
  const parts = String(ctx.match ?? "").trim().split(/\s+/);
  const [formation, ...playerIds] = parts;
  if (!formation || playerIds.length !== 11) {
    return ctx.reply("Usage: /setlineup 4-3-3 PLAYER_ID_1 ... PLAYER_ID_11\nSupported: 4-3-3, 4-4-2, 3-5-2, 4-2-3-1");
  }
  try {
    const current = await api<{ club: { lineupVersion: number } }>("/v1/club/lineup", ctx.from.id);
    await api("/v1/club/lineup", ctx.from.id, "PUT", {
      formation, playerIds, expectedVersion: current.club.lineupVersion,
    });
    await ctx.reply("Starting XI and formation saved. Use /lineup to review your setup.");
  } catch (error) {
    await ctx.reply(`Could not save lineup: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("development", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /development in a private chat.");
  try {
    const result = await api<{ club: {
      trainingGroundLevel: number;
      weeklyWageBill: string;
      wageArrears: string;
      coach: { name: string; level: number; trainingSkill: number; recoverySkill: number; medicalSkill: number; weeklySalary: string };
      players: Array<{ id: string; firstName: string; lastName: string; overall: number; potential: number; age: number; fitness: number; morale: number; contractDays: number; status: string; minimumWeeklyWage: string; maximumWeeklyWage: string }>;
    } }>("/v1/club/development", ctx.from.id);
    const lines = result.club.players.slice(0, 15).map((p) =>
      `• ${p.firstName} ${p.lastName} · OVR ${p.overall}/${p.potential} · Age ${p.age}\n  Fitness ${p.fitness} · Morale ${p.morale} · Contract ${p.contractDays}d · ${p.status}\n  Renew ${cash(p.minimumWeeklyWage)}–${cash(p.maximumWeeklyWage)} Cash/week\n  ID: ${p.id}`,
    );
    await ctx.reply(
      `Player development · Training ground Lv.${result.club.trainingGroundLevel}\nWeekly wage bill: ${cash(result.club.weeklyWageBill)} Cash · Arrears: ${cash(result.club.wageArrears)} Cash\nCoach: ${result.club.coach.name} (Lv.${result.club.coach.level})\nTraining ${result.club.coach.trainingSkill} · Recovery ${result.club.coach.recoverySkill} · Medical ${result.club.coach.medicalSkill} · Salary ${cash(result.club.coach.weeklySalary)} Cash/week\n\n` +
      (lines.join("\n\n") || "No players found.") +
      "\n\n/train PLAYER_ID BALANCED|SHOOTING|... LIGHT|NORMAL|INTENSE\n/renew PLAYER_ID 90|180|365 WEEKLY_WAGE",
    );
  } catch (error) { await ctx.reply(`Could not load player development: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("train", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /train in a private chat.");
  const [playerId, focusRaw, intensityRaw] = String(ctx.match ?? "").trim().split(/\s+/);
  const focus = focusRaw?.toUpperCase();
  const intensity = intensityRaw?.toUpperCase();
  const focuses = ["BALANCED", "GOALKEEPING", "DEFENDING", "PASSING", "PLAYMAKING", "DRIBBLING", "SHOOTING", "PHYSICAL"];
  if (!playerId || !focus || !focuses.includes(focus) || !["LIGHT", "NORMAL", "INTENSE"].includes(intensity ?? "")) {
    return ctx.reply("Usage: /train PLAYER_ID FOCUS INTENSITY\nFocus: BALANCED, GOALKEEPING, DEFENDING, PASSING, PLAYMAKING, DRIBBLING, SHOOTING, PHYSICAL\nIntensity: LIGHT, NORMAL, INTENSE");
  }
  try {
    const result = await api<{ training: { overallBefore: number; overallAfter: number; fitnessBefore: number; fitnessAfter: number; injuryOccurred: boolean; injuryUntil: string | null; cashCost: string; replayed: boolean } }>(
      `/v1/club/players/${encodeURIComponent(playerId)}/train`, ctx.from.id, "POST",
      { focus, intensity, idempotencyKey: `tg-train-${ctx.from.id}-${ctx.update.update_id}` },
    );
    const t = result.training;
    await ctx.reply(
      `Training complete. OVR ${t.overallBefore} → ${t.overallAfter}; fitness ${t.fitnessBefore} → ${t.fitnessAfter}. Cost: ${cash(t.cashCost)} Cash.` +
      (t.injuryOccurred ? `\nInjury: player unavailable until ${t.injuryUntil}.` : "") +
      (t.replayed ? "\nThis was a repeated request." : ""),
    );
  } catch (error) { await ctx.reply(`Training failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("renew", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /renew in a private chat.");
  const [playerId, daysRaw, wageRaw] = String(ctx.match ?? "").trim().split(/\s+/);
  const days = Number(daysRaw);
  if (!playerId || ![90, 180, 365].includes(days) || !wageRaw || !/^[1-9][0-9]{0,8}$/.test(wageRaw)) {
    return ctx.reply("Usage: /renew PLAYER_ID 90|180|365 WEEKLY_WAGE\nUse /development to see the minimum acceptable weekly wage.");
  }
  try {
    const result = await api<{ contract: { contractDays: number; weeklyWage: string; replayed: boolean } }>(
      `/v1/club/players/${encodeURIComponent(playerId)}/contract/renew`, ctx.from.id, "POST",
      { extensionDays: days, weeklyWage: wageRaw, idempotencyKey: `tg-renew-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(`Contract renewed: ${result.contract.contractDays} days remaining · ${cash(result.contract.weeklyWage)} Cash/week.${result.contract.replayed ? " This was a repeated request." : ""}`);
  } catch (error) { await ctx.reply(`Contract renewal failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("operations", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /operations in a private chat.");
  try {
    const result = await api<{ club: {
      stadiumLevel: number; stadiumCapacity: number; ticketPrice: string; trainingGroundLevel: number; academyLevel: number;
      dailyMaintenance: string; operatingArrears: string; coach: { name: string; level: number; weeklySalary: string } | null;
      activeSponsor: { partnerName: string; tier: string; dailyIncome: string; endsAt: string } | null;
      sponsorOffers: Array<{ id: string; partnerName: string; tier: string; dailyIncome: string; signingBonus: string; durationDays: number }>;
      coachOffers: Array<{ id: string; name: string; signingFee: string; weeklySalary: string }>;
      prospects: Array<{ id: string; firstName: string; lastName: string; age: number; position: string; overall: number; potential: number; recruitmentCost: string }>;
      financeEntries: Array<{ category: string; direction: string; amount: string; description: string }>;
    } }>("/v1/club/operations", ctx.from.id);
    const club = result.club;
    const prospects = club.prospects.map((p) => `• ${p.firstName} ${p.lastName} · ${p.age}y · ${p.position} · OVR ${p.overall}/POT ${p.potential} · ${cash(p.recruitmentCost)} Cash\n  ID: ${p.id}`);
    const sponsor = club.activeSponsor ? `${club.activeSponsor.partnerName} · ${club.activeSponsor.tier} · ${cash(club.activeSponsor.dailyIncome)} Cash/day` : "No active sponsor";
    await ctx.reply(
      `Club facilities\nStadium Lv.${club.stadiumLevel} · ${club.stadiumCapacity} seats · Ticket ${cash(club.ticketPrice)} Cash\nTraining ground Lv.${club.trainingGroundLevel} · Academy Lv.${club.academyLevel}\nDaily maintenance: ${cash(club.dailyMaintenance)} Cash · Operating arrears: ${cash(club.operatingArrears)} Cash\nCoach: ${club.coach?.name ?? "None"} (Lv.${club.coach?.level ?? 0}) · Salary ${cash(club.coach?.weeklySalary ?? "0")} Cash/week\nSponsor: ${sponsor}\n\nAcademy prospects:\n${prospects.join("\n\n") || "No available prospects"}\n\n/upgrade stadium|training|academy\n/scout\n/recruit PROSPECT_ID\n/sponsor local-partner|regional-brand|national-network\n/coach-upgrade\n/hire-coach balanced|youth|performance`,
    );
  } catch (error) { await ctx.reply(`Could not load club operations: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("finance", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /finance in a private chat.");
  const daysRaw = String(ctx.match ?? "").trim();
  const days = daysRaw ? Number(daysRaw) : 30;
  if (!Number.isInteger(days) || days < 1 || days > 90) return ctx.reply("Usage: /finance [DAYS 1-90]");
  try {
    const result = await api<{ periodDays: number; income: string; expenses: string; net: string; operatingArrears: string; entries: Array<{ category: string; direction: string; amount: string; description: string; occurredAt: string }> }>(`/v1/club/finance?days=${days}`, ctx.from.id);
    const entries = result.entries.slice(0, 12).map((entry) =>
      "• " + (entry.direction === "CREDIT" ? "+" : "−") + cash(entry.amount) + " Cash · " + entry.category + "\n  " + entry.description + " · " + new Date(entry.occurredAt).toLocaleDateString("en-US"),
    );
    const netLabel = result.net.startsWith("-") ? "زیان" : "سود";
    const netAmount = result.net.startsWith("-") ? result.net.slice(1) : result.net;
    await ctx.reply(
      "صورت‌حساب " + result.periodDays + " روز اخیر\nدرآمد: " + cash(result.income) + " Cash\nهزینه: " + cash(result.expenses) + " Cash\n" + netLabel + ": " + cash(netAmount) + " Cash\nمعوقات عملیاتی: " + cash(result.operatingArrears) + " Cash\n\nگردش‌های اخیر:\n" + (entries.join("\n\n") || "No finance entries"),
    );
  } catch (error) { await ctx.reply("Could not load financial statement: " + (error instanceof Error ? error.message : "unknown error")); }
});
bot.command("upgrade", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /upgrade in a private chat.");
  const facility = String(ctx.match ?? "").trim().toLowerCase();
  const value = ({ stadium: "STADIUM", training: "TRAINING_GROUND", academy: "ACADEMY" } as const)[facility as "stadium" | "training" | "academy"];
  if (!value) return ctx.reply("Usage: /upgrade stadium|training|academy");
  try {
    const result = await api<{ upgrade: { level?: number; cost?: string; replayed: boolean } }>(
      `/v1/club/facilities/${value}/upgrade`, ctx.from.id, "POST",
      { idempotencyKey: `tg-upgrade-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.upgrade.replayed ? "This upgrade request was already processed." : `${facility} upgraded to level ${result.upgrade.level}. Cost: ${cash(result.upgrade.cost ?? "0")} Cash.`);
  } catch (error) { await ctx.reply(`Facility upgrade failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("ticket-price", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /ticket-price in a private chat.");
  const price = String(ctx.match ?? "").trim();
  if (!/^(?:[1-9][0-9]?|[1-4][0-9]{2}|500)$/.test(price) || Number(price) < 10) {
    return ctx.reply("Usage: /ticket-price 10-500");
  }
  try {
    const current = await api<{ club: { ticketPrice: string } }>("/v1/club/operations", ctx.from.id);
    const result = await api<{ ticketing: { ticketPrice: string } }>(
      "/v1/club/stadium/ticket-price", ctx.from.id, "PATCH",
      { ticketPrice: price, expectedTicketPrice: current.club.ticketPrice },
    );
    await ctx.reply(`Stadium ticket price set to ${cash(result.ticketing.ticketPrice)} Cash.`);
  } catch (error) { await ctx.reply(`Ticket price update failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("scout", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /scout in a private chat.");
  try {
    const result = await api<{ scouting: { prospects: Array<{ id: string; firstName: string; lastName: string; age: number; position: string; overall: number; potential: number; recruitmentCost: string }>; scoutingCost?: string; replayed: boolean } }>(
      "/v1/club/academy/scout", ctx.from.id, "POST",
      { idempotencyKey: `tg-scout-${ctx.from.id}-${ctx.update.update_id}` },
    );
    if (result.scouting.replayed) return ctx.reply("This scouting request was already processed.");
    const lines = result.scouting.prospects.map((p) => `• ${p.firstName} ${p.lastName} · ${p.age}y · ${p.position} · OVR ${p.overall}/POT ${p.potential}\n  Cost ${cash(p.recruitmentCost)} Cash · ID ${p.id}`);
    await ctx.reply(`Scouting complete. Cost: ${cash(result.scouting.scoutingCost ?? "0")} Cash\n\n${lines.join("\n\n")}\n\nRecruit with /recruit PROSPECT_ID`);
  } catch (error) { await ctx.reply(`Academy scouting failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("recruit", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /recruit in a private chat.");
  const prospectId = String(ctx.match ?? "").trim();
  if (!prospectId) return ctx.reply("Usage: /recruit PROSPECT_ID");
  try {
    const result = await api<{ recruitment: { player?: { firstName: string; lastName: string; overall: number; potential: number }; cost?: string; replayed: boolean } }>(
      `/v1/club/academy/${encodeURIComponent(prospectId)}/recruit`, ctx.from.id, "POST",
      { idempotencyKey: `tg-recruit-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.recruitment.replayed ? "This recruitment request was already processed." : `Signed ${result.recruitment.player?.firstName} ${result.recruitment.player?.lastName} · OVR ${result.recruitment.player?.overall}/POT ${result.recruitment.player?.potential}. Cost: ${cash(result.recruitment.cost ?? "0")} Cash.`);
  } catch (error) { await ctx.reply(`Recruitment failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("sponsor", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /sponsor in a private chat.");
  const offerId = String(ctx.match ?? "").trim().toLowerCase();
  if (!["local-partner", "regional-brand", "national-network"].includes(offerId)) {
    try {
      const overview = await api<{ club: { sponsorOffers: Array<{ id: string; partnerName: string; tier: string; dailyIncome: string; signingBonus: string; durationDays: number }> } }>("/v1/club/operations", ctx.from.id);
      const offers = overview.club.sponsorOffers.map((offer) => "• " + offer.id + " · " + offer.partnerName + " (" + offer.tier + ") · " + cash(offer.dailyIncome) + " Cash/day · Bonus " + cash(offer.signingBonus) + " · " + offer.durationDays + " days");
      return ctx.reply("Available sponsor offers:\n" + (offers.join("\n") || "No offers unlocked") + "\n\n/sponsor OFFER_ID");
    } catch (error) { return ctx.reply("Could not load sponsor offers: " + (error instanceof Error ? error.message : "unknown error")); }
  }
  try {
    const result = await api<{ contract: { sponsor?: { partnerName: string; tier: string; dailyIncome: string }; replayed: boolean } }>(
      "/v1/club/sponsors/sign", ctx.from.id, "POST",
      { offerId, idempotencyKey: `tg-sponsor-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.contract.replayed ? "This sponsor contract was already signed." : `Signed ${result.contract.sponsor?.partnerName} (${result.contract.sponsor?.tier}). Daily income: ${cash(result.contract.sponsor?.dailyIncome ?? "0")} Cash.`);
  } catch (error) { await ctx.reply(`Sponsor signing failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("coach-upgrade", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /coach-upgrade in a private chat.");
  try {
    const result = await api<{ upgrade: { coach?: { level: number; trainingSkill: number; recoverySkill: number; medicalSkill: number }; cost?: string; replayed: boolean } }>(
      "/v1/club/coach/upgrade", ctx.from.id, "POST",
      { idempotencyKey: `tg-coach-upgrade-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.upgrade.replayed ? "This coach upgrade was already processed." : `Coach upgraded to Lv.${result.upgrade.coach?.level}. Training ${result.upgrade.coach?.trainingSkill}, recovery ${result.upgrade.coach?.recoverySkill}, medical ${result.upgrade.coach?.medicalSkill}. Cost: ${cash(result.upgrade.cost ?? "0")} Cash.`);
  } catch (error) { await ctx.reply(`Coach upgrade failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("hire-coach", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /hire-coach in a private chat.");
  const candidateId = String(ctx.match ?? "").trim().toLowerCase();
  if (!["balanced", "youth", "performance"].includes(candidateId)) {
    try {
      const overview = await api<{ club: { coachOffers: Array<{ id: string; name: string; signingFee: string; weeklySalary: string; trainingSkill: number; recoverySkill: number; medicalSkill: number }> } }>("/v1/club/operations", ctx.from.id);
      const offers = overview.club.coachOffers.map((candidate) => "• " + candidate.id + " · " + candidate.name + " · Fee " + cash(candidate.signingFee) + " · Salary " + cash(candidate.weeklySalary) + "/week · Skills " + candidate.trainingSkill + "/" + candidate.recoverySkill + "/" + candidate.medicalSkill);
      return ctx.reply("Available coaches:\n" + offers.join("\n") + "\n\n/hire-coach balanced|youth|performance");
    } catch (error) { return ctx.reply("Could not load coach candidates: " + (error instanceof Error ? error.message : "unknown error")); }
  }
  try {
    const result = await api<{ hiring: { coach?: { name: string; weeklySalary: string }; signingFee?: string; replayed: boolean } }>(
      "/v1/club/coach/hire", ctx.from.id, "POST",
      { candidateId, idempotencyKey: `tg-coach-hire-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.hiring.replayed ? "This coach hiring request was already processed." : `Hired ${result.hiring.coach?.name}. Signing fee: ${cash(result.hiring.signingFee ?? "0")} Cash · Weekly salary: ${cash(result.hiring.coach?.weeklySalary ?? "0")} Cash.`);
  } catch (error) { await ctx.reply(`Coach hiring failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("market", async (ctx) => {
  if (!ctx.from) return;
  try {
    const result = await api<{ listings: ApiListing[] }>("/v1/market/listings", ctx.from.id);
    if (!result.listings.length) return ctx.reply("There are no active transfer listings right now.");
    const lines = result.listings.map((item) =>
      `• ${playerName(item.player)} | ${item.player.position} | OVR ${item.player.overall}\n  ${cash(item.askingPrice)} Cash · ${item.sellerClub?.name ?? "Club"}\n  Listing ID: ${item.id}`,
    );
    await ctx.reply("Transfer market:\n\n" + lines.join("\n\n") + "\n\nBuy with /buy LISTING_ID");
  } catch (error) { await ctx.reply(`Could not load market: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("special", async (ctx) => {
  if (!ctx.from) return;
  try {
    const result = await api<{ players: Array<{ fullName: string; rarity: string; overall: number }>; packOffers: Array<{ method: string; rarity: string; priceGold: string }> }>("/v1/players/special", ctx.from.id);
    const offers = result.packOffers.map((offer) => `• ${offer.rarity}: ${offer.priceGold} Gold — /pack ${offer.method.replace("_pack", "")}`);
    const featured = result.players.slice(0, 10).map((player) => `• ${player.fullName} | ${player.rarity} | OVR ${player.overall}`);
    await ctx.reply("Special player packs:\n" + offers.join("\n") + "\n\nFeatured players:\n" + featured.join("\n"));
  } catch (error) { await ctx.reply(`Could not load special players: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("pack", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /pack in a private chat to acquire a special player.");
  const requested = String(ctx.match ?? "").trim().toLowerCase();
  const method = ({ epic: "epic_pack", legendary: "legendary_pack", icon: "icon_pack" } as const)[requested as "epic" | "legendary" | "icon"];
  if (!method) return ctx.reply("Usage: /pack epic|legendary|icon");
  try {
    const result = await api<{ acquisition: { specialPlayer: { fullName: string; rarity: string; overall: number }; goldBalance: string; replayed: boolean } }>("/v1/players/special/acquire", ctx.from.id, "POST", { method, idempotencyKey: `tg-${ctx.from.id}-${ctx.update.update_id}` });
    const item = result.acquisition.specialPlayer;
    await ctx.reply(`Acquired ${item.fullName} (${item.rarity}, OVR ${item.overall})!\nRemaining Gold: ${cash(result.acquisition.goldBalance)}${result.acquisition.replayed ? "\nThis was a repeated request." : ""}`);
  } catch (error) { await ctx.reply(`Could not acquire a player: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("sell", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /sell in a private chat to list a player.");
  const parts = String(ctx.match ?? "").trim().split(/\s+/);
  const [playerId, price] = parts;
  if (!playerId || !price || !/^[1-9][0-9]{0,14}$/.test(price)) {
    return ctx.reply("Usage: /sell PLAYER_ID PRICE\nUse /players to find your player IDs.");
  }
  try {
    const result = await api<{ listing: { id: string; askingPrice: string } }>("/v1/market/listings", ctx.from.id, "POST", {
      playerId, askingPrice: price, expiresInHours: 72,
    });
    await ctx.reply(`Listing created. Asking price: ${cash(result.listing.askingPrice)} Cash\nListing ID: ${result.listing.id}`);
  } catch (error) { await ctx.reply(`Could not create listing: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("buy", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /buy in a private chat to buy a player.");
  const listingId = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!listingId) return ctx.reply("Usage: /buy LISTING_ID\nUse /market to see available listings.");
  try {
    const result = await api<{ purchase: { price: string; replayed: boolean } }>(
      `/v1/market/listings/${encodeURIComponent(listingId)}/buy`, ctx.from.id, "POST",
    );
    await ctx.reply(`Purchase completed. Paid ${cash(result.purchase.price)} Cash.${result.purchase.replayed ? " This was an already completed purchase." : ""}`);
  } catch (error) { await ctx.reply(`Could not complete purchase: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("opponents", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ opponents: Array<{ id: string; name: string; level: number; reputation: number }> }>("/v1/matches/opponents", ctx.from.id);
    const lines = result.opponents.map((club) => `• ${club.name} · Level ${club.level} · Rep ${club.reputation}\n  ID: ${club.id}`);
    await ctx.reply("Clubs ready for a friendly:\n" + (lines.join("\n\n") || "No eligible opponents yet.") + "\n\n/friendly CLUB_ID");
  } catch (error) { await ctx.reply(`Could not load opponents: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("friendly", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const opponentClubId = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!opponentClubId) return ctx.reply("Usage: /friendly CLUB_ID\nUse /opponents to find a club.");
  try {
    const result = await api<{ match: { id: string; scheduledAt: string }; replayed: boolean }>("/v1/matches/friendly", ctx.from.id, "POST", {
      opponentClubId, idempotencyKey: `bot-friendly-${ctx.from.id}-${ctx.update.update_id}`,
    });
    await ctx.reply(`Friendly scheduled. Match ID: ${result.match.id}\nKickoff: ${new Date(result.match.scheduledAt).toLocaleString("en-US")}\nUse /play ${result.match.id} when kickoff is due.`);
  } catch (error) { await ctx.reply(`Could not schedule friendly: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("matches", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ matches: Array<{ id: string; type: string; status: string; scheduledAt: string; homeClub: { name: string }; awayClub: { name: string }; homeScore: number | null; awayScore: number | null; homePenalties: number | null; awayPenalties: number | null; attendance: number; events: Array<{ minute: number; type: string; playerName: string; relatedPlayerName: string | null }> }> }>("/v1/matches", ctx.from.id);
    const lines = result.matches.map((match) => {
      const goals = match.events.filter((event) => event.type === "GOAL").map((event) => String(event.minute) + "′ " + event.playerName + (event.relatedPlayerName ? " (assist: " + event.relatedPlayerName + ")" : ""));
      return `• ${match.homeClub.name} ${match.homeScore ?? "–"} : ${match.awayScore ?? "–"} ${match.awayClub.name}${match.homePenalties !== null ? " (pens " + match.homePenalties + "–" + match.awayPenalties + ")" : ""}\n  ${match.type} · ${match.status} · ${new Date(match.scheduledAt).toLocaleString("en-US")}\n  ${goals.join(" · ")}\n  ID: ${match.id}`;
    });
    await ctx.reply("Your matches:\n" + (lines.join("\n\n") || "No matches scheduled yet."));
  } catch (error) { await ctx.reply(`Could not load matches: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("play", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const matchId = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!matchId) return ctx.reply("Usage: /play MATCH_ID");
  try {
    const result = await api<{ result: { replayed: boolean; homeClub?: string; awayClub?: string; homeScore: number | null; awayScore: number | null; homePenalties?: number | null; awayPenalties?: number | null; attendance?: number; ticketRevenue?: string; events?: Array<{ minute: number; type: string; detail: string; playerName?: string; relatedPlayerName?: string | null }> } }>(`/v1/matches/${encodeURIComponent(matchId)}/simulate`, ctx.from.id, "POST", {});
    const match = result.result;
    const eventLabels: Record<string, string> = {
      GOAL: "گل", YELLOW_CARD: "کارت زرد", RED_CARD: "کارت قرمز",
      INJURY: "مصدومیت", SUBSTITUTION: "تعویض",
    };
    const events = (match.events ?? []).slice(0, 24).map((event) => {
      const label = eventLabels[event.type] ?? event.type;
      const related = event.type === "SUBSTITUTION"
        ? (event.relatedPlayerName ? " · ورود: " + event.relatedPlayerName : "")
        : event.relatedPlayerName ? " · پاس گل: " + event.relatedPlayerName : "";
      return `${event.minute}' · ${label} · ${event.playerName ?? "بازیکن"}${related}`;
    });
    await ctx.reply(
      `${match.homeClub ?? "Home"} ${match.homeScore ?? 0} – ${match.awayScore ?? 0} ${match.awayClub ?? "Away"}${match.homePenalties !== null && match.homePenalties !== undefined ? " (pens " + match.homePenalties + "–" + match.awayPenalties + ")" : ""}\nAttendance: ${match.attendance ?? 0}\nGate revenue: ${cash(match.ticketRevenue ?? "0")} Cash\n${match.replayed ? "Already simulated; no rewards were repeated." : "Full-time."}\n\n${events.join("\n") || "No major events."}`,
    );
  } catch (error) { await ctx.reply(`Could not simulate match: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("league", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const parts = String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  const last = parts.at(-1);
  const maxTeams = last && /^\d+$/.test(last) ? Number(parts.pop()) : 8;
  const name = parts.join(" ");
  if (name.length < 3 || name.length > 40 || !Number.isInteger(maxTeams) || maxTeams < 4 || maxTeams > 10) {
    return ctx.reply("Usage: /league LEAGUE NAME [4-10]");
  }
  try {
    const result = await api<{ competition: { id: string; name: string; maxTeams: number }; replayed: boolean }>("/v1/competitions", ctx.from.id, "POST", {
      name, maxTeams, idempotencyKey: `bot-league-${ctx.from.id}-${ctx.update.update_id}`,
    });
    await ctx.reply(`League created: ${result.competition.name}\nID: ${result.competition.id}\nCapacity: ${result.competition.maxTeams} clubs\nInvite other managers with /leagues.`);
  } catch (error) { await ctx.reply(`Could not create league: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("cup", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const parts = String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  const last = parts.at(-1);
  const maxTeams = last && /^\d+$/.test(last) ? Number(parts.pop()) : 4;
  const name = parts.join(" ");
  if (name.length < 3 || name.length > 40 || ![4, 8].includes(maxTeams)) return ctx.reply("Usage: /cup CUP NAME [4|8]");
  try {
    const result = await api<{ competition: { id: string; name: string; maxTeams: number }; replayed: boolean }>("/v1/competitions", ctx.from.id, "POST", {
      name, maxTeams, format: "CUP", idempotencyKey: "bot-cup-" + ctx.from.id + "-" + ctx.update.update_id,
    });
    await ctx.reply("Knockout cup created: " + result.competition.name + "\nID: " + result.competition.id + "\nBracket: " + result.competition.maxTeams + " clubs. Fill all places before starting.");
  } catch (error) { await ctx.reply("Could not create cup: " + (error instanceof Error ? error.message : "unknown error")); }
});
bot.command("leagues", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ competitions: Array<{ id: string; name: string; season: number; format: string; teams: number; maxTeams: number; joined: boolean; isCreator: boolean }> }>("/v1/competitions", ctx.from.id);
    const lines = result.competitions.map((item) =>
      `• ${item.name} · ${item.format === "CUP" ? "Knockout cup" : "League"} · ${item.teams}/${item.maxTeams} clubs · Season ${item.season}${item.joined ? " · joined" : ""}\n  ID: ${item.id}`,
    );
    await ctx.reply("Open competitions:\n" + (lines.join("\n\n") || "No open leagues.") + "\n\n/joinleague ID");
  } catch (error) { await ctx.reply(`Could not load leagues: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("joinleague", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("Usage: /joinleague COMPETITION_ID");
  try {
    const result = await api<{ joined: boolean; replayed: boolean; teams: number }>(`/v1/competitions/${encodeURIComponent(id)}/join`, ctx.from.id, "POST", {});
    await ctx.reply(`You are registered. Clubs in league: ${result.teams}.`);
  } catch (error) { await ctx.reply(`Could not join league: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("startleague", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("Usage: /startleague COMPETITION_ID");
  try {
    const result = await api<{ fixturesCreated: number; rounds: number; teams: number }>(`/v1/competitions/${encodeURIComponent(id)}/start`, ctx.from.id, "POST", {});
    await ctx.reply(`League started with ${result.teams} clubs. ${result.fixturesCreated} fixtures across ${result.rounds} rounds have been scheduled.`);
  } catch (error) { await ctx.reply(`Could not start league: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("startcup", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("Usage: /startcup CUP_ID");
  try {
    const result = await api<{ fixturesCreated: number; rounds: number; teams: number; replayed?: boolean }>(`/v1/competitions/${encodeURIComponent(id)}/start`, ctx.from.id, "POST", {});
    await ctx.reply("Cup started with " + result.teams + " clubs. " + result.fixturesCreated + " first-round fixtures; " + result.rounds + " knockout rounds.");
  } catch (error) { await ctx.reply("Could not start cup: " + (error instanceof Error ? error.message : "unknown error")); }
});
bot.command("table", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("Usage: /table COMPETITION_ID");
  try {
    const result = await api<{ competition: { name: string; status: string; format: string }; standings: Array<{ position: number; clubName: string; played: number; won: number; drawn: number; lost: number; goalDifference: number; points: number }>; matches: Array<{ round: number | null; homeClub: { name: string }; awayClub: { name: string }; homeScore: number | null; awayScore: number | null; homePenalties: number | null; awayPenalties: number | null }> }>(`/v1/competitions/${encodeURIComponent(id)}`, ctx.from.id);
    const rows = result.competition.format === "CUP"
      ? result.matches.map((match) => "Round " + match.round + ": " + match.homeClub.name + " " + (match.homeScore ?? "–") + "–" + (match.awayScore ?? "–") + " " + match.awayClub.name + (match.homePenalties !== null ? " (pens " + match.homePenalties + "–" + match.awayPenalties + ")" : ""))
      : result.standings.map((row) => row.position + ". " + row.clubName + " · Pts " + row.points + " · P " + row.played + " · W " + row.won + " D " + row.drawn + " L " + row.lost + " · GD " + row.goalDifference);
    await ctx.reply(result.competition.name + " · " + result.competition.status + "\n\n" + rows.join("\n"));
  } catch (error) { await ctx.reply("Could not load standings: " + (error instanceof Error ? error.message : "unknown error")); }
});


bot.command("alliance", async ctx => {
  if (!ctx.from || !["group","supergroup"].includes(ctx.chat.type)) return;
  try {
    const d = await api<{alliance:{name:string;treasuryPoints:string;groups:Array<{title:string;memberCount:number}>;seasons:Array<{number:number;status:string;reviewStatus:string}>;competitions:Array<{id:string;name:string;status:string;teams:number}>}|null;invitations:Array<{id:string;alliance:{name:string}}>}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id)),ctx.from.id);
    if (!d.alliance) return ctx.reply("گروه عضو اتحادی نیست. دعوت‌ها:\n"+(d.invitations.length?d.invitations.map(x=>x.id+" · "+x.alliance.name).join("\n"):"دعوتی ندارید."));
    return ctx.reply("اتحاد: "+d.alliance.name+"\nخزانه: "+d.alliance.treasuryPoints+"\nگروه‌ها:\n"+d.alliance.groups.map(x=>x.title+" · "+x.memberCount+" عضو").join("\n")+"\nفصل‌ها: "+d.alliance.seasons.map(x=>"#"+x.number+" "+x.status+" · "+x.reviewStatus).join("، ")+"\nقهرمانی‌ها:\n"+d.alliance.competitions.map(x=>x.id+" · "+x.name+" · "+x.status+" · "+x.teams+" تیم").join("\n"));
  } catch(e) { await ctx.reply("اتحاد در دسترس نیست: "+(e instanceof Error?e.message:"unknown")); }
});
bot.command("alliance-create", async ctx => {
  if (!ctx.from || !["group","supergroup"].includes(ctx.chat.type)) return;
  const name=String(ctx.match??"").trim(); if(name.length<3||name.length>60)return ctx.reply("استفاده: /alliance-create نام اتحاد");
  try { const d=await api<{alliance:{name:string}}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id)),ctx.from.id,"POST",{name,idempotencyKey:"alliance_"+randomUUID().replace(/-/g,"")}); await ctx.reply("اتحاد «"+d.alliance.name+"» ایجاد شد."); }
  catch(e){await ctx.reply("ایجاد اتحاد ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-invite", async ctx => {
  if (!ctx.from || !["group","supergroup"].includes(ctx.chat.type)) return;
  const target=String(ctx.match??"").trim(); if(!/^-?\d{1,20}$/.test(target))return ctx.reply("استفاده: /alliance-invite TELEGRAM_GROUP_ID");
  try { const d=await api<{alliance:{name:string};invitation:{id:string}}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/invitations",ctx.from.id,"POST",{targetTelegramGroupId:target}); await ctx.reply("دعوت ارسال شد؛ شناسه: "+d.invitation.id+" · "+d.alliance.name); }
  catch(e){await ctx.reply("ارسال دعوت ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
for (const [command,accept] of [["alliance-accept",true],["alliance-decline",false]] as const) bot.command(command,async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;
  const id=String(ctx.match??"").trim(); if(!id)return ctx.reply("شناسه دعوت را وارد کنید.");
  try { const d=await api<{accepted:boolean}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/invitations/"+encodeURIComponent(id)+"/respond",ctx.from.id,"POST",{accept}); await ctx.reply(d.accepted?"دعوت اتحاد پذیرفته شد.":"دعوت اتحاد رد شد."); }
  catch(e){await ctx.reply("پاسخ به دعوت ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-championship",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;
  const parts=String(ctx.match??"").trim().split("|"); const name=parts[0]??""; const maxTeams=Number(parts[1]??8);
  if(name.trim().length<3||!Number.isInteger(maxTeams)||maxTeams<4||maxTeams>20)return ctx.reply("استفاده: /alliance-championship نام مسابقات|ظرفیت (۴ تا ۲۰)");
  try { const d=await api<{competition:{id:string;name:string}}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/championships",ctx.from.id,"POST",{name:name.trim(),maxTeams,idempotencyKey:"alliance_comp_"+randomUUID().replace(/-/g,"")}); await ctx.reply("قهرمانی ساخته شد: "+d.competition.name+"\nشناسه: "+d.competition.id); }
  catch(e){await ctx.reply("ساخت قهرمانی ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-championship-join",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return; const id=String(ctx.match??"").trim(); if(!id)return ctx.reply("شناسه قهرمانی را وارد کنید.");
  try { const d=await api<{teams:number}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/championships/"+encodeURIComponent(id)+"/join",ctx.from.id,"POST"); await ctx.reply("ثبت‌نام انجام شد. تعداد تیم‌ها: "+d.teams); }
  catch(e){await ctx.reply("ثبت‌نام ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-championship-start",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return; const id=String(ctx.match??"").trim(); if(!id)return ctx.reply("شناسه قهرمانی را وارد کنید.");
  try { await api("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/championships/"+encodeURIComponent(id)+"/start",ctx.from.id,"POST"); await ctx.reply("قهرمانی آغاز شد."); }
  catch(e){await ctx.reply("شروع قهرمانی ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-season-start",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return; const durationDays=Number(String(ctx.match??"30").trim()); if(!Number.isInteger(durationDays)||durationDays<7||durationDays>90)return ctx.reply("مدت فصل باید بین ۷ تا ۹۰ روز باشد.");
  try { const d=await api<{season:{number:number;endsAt:string}}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/seasons",ctx.from.id,"POST",{durationDays}); await ctx.reply("فصل "+d.season.number+" آغاز شد؛ پایان: "+new Date(d.season.endsAt).toLocaleDateString("fa-IR")); }
  catch(e){await ctx.reply("شروع فصل ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-season-close",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;
  try {
    const d=await api<{standings:Array<{rank:number;group:string;points:string}>;reviewStatus:string;securityFlags?:Array<{code:string;group?:string;sharePercent?:number;groups?:Array<{group:string}>}>;winner?:string|null;prize?:string}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/seasons/close",ctx.from.id,"POST");
    const status=d.reviewStatus==="FLAGGED"?"\nجایزه تا بررسی امنیتی مسدود شد. هشدارها: "+(d.securityFlags??[]).map(x=>x.code==="SINGLE_MEMBER_CONCENTRATION"?x.group+" ("+x.sharePercent+"%)":"هم‌پوشانی "+(x.groups??[]).map(g=>g.group).join("، ")).join("؛ "):"\nوضعیت بررسی: تأیید خودکار";
    await ctx.reply("جدول نهایی فصل:\n"+d.standings.map(x=>x.rank+". "+x.group+" · "+x.points+" امتیاز").join("\n")+status+(d.prize&&d.prize!=="0"?"\nجایزه: "+cash(d.prize):""));
  }
  catch(e){await ctx.reply("بستن فصل ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});

bot.command("alliance-season-review",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;
  const parts=String(ctx.match??"").trim().split(/\s+/);
  const seasonId=parts[0]??"", decision=parts[1]?.toLowerCase();
  if(!seasonId||!["approve","reject"].includes(decision??""))return ctx.reply("استفاده: /alliance-season-review SEASON_ID approve|reject\nفقط بازبین مجاز اتحاد می‌تواند جایزه مشکوک را تأیید یا رد کند.");
  try {
    const d=await api<{reviewStatus:string;winner?:string|null;prize?:string}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/seasons/"+encodeURIComponent(seasonId)+"/review",ctx.from.id,"POST",{decision:decision==="approve"?"APPROVE":"REJECT"});
    await ctx.reply("بررسی امنیتی فصل ثبت شد: "+d.reviewStatus+(d.winner?"\nقهرمان: "+d.winner:"")+(d.prize&&d.prize!=="0"?"\nجایزه پرداخت‌شده: "+cash(d.prize):""));
  } catch(e){await ctx.reply("بررسی فصل ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});

bot.command("alliance-contribute",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;
  const amount=String(ctx.match??"").trim(); if(!/^\\d{1,12}$/.test(amount)||BigInt(amount)<=BigInt(0))return ctx.reply("استفاده: /alliance-contribute AMOUNT");
  try{const d=await api<{treasuryPoints:string}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/treasury/contribute",ctx.from.id,"POST",{amount,idempotencyKey:"alliance_contrib_"+randomUUID().replace(/-/g,"")});await ctx.reply("مشارکت در خزانه اتحاد ثبت شد. موجودی خزانه: "+cash(d.treasuryPoints)+" امتیاز.");}
  catch(e){await ctx.reply("واریز ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});

bot.on(["chat_member","my_chat_member"],async ctx=>{
 if(ctx.chat.type!=="group"&&ctx.chat.type!=="supergroup")return;
 try{const memberCount=await ctx.api.getChatMemberCount(ctx.chat.id);await apiSystem("/v1/groups/system/member-count",{telegramGroupId:String(ctx.chat.id),memberCount});}
 catch(error){console.warn("Could not refresh Telegram group membership:",error instanceof Error?error.message:error);}
});
bot.catch((error) => console.error("Telegram bot error:", error));
await bot.start();
