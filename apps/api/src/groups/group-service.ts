import { Prisma, type GroupRole } from "@prisma/client";
import { prisma } from "../db.js";
import { joinLeague, startLeague } from "../game/match-service.js";
import { getGroupMembershipPort, GroupMembershipPortError } from "./group-membership-context.js";

export class GroupServiceError extends Error {
  constructor(readonly code: string) { super(code); this.name = "GroupServiceError"; }
}

const MIN_TELEGRAM_MEMBERS = 10;
function settingInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
async function getIntegerSetting(tx: Prisma.TransactionClient, key: string, fallback: number, minimum: number, maximum: number) {
  const setting = await tx.gameSetting.findUnique({ where: { key }, select: { value: true } });
  return settingInteger(setting?.value, fallback, minimum, maximum);
}
async function requireClubOwner(tx: Prisma.TransactionClient, telegramId: string) {
  const user = await tx.user.findUnique({ where: { telegramId }, select: { id: true, club: { select: { id: true } } } });
  if (!user) throw new GroupServiceError("ACCOUNT_NOT_FOUND");
  if (!user.club) throw new GroupServiceError("CLUB_NOT_FOUND");
  return user;
}

export async function registerTelegramGroup(input: { telegramUserId: string; telegramGroupId: string; title: string; role: Extract<GroupRole, "OWNER" | "ADMIN">; memberCount: number }) {
  const port = getGroupMembershipPort();
  if (port) {
    try { return await port.registerGroup(input); }
    catch (error) { if (error instanceof GroupMembershipPortError) throw new GroupServiceError(error.code); throw error; }
  }
  return prisma.$transaction(async (tx) => {
    const minimumMembers = await getIntegerSetting(tx, "groups.minimumMembers", MIN_TELEGRAM_MEMBERS, 5, 1000);
    if (input.memberCount < minimumMembers) throw new GroupServiceError("GROUP_MINIMUM_MEMBERS_REQUIRED");
    const user = await requireClubOwner(tx, input.telegramUserId);
    const existingGroup = await tx.telegramGroup.findUnique({ where: { telegramId: input.telegramGroupId }, select: { isSuspended: true } });
    if (existingGroup?.isSuspended) throw new GroupServiceError("GROUP_SUSPENDED");
    const now = new Date();
    const group = await tx.telegramGroup.upsert({
      where: { telegramId: input.telegramGroupId },
      create: { telegramId: input.telegramGroupId, title: input.title, memberCount: input.memberCount, isActive: true, lastMemberCountCheckAt: now },
      update: { title: input.title, memberCount: input.memberCount, isActive: true, lastMemberCountCheckAt: now },
      select: { id: true, telegramId: true, title: true, memberCount: true, isActive: true, points: true },
    });
    const membership = await tx.groupMembership.upsert({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
      create: { groupId: group.id, userId: user.id, role: input.role },
      update: { role: input.role }, select: { role: true },
    });
    const registeredManagers = await tx.groupMembership.count({ where: { groupId: group.id, role: { in: ["OWNER", "ADMIN"] } } });
    return { group, role: membership.role, registeredManagers, minimumMembers };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function joinTelegramGroup(input: { telegramUserId: string; telegramGroupId: string; memberCount: number }) {
  const port = getGroupMembershipPort();
  if (port) {
    try { return await port.joinGroup(input); }
    catch (error) { if (error instanceof GroupMembershipPortError) throw new GroupServiceError(error.code); throw error; }
  }
  const minimumSetting = await prisma.gameSetting.findUnique({ where: { key: "groups.minimumMembers" }, select: { value: true } });
  const minimumMembers = settingInteger(minimumSetting?.value, MIN_TELEGRAM_MEMBERS, 5, 1000);
  if (input.memberCount < minimumMembers) {
    await prisma.telegramGroup.updateMany({ where: { telegramId: input.telegramGroupId }, data: { memberCount: input.memberCount, isActive: false, lastMemberCountCheckAt: new Date() } });
    throw new GroupServiceError("GROUP_MINIMUM_MEMBERS_REQUIRED");
  }
  return prisma.$transaction(async (tx) => {
    const user = await requireClubOwner(tx, input.telegramUserId);
    const group = await tx.telegramGroup.findUnique({ where: { telegramId: input.telegramGroupId }, select: { id: true, telegramId: true, title: true, isActive: true } });
    if (!group) throw new GroupServiceError("GROUP_NOT_REGISTERED");
    if (!group.isActive) throw new GroupServiceError("GROUP_INACTIVE");
    const existing = await tx.groupMembership.findUnique({ where: { groupId_userId: { groupId: group.id, userId: user.id } }, select: { id: true } });
    const membership = await tx.groupMembership.upsert({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
      create: { groupId: group.id, userId: user.id, role: "MEMBER" }, update: {}, select: { role: true },
    });
    await tx.telegramGroup.update({ where: { id: group.id }, data: { memberCount: input.memberCount, lastMemberCountCheckAt: new Date() } });
    const registeredManagers = await tx.groupMembership.count({ where: { groupId: group.id, role: { in: ["OWNER", "ADMIN"] } } });
    return { group, role: membership.role, registeredManagers, alreadyJoined: Boolean(existing), memberCount: input.memberCount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function awardDailyGroupActivity(input: { telegramUserId: string; telegramGroupId: string }) {
  const port = getGroupMembershipPort();
  if (port) { try { return await port.awardActivity({ ...input, activityType: "DAILY_ACTIVITY" }); } catch (error) { if (error instanceof GroupMembershipPortError) throw new GroupServiceError(error.code); throw error; } }
  return prisma.$transaction(async (tx) => {
    const user = await requireClubOwner(tx, input.telegramUserId);
    const group = await tx.telegramGroup.findUnique({ where: { telegramId: input.telegramGroupId }, select: { id: true, isActive: true, points: true, memberships: { where: { userId: user.id }, select: { id: true } } } });
    if (!group) throw new GroupServiceError("GROUP_NOT_REGISTERED");
    if (!group.isActive) throw new GroupServiceError("GROUP_INACTIVE");
    if (group.memberships.length === 0) throw new GroupServiceError("NOT_GROUP_MEMBER");
    const day = utcDayStart().toISOString().slice(0, 10);
    const idempotencyKey = `group-daily-activity:${group.id}:${user.id}:${day}`;
    const existing = await tx.groupPointLedger.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) return { awarded: false, replayed: true, points: group.points.toString(), award: "0" };
    const [reward, dailyCap] = await Promise.all([
      getIntegerSetting(tx, "groups.dailyActivityPoints", 1, 0, 1000).then(BigInt),
      getIntegerSetting(tx, "groups.dailyPointCap", GROUP_DAILY_POINT_CAP, 0, 100_000),
    ]);
    const earned = await earnedGroupPointsToday(tx, group.id, user.id);
    if (earned >= BigInt(dailyCap)) return { awarded: false, replayed: false, capped: true, points: group.points.toString(), award: "0" };
    if (reward === 0n) return { awarded: false, replayed: false, disabled: true, points: group.points.toString(), award: "0" };
    const remaining = BigInt(dailyCap) - earned;
    const award = reward < remaining ? reward : remaining;
    if (award <= 0n) return { awarded: false, replayed: false, capped: true, points: group.points.toString(), award: "0" };
    await tx.groupPointLedger.create({ data: { idempotencyKey, groupId: group.id, userId: user.id, amount: award, source: "DAILY_ACTIVITY", description: "Daily member activity" } });
    const updated = await tx.telegramGroup.update({ where: { id: group.id }, data: { points: { increment: award } }, select: { points: true } });
    return { awarded: true, replayed: false, points: updated.points.toString(), award: award.toString(), dailyCap };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}


const SHOP_ITEMS=[{slug:"group-banner",name:"Group Banner",description:"Shared group identity reward",cost:100n,scope:"GROUP"},{slug:"member-spotlight",name:"Member Spotlight",description:"Personal member recognition",cost:60n,scope:"PERSONAL"},{slug:"club-badge",name:"Club Recognition",description:"Personal club recognition",cost:120n,scope:"PERSONAL"}] as const;
async function groupMember(tx:Prisma.TransactionClient,telegramId:string,groupTelegramId:string,admin=false,requireActive=true){
 const user=await requireClubOwner(tx,telegramId),group=await tx.telegramGroup.findUnique({where:{telegramId:groupTelegramId},select:{id:true,telegramId:true,title:true,memberCount:true,isActive:true,points:true,lastMemberCountCheckAt:true}});
 if(!group)throw new GroupServiceError("GROUP_NOT_REGISTERED");if(requireActive&&!group.isActive)throw new GroupServiceError("GROUP_INACTIVE");
 const membership=await tx.groupMembership.findUnique({where:{groupId_userId:{groupId:group.id,userId:user.id}}});
 if(!membership)throw new GroupServiceError("NOT_GROUP_MEMBER");if(admin&&membership.role==="MEMBER")throw new GroupServiceError("GROUP_MANAGER_REQUIRED");
 return {user,group,membership};
}
export async function listGroupShop(telegramId:string,groupTelegramId:string){return prisma.$transaction(async tx=>{const {group}=await groupMember(tx,telegramId,groupTelegramId);for(const i of SHOP_ITEMS)await tx.groupRewardItem.upsert({where:{slug:i.slug},create:{...i},update:{}});const items=await tx.groupRewardItem.findMany({where:{active:true},orderBy:{cost:"asc"}});return {points:group.points.toString(),items:items.map(i=>({slug:i.slug,name:i.name,description:i.description,cost:i.cost.toString(),scope:i.scope}))};});}
export async function purchaseGroupReward(i:{telegramUserId:string;telegramGroupId:string;itemSlug:string;recipientTelegramId?:string;idempotencyKey:string}){
 if(!/^[A-Za-z0-9:_-]{12,128}$/.test(i.idempotencyKey))throw new GroupServiceError("INVALID_IDEMPOTENCY_KEY");
 return prisma.$transaction(async tx=>{const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId,true),item=await tx.groupRewardItem.findUnique({where:{slug:i.itemSlug}});
 if(!item?.active)throw new GroupServiceError("GROUP_REWARD_NOT_FOUND");
 const recipient=i.recipientTelegramId?await tx.user.findUnique({where:{telegramId:i.recipientTelegramId},select:{id:true}}):null;
 if(item.scope==="PERSONAL"){if(!recipient)throw new GroupServiceError("RECIPIENT_REQUIRED");const m=await tx.groupMembership.findUnique({where:{groupId_userId:{groupId:group.id,userId:recipient.id}}});if(!m)throw new GroupServiceError("RECIPIENT_NOT_GROUP_MEMBER");}else if(i.recipientTelegramId)throw new GroupServiceError("GROUP_ITEM_HAS_NO_RECIPIENT");
 const old=await tx.groupRewardGrant.findUnique({where:{idempotencyKey:i.idempotencyKey}});if(old){if(old.groupId!==group.id||old.itemId!==item.id||old.grantedByUserId!==user.id||old.recipientUserId!==(recipient?.id??null))throw new GroupServiceError("IDEMPOTENCY_CONFLICT");return {purchased:true,replayed:true,item:item.name,grantId:old.id,points:group.points.toString()};}
 const debit=await tx.telegramGroup.updateMany({where:{id:group.id,points:{gte:item.cost}},data:{points:{decrement:item.cost}}});if(!debit.count)throw new GroupServiceError("INSUFFICIENT_GROUP_POINTS");
 await tx.groupPointLedger.create({data:{idempotencyKey:"shop:"+i.idempotencyKey,groupId:group.id,userId:user.id,amount:-item.cost,source:"SHOP_PURCHASE",description:"Purchased "+item.name}});
 const grant=await tx.groupRewardGrant.create({data:{idempotencyKey:i.idempotencyKey,groupId:group.id,itemId:item.id,grantedByUserId:user.id,recipientUserId:recipient?.id??null}});
 const balance=await tx.telegramGroup.findUniqueOrThrow({where:{id:group.id},select:{points:true}});return {purchased:true,replayed:false,item:item.name,grantId:grant.id,points:balance.points.toString()};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function listGroupChallenges(telegramId:string,groupTelegramId:string){const g=await prisma.$transaction(async tx=>(await groupMember(tx,telegramId,groupTelegramId)).group);const rows=await prisma.groupChallenge.findMany({where:{groupId:g.id},include:{_count:{select:{participants:true}}},orderBy:{createdAt:"desc"},take:20});return {challenges:rows.map(c=>({id:c.id,title:c.title,status:c.status,startsAt:c.startsAt,endsAt:c.endsAt,rewardPoints:c.rewardPoints.toString(),participants:c._count.participants}))};}
export async function createGroupChallenge(i:{telegramUserId:string;telegramGroupId:string;title:string;startsAt:Date;endsAt:Date;rewardPoints:bigint;idempotencyKey:string}){if(!/^[A-Za-z0-9:_-]{12,128}$/.test(i.idempotencyKey))throw new GroupServiceError("INVALID_IDEMPOTENCY_KEY");return prisma.$transaction(async tx=>{const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId,true);const old=await tx.groupChallenge.findUnique({where:{idempotencyKey:i.idempotencyKey}});if(old){if(old.groupId!==group.id||old.createdByUserId!==user.id||old.title!==i.title||old.startsAt?.getTime()!==i.startsAt.getTime()||old.endsAt?.getTime()!==i.endsAt.getTime()||old.rewardPoints!==i.rewardPoints)throw new GroupServiceError("IDEMPOTENCY_CONFLICT");return {challenge:{id:old.id,title:old.title,status:old.status,rewardPoints:old.rewardPoints.toString(),startsAt:old.startsAt,endsAt:old.endsAt},replayed:true};}if(i.endsAt<=i.startsAt||i.startsAt<new Date(Date.now()-60000)||i.endsAt.getTime()-i.startsAt.getTime()>30*86400000)throw new GroupServiceError("INVALID_CHALLENGE_WINDOW");if(i.rewardPoints<0n||i.rewardPoints>group.points)throw new GroupServiceError("INVALID_CHALLENGE_REWARD");if(i.rewardPoints>0n){const debited=await tx.telegramGroup.updateMany({where:{id:group.id,points:{gte:i.rewardPoints}},data:{points:{decrement:i.rewardPoints}}});if(!debited.count)throw new GroupServiceError("INSUFFICIENT_GROUP_POINTS");await tx.groupPointLedger.create({data:{idempotencyKey:"challenge:"+i.idempotencyKey+":reserve",groupId:group.id,userId:user.id,amount:-i.rewardPoints,source:"CHALLENGE_REWARD",description:"Reserved prize for group challenge"}});}const c=await tx.groupChallenge.create({data:{groupId:group.id,title:i.title,status:"OPEN",startsAt:i.startsAt,endsAt:i.endsAt,rewardPoints:i.rewardPoints,createdByUserId:user.id,idempotencyKey:i.idempotencyKey}});return {challenge:{id:c.id,title:c.title,status:c.status,rewardPoints:c.rewardPoints.toString(),startsAt:c.startsAt,endsAt:c.endsAt},replayed:false};},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function joinGroupChallenge(i:{telegramUserId:string;telegramGroupId:string;challengeId:string}){return prisma.$transaction(async tx=>{const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId),c=await tx.groupChallenge.findFirst({where:{id:i.challengeId,groupId:group.id}});if(!c)throw new GroupServiceError("CHALLENGE_NOT_FOUND");const now=new Date();if(c.status!=="OPEN"||(c.startsAt&&c.startsAt>now)||(c.endsAt&&c.endsAt<=now))throw new GroupServiceError("CHALLENGE_NOT_OPEN");const p=await tx.groupChallengeParticipant.upsert({where:{challengeId_userId:{challengeId:c.id,userId:user.id}},create:{challengeId:c.id,userId:user.id},update:{}});return {joined:true,participantId:p.id};},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function completeGroupChallenge(i:{telegramUserId:string;telegramGroupId:string;challengeId:string;winnerTelegramId:string}){return prisma.$transaction(async tx=>{const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId,true,false),c=await tx.groupChallenge.findFirst({where:{id:i.challengeId,groupId:group.id},include:{participants:true}});if(!c)throw new GroupServiceError("CHALLENGE_NOT_FOUND");if(c.status==="COMPLETED")return {completed:true,replayed:true,points:group.points.toString()};if(c.status!=="OPEN"||(c.endsAt&&c.endsAt>new Date()))throw new GroupServiceError("CHALLENGE_NOT_READY");const winner=await tx.user.findUnique({where:{telegramId:i.winnerTelegramId},select:{id:true}});if(!winner||!c.participants.some(p=>p.userId===winner.id))throw new GroupServiceError("WINNER_NOT_PARTICIPANT");const changed=await tx.groupChallenge.updateMany({where:{id:c.id,status:"OPEN"},data:{status:"COMPLETED"}});if(!changed.count)throw new GroupServiceError("CHALLENGE_ALREADY_SETTLED");if(c.rewardPoints>0n){await tx.groupMemberRewardBalance.upsert({where:{groupId_userId:{groupId:group.id,userId:winner.id}},create:{groupId:group.id,userId:winner.id,balance:c.rewardPoints},update:{balance:{increment:c.rewardPoints}}});await tx.groupPointLedger.create({data:{idempotencyKey:"challenge:"+c.id+":winner:"+winner.id,groupId:group.id,userId:winner.id,amount:c.rewardPoints,source:"CHALLENGE_REWARD",description:"Challenge winner reward"}});}const balance=await tx.telegramGroup.findUniqueOrThrow({where:{id:group.id},select:{points:true}});return {completed:true,replayed:false,winnerTelegramId:i.winnerTelegramId,points:balance.points.toString()};},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function checkTelegramGroupMembers(groupTelegramId:string,memberCount:number,botPresent=true){const port=getGroupMembershipPort();if(port){try{return await port.checkMemberCount({telegramGroupId:groupTelegramId,memberCount,botPresent});}catch(error){if(error instanceof GroupMembershipPortError)throw new GroupServiceError(error.code);throw error;}}const [group,minimumMembers]=await Promise.all([prisma.telegramGroup.findUnique({where:{telegramId:groupTelegramId},select:{id:true,isSuspended:true}}),prisma.gameSetting.findUnique({where:{key:"groups.minimumMembers"},select:{value:true}})]);const required=settingInteger(minimumMembers?.value,MIN_TELEGRAM_MEMBERS,5,1000);if(!group)return {found:false,isActive:false,memberCount,minimumMembers:required};const active=memberCount>=required&&botPresent&&!group.isSuspended;await prisma.telegramGroup.update({where:{id:group.id},data:{memberCount,isActive:active,lastMemberCountCheckAt:new Date()}});return {found:true,isActive:active,memberCount,minimumMembers:required};}
export async function createGroupLeague(i:{telegramUserId:string;telegramGroupId:string;name:string;maxTeams:number;idempotencyKey:string}){if(!/^[A-Za-z0-9:_-]{12,128}$/.test(i.idempotencyKey))throw new GroupServiceError("INVALID_IDEMPOTENCY_KEY");return prisma.$transaction(async tx=>{const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId,true),club=await tx.club.findUnique({where:{ownerId:user.id},select:{id:true}});if(!club)throw new GroupServiceError("CLUB_NOT_FOUND");const old=await tx.competition.findUnique({where:{idempotencyKey:i.idempotencyKey}});if(old){if(old.groupId!==group.id||old.createdByClubId!==club.id||old.name!==i.name||old.maxTeams!==i.maxTeams)throw new GroupServiceError("IDEMPOTENCY_CONFLICT");return {competition:old,replayed:true};}const competition=await tx.competition.create({data:{idempotencyKey:i.idempotencyKey,name:i.name,season:new Date().getUTCFullYear(),format:"LEAGUE",maxTeams:i.maxTeams,createdByClubId:club.id,groupId:group.id,entries:{create:{clubId:club.id}}}});return {competition,replayed:false};},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function joinGroupLeague(i:{telegramUserId:string;telegramGroupId:string;competitionId:string}){
  const access = await prisma.$transaction(async tx => {
    const { user, group } = await groupMember(tx, i.telegramUserId, i.telegramGroupId);
    const competition = await tx.competition.findFirst({ where: { id: i.competitionId, groupId: group.id }, select: { id: true } });
    if (!competition) throw new GroupServiceError("COMPETITION_NOT_FOUND");
    return { userId: user.id, competitionId: competition.id };
  });
  return joinLeague(access.userId, access.competitionId);
}
export async function startGroupLeague(i:{telegramUserId:string;telegramGroupId:string;competitionId:string}){const u=await prisma.user.findUnique({where:{telegramId:i.telegramUserId},select:{id:true,club:{select:{id:true}}}});if(!u?.club)throw new GroupServiceError("CLUB_NOT_FOUND");const g=await prisma.telegramGroup.findUnique({where:{telegramId:i.telegramGroupId},select:{id:true,isActive:true,memberships:{where:{userId:u.id},select:{role:true}}}});if(!g)throw new GroupServiceError("GROUP_NOT_REGISTERED");if(!g.isActive)throw new GroupServiceError("GROUP_INACTIVE");if(!g.memberships.length||g.memberships[0]!.role==="MEMBER")throw new GroupServiceError("GROUP_MANAGER_REQUIRED");const c=await prisma.competition.findFirst({where:{id:i.competitionId,groupId:g.id},select:{id:true,createdByClubId:true}});if(!c)throw new GroupServiceError("COMPETITION_NOT_FOUND");if(c.createdByClubId!==u.club.id)throw new GroupServiceError("ONLY_CREATOR_CAN_START");return startLeague(u.id,c.id);}
export async function getGroupLeagueTable(telegramId:string,groupTelegramId:string,competitionId:string){const g=await prisma.$transaction(async tx=>(await groupMember(tx,telegramId,groupTelegramId)).group),c=await prisma.competition.findFirst({where:{id:competitionId,groupId:g.id},include:{entries:{include:{club:{select:{name:true}}},orderBy:[{points:"desc"},{goalsFor:"desc"},{goalsAgainst:"asc"}]}}});if(!c)throw new GroupServiceError("COMPETITION_NOT_FOUND");return {competition:{id:c.id,name:c.name,status:c.status,teams:c.entries.map((e,n)=>({rank:n+1,club:e.club.name,played:e.played,won:e.won,drawn:e.drawn,lost:e.lost,goalsFor:e.goalsFor,goalsAgainst:e.goalsAgainst,points:e.points}))}};}


const GROUP_DAILY_POINT_CAP = 3;
const GROUP_ACTIVITY_POINTS = { CHALLENGE_JOIN: 1, CHALLENGE_CREATE: 1, LEAGUE_JOIN: 1, LEAGUE_CREATE: 1, MATCH_PLAYED: 2 } as const;
const GROUP_ACTIVITY_SETTING_KEYS: Record<GroupActivityType, string> = { CHALLENGE_JOIN: "groups.challengeJoinPoints", CHALLENGE_CREATE: "groups.challengeCreatePoints", LEAGUE_JOIN: "groups.leagueJoinPoints", LEAGUE_CREATE: "groups.leagueCreatePoints", MATCH_PLAYED: "groups.matchPlayedPoints" };
type GroupActivityType = keyof typeof GROUP_ACTIVITY_POINTS;
function utcDayStart(now = new Date()) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); }
async function earnedGroupPointsToday(tx: Prisma.TransactionClient, groupId: string, userId: string, now = new Date()) {
 const result = await tx.groupPointLedger.aggregate({where:{groupId,userId,source:{in:["DAILY_ACTIVITY","GAME_ACTIVITY"]},amount:{gt:0n},createdAt:{gte:utcDayStart(now)}},_sum:{amount:true}});
 return result._sum.amount ?? 0n;
}
export async function recordGroupGameActivity(i:{telegramUserId:string;telegramGroupId:string;activityType:GroupActivityType;referenceId:string}) {
 const port = getGroupMembershipPort();
 if (port) { try { return await port.awardActivity(i); } catch (error) { if (error instanceof GroupMembershipPortError) throw new GroupServiceError(error.code); throw error; } }
 if(!Object.hasOwn(GROUP_ACTIVITY_POINTS,i.activityType)||!i.referenceId||i.referenceId.length>80||!/^[A-Za-z0-9:_-]+$/.test(i.referenceId))throw new GroupServiceError("INVALID_GROUP_ACTIVITY");
 return prisma.$transaction(async tx=>{
  const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId);
  const day=utcDayStart().toISOString().slice(0,10),key="group-game:"+group.id+":"+user.id+":"+day+":"+i.activityType+":"+i.referenceId;
  const dailyCap=await getIntegerSetting(tx,"groups.dailyPointCap",GROUP_DAILY_POINT_CAP,0,100_000);
  const old=await tx.groupPointLedger.findUnique({where:{idempotencyKey:key},select:{amount:true}});
  if(old)return {awarded:false,replayed:true,award:old.amount.toString(),points:group.points.toString(),dailyCap};
  const requestedPoints=await getIntegerSetting(tx,GROUP_ACTIVITY_SETTING_KEYS[i.activityType],GROUP_ACTIVITY_POINTS[i.activityType],0,1000);
  const earned=await earnedGroupPointsToday(tx,group.id,user.id),remaining=BigInt(dailyCap)-earned;
  if(remaining<=0n)return {awarded:false,replayed:false,capped:true,award:"0",points:group.points.toString(),dailyCap};
  if(requestedPoints===0)return {awarded:false,replayed:false,disabled:true,award:"0",points:group.points.toString(),dailyCap};
  const requested=BigInt(requestedPoints),award=requested<remaining?requested:remaining;
  await tx.groupPointLedger.create({data:{idempotencyKey:key,groupId:group.id,userId:user.id,amount:award,source:"GAME_ACTIVITY",description:"Verified group game action: "+i.activityType}});
  const updated=await tx.telegramGroup.update({where:{id:group.id},data:{points:{increment:award}},select:{points:true}});
  return {awarded:true,replayed:false,award:award.toString(),points:updated.points.toString(),dailyCap};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function listMyTelegramGroups(userId:string, telegramUserId?: string) {
 const port = getGroupMembershipPort();
 if (port && telegramUserId) { try { return await port.listMyGroups(telegramUserId); } catch (error) { if (error instanceof GroupMembershipPortError) throw new GroupServiceError(error.code); throw error; } }
 const rows=await prisma.groupMembership.findMany({where:{userId},include:{group:{select:{telegramId:true,title:true,memberCount:true,isActive:true,points:true,lastMemberCountCheckAt:true}}},orderBy:{joinedAt:"desc"}});
 return {groups:rows.map(r=>({telegramGroupId:r.group.telegramId,title:r.group.title,role:r.role,memberCount:r.group.memberCount,isActive:r.group.isActive,points:r.group.points.toString(),lastMemberCountCheckAt:r.group.lastMemberCountCheckAt?.toISOString()??null}))};
}
export async function getGroupWorkspace(telegramUserId:string,telegramGroupId:string) {
 const port = getGroupMembershipPort();
 if (port) { try { return await port.getWorkspace(telegramUserId, telegramGroupId); } catch (error) { if (error instanceof GroupMembershipPortError) throw new GroupServiceError(error.code); throw error; } }
 const {user,group,membership}=await prisma.$transaction(async tx=>groupMember(tx,telegramUserId,telegramGroupId,false,false));
 for(const item of SHOP_ITEMS) await prisma.groupRewardItem.upsert({where:{slug:item.slug},create:{...item},update:{}});
 const [balance,grants,ledger,challenges,competitions,items,sharedRewards,treasuryHistory]=await Promise.all([
  prisma.groupMemberRewardBalance.findUnique({where:{groupId_userId:{groupId:group.id,userId:user.id}},select:{balance:true}}),
  prisma.groupRewardGrant.findMany({where:{groupId:group.id,recipientUserId:user.id},include:{item:{select:{name:true,description:true,scope:true}}},orderBy:{createdAt:"desc"},take:30}),
  prisma.groupPointLedger.findMany({where:{groupId:group.id,userId:user.id},orderBy:{createdAt:"desc"},take:30}),
  prisma.groupChallenge.findMany({where:{groupId:group.id},include:{_count:{select:{participants:true}},participants:{where:{userId:user.id},select:{id:true}}},orderBy:{createdAt:"desc"},take:30}),
  prisma.competition.findMany({where:{groupId:group.id},include:{_count:{select:{entries:true}},entries:{where:{club:{ownerId:user.id}},select:{id:true}}},orderBy:{createdAt:"desc"},take:20}),
  prisma.groupRewardItem.findMany({where:{active:true},orderBy:{cost:"asc"}}),
  prisma.groupRewardGrant.findMany({where:{groupId:group.id,recipientUserId:null},include:{item:{select:{name:true,description:true}}},orderBy:{createdAt:"desc"},take:30}),
  prisma.groupPointLedger.findMany({where:{groupId:group.id},include:{user:{select:{displayName:true,telegramId:true}}},orderBy:{createdAt:"desc"},take:30})
 ]);
 return {group:{telegramGroupId,title:group.title,role:membership.role,memberCount:group.memberCount,isActive:group.isActive,points:group.points.toString(),lastMemberCountCheckAt:group.lastMemberCountCheckAt?.toISOString()??null},personal:{points:balance?.balance.toString()??"0",rewards:grants.map(g=>({id:g.id,item:g.item.name,description:g.item.description,scope:g.item.scope,grantedAt:g.createdAt.toISOString()})),history:ledger.map(l=>({id:l.id,amount:l.amount.toString(),source:l.source,description:l.description,createdAt:l.createdAt.toISOString()}))},sharedRewards:sharedRewards.map(g=>({id:g.id,item:g.item.name,description:g.item.description,grantedAt:g.createdAt.toISOString()})),treasuryHistory:treasuryHistory.map(l=>({id:l.id,amount:l.amount.toString(),source:l.source,description:l.description,actor:l.user?.displayName??l.user?.telegramId??"System",createdAt:l.createdAt.toISOString()})),shop:items.map(i=>({slug:i.slug,name:i.name,description:i.description,cost:i.cost.toString(),scope:i.scope})),challenges:challenges.map(c=>({id:c.id,title:c.title,status:c.status,startsAt:c.startsAt?.toISOString()??null,endsAt:c.endsAt?.toISOString()??null,rewardPoints:c.rewardPoints.toString(),participants:c._count.participants,joined:c.participants.length>0,createdByMe:c.createdByUserId===user.id})),leagues:competitions.map(c=>({id:c.id,name:c.name,status:c.status,maxTeams:c.maxTeams,teams:c._count.entries,joined:c.entries.length>0,createdByMe:c.createdByClubId===user.club?.id}))};
}
export async function cancelGroupChallenge(i:{telegramUserId:string;telegramGroupId:string;challengeId:string}) {
 return prisma.$transaction(async tx=>{
  const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId,true),c=await tx.groupChallenge.findFirst({where:{id:i.challengeId,groupId:group.id}});
  if(!c)throw new GroupServiceError("CHALLENGE_NOT_FOUND");
  if(c.status==="CANCELLED")return {cancelled:true,replayed:true,points:group.points.toString()};
  if(c.status!=="OPEN")throw new GroupServiceError("CHALLENGE_ALREADY_SETTLED");
  const changed=await tx.groupChallenge.updateMany({where:{id:c.id,status:"OPEN"},data:{status:"CANCELLED"}});
  if(!changed.count)throw new GroupServiceError("CHALLENGE_ALREADY_SETTLED");
  if(c.rewardPoints>0n){await tx.telegramGroup.update({where:{id:group.id},data:{points:{increment:c.rewardPoints}}});await tx.groupPointLedger.create({data:{idempotencyKey:"challenge:"+c.id+":refund",groupId:group.id,userId:user.id,amount:c.rewardPoints,source:"CHALLENGE_REWARD",description:"Refund for cancelled group challenge"}});}
  const balance=await tx.telegramGroup.findUniqueOrThrow({where:{id:group.id},select:{points:true}});
  return {cancelled:true,replayed:false,points:balance.points.toString()};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function listGroupLeagues(telegramUserId:string,telegramGroupId:string) {
 const {user,group}=await prisma.$transaction(async tx=>groupMember(tx,telegramUserId,telegramGroupId));
 const clubId=user.club?.id;
 if(!clubId)throw new GroupServiceError("CLUB_NOT_FOUND");
 const rows=await prisma.competition.findMany({where:{groupId:group.id},include:{_count:{select:{entries:true}},entries:{where:{clubId},select:{id:true}}},orderBy:{createdAt:"desc"},take:30});
 return {leagues:rows.map(c=>({id:c.id,name:c.name,status:c.status,maxTeams:c.maxTeams,teams:c._count.entries,joined:c.entries.length>0,createdByMe:c.createdByClubId===clubId}))};
}

export async function getTelegramGroupSummary(telegramUserId: string, telegramGroupId: string) {
  const port = getGroupMembershipPort();
  if (port) { try { return await port.getGroupSummary(telegramUserId, telegramGroupId); } catch (error) { if (error instanceof GroupMembershipPortError) throw new GroupServiceError(error.code); throw error; } }
  const user = await prisma.user.findUnique({ where: { telegramId: telegramUserId }, select: { id: true } });
  if (!user) throw new GroupServiceError("ACCOUNT_NOT_FOUND");
  const group = await prisma.telegramGroup.findUnique({
    where: { telegramId: telegramGroupId },
    select: { id: true, telegramId: true, title: true, memberCount: true, isActive: true, points: true, memberships: { where: { userId: user.id }, select: { role: true } } },
  });
  if (!group) throw new GroupServiceError("GROUP_NOT_REGISTERED");
  const membership = group.memberships[0];
  if (!membership) throw new GroupServiceError("NOT_GROUP_MEMBER");
  const registeredManagers = await prisma.groupMembership.count({ where: { groupId: group.id, role: { in: ["OWNER", "ADMIN"] } } });
  return {
    group: { id: group.id, telegramId: group.telegramId, title: group.title, memberCount: group.memberCount, isActive: group.isActive, points: group.points.toString() },
    role: membership.role, registeredManagers, minimumMembers: MIN_TELEGRAM_MEMBERS,
  };
}
