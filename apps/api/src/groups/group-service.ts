import { Prisma, type GroupRole } from "@prisma/client";
import { prisma } from "../db.js";
import { startLeague } from "../game/match-service.js";

export class GroupServiceError extends Error {
  constructor(readonly code: string) { super(code); this.name = "GroupServiceError"; }
}

const MIN_TELEGRAM_MEMBERS = 10;
async function requireClubOwner(tx: Prisma.TransactionClient, telegramId: string) {
  const user = await tx.user.findUnique({ where: { telegramId }, select: { id: true, club: { select: { id: true } } } });
  if (!user) throw new GroupServiceError("ACCOUNT_NOT_FOUND");
  if (!user.club) throw new GroupServiceError("CLUB_NOT_FOUND");
  return user;
}

export async function registerTelegramGroup(input: { telegramUserId: string; telegramGroupId: string; title: string; role: Extract<GroupRole, "OWNER" | "ADMIN">; memberCount: number }) {
  if (input.memberCount < MIN_TELEGRAM_MEMBERS) throw new GroupServiceError("GROUP_MINIMUM_MEMBERS_REQUIRED");
  return prisma.$transaction(async (tx) => {
    const user = await requireClubOwner(tx, input.telegramUserId);
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
    const registeredManagers = await tx.groupMembership.count({ where: { groupId: group.id } });
    return { group, role: membership.role, registeredManagers, minimumMembers: MIN_TELEGRAM_MEMBERS };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function joinTelegramGroup(input: { telegramUserId: string; telegramGroupId: string; memberCount: number }) {
  if (input.memberCount < MIN_TELEGRAM_MEMBERS) {
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
    const registeredManagers = await tx.groupMembership.count({ where: { groupId: group.id } });
    return { group, role: membership.role, registeredManagers, alreadyJoined: Boolean(existing), memberCount: input.memberCount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function awardDailyGroupActivity(input: { telegramUserId: string; telegramGroupId: string }) {
  return prisma.$transaction(async (tx) => {
    const user = await requireClubOwner(tx, input.telegramUserId);
    const group = await tx.telegramGroup.findUnique({ where: { telegramId: input.telegramGroupId }, select: { id: true, isActive: true, points: true, memberships: { where: { userId: user.id }, select: { id: true } } } });
    if (!group) throw new GroupServiceError("GROUP_NOT_REGISTERED");
    if (!group.isActive) throw new GroupServiceError("GROUP_INACTIVE");
    if (group.memberships.length === 0) throw new GroupServiceError("NOT_GROUP_MEMBER");
    const day = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `group-daily-activity:${group.id}:${user.id}:${day}`;
    const existing = await tx.groupPointLedger.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) return { awarded: false, replayed: true, points: group.points.toString(), award: "0" };
    await tx.groupPointLedger.create({ data: { idempotencyKey, groupId: group.id, userId: user.id, amount: 1n, source: "DAILY_ACTIVITY", description: "Daily member activity" } });
    const updated = await tx.telegramGroup.update({ where: { id: group.id }, data: { points: { increment: 1n } }, select: { points: true } });
    return { awarded: true, replayed: false, points: updated.points.toString(), award: "1" };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}


const SHOP_ITEMS=[{slug:"group-banner",name:"Group Banner",description:"Shared group identity reward",cost:100n,scope:"GROUP"},{slug:"member-spotlight",name:"Member Spotlight",description:"Personal member recognition",cost:60n,scope:"PERSONAL"},{slug:"club-badge",name:"Club Recognition",description:"Personal club recognition",cost:120n,scope:"PERSONAL"}] as const;
async function groupMember(tx:Prisma.TransactionClient,telegramId:string,groupTelegramId:string,admin=false){
 const user=await requireClubOwner(tx,telegramId),group=await tx.telegramGroup.findUnique({where:{telegramId:groupTelegramId},select:{id:true,isActive:true,points:true}});
 if(!group)throw new GroupServiceError("GROUP_NOT_REGISTERED");if(!group.isActive)throw new GroupServiceError("GROUP_INACTIVE");
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
export async function createGroupChallenge(i:{telegramUserId:string;telegramGroupId:string;title:string;startsAt:Date;endsAt:Date;rewardPoints:bigint}){return prisma.$transaction(async tx=>{const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId,true);if(i.endsAt<=i.startsAt||i.startsAt<new Date(Date.now()-60000)||i.endsAt.getTime()-i.startsAt.getTime()>30*86400000)throw new GroupServiceError("INVALID_CHALLENGE_WINDOW");if(i.rewardPoints<0n||i.rewardPoints>group.points)throw new GroupServiceError("INVALID_CHALLENGE_REWARD");const c=await tx.groupChallenge.create({data:{groupId:group.id,title:i.title,status:"OPEN",startsAt:i.startsAt,endsAt:i.endsAt,rewardPoints:i.rewardPoints,createdByUserId:user.id}});return {challenge:{id:c.id,title:c.title,status:c.status,rewardPoints:c.rewardPoints.toString(),startsAt:c.startsAt,endsAt:c.endsAt}};},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function joinGroupChallenge(i:{telegramUserId:string;telegramGroupId:string;challengeId:string}){return prisma.$transaction(async tx=>{const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId),c=await tx.groupChallenge.findFirst({where:{id:i.challengeId,groupId:group.id}});if(!c)throw new GroupServiceError("CHALLENGE_NOT_FOUND");const now=new Date();if(c.status!=="OPEN"||(c.startsAt&&c.startsAt>now)||(c.endsAt&&c.endsAt<=now))throw new GroupServiceError("CHALLENGE_NOT_OPEN");const p=await tx.groupChallengeParticipant.upsert({where:{challengeId_userId:{challengeId:c.id,userId:user.id}},create:{challengeId:c.id,userId:user.id},update:{}});return {joined:true,participantId:p.id};},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function completeGroupChallenge(i:{telegramUserId:string;telegramGroupId:string;challengeId:string;winnerTelegramId:string}){return prisma.$transaction(async tx=>{const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId,true),c=await tx.groupChallenge.findFirst({where:{id:i.challengeId,groupId:group.id},include:{participants:true}});if(!c)throw new GroupServiceError("CHALLENGE_NOT_FOUND");if(c.status==="COMPLETED")return {completed:true,replayed:true,points:group.points.toString()};if(c.status!=="OPEN"||(c.endsAt&&c.endsAt>new Date()))throw new GroupServiceError("CHALLENGE_NOT_READY");const winner=await tx.user.findUnique({where:{telegramId:i.winnerTelegramId},select:{id:true}});if(!winner||!c.participants.some(p=>p.userId===winner.id))throw new GroupServiceError("WINNER_NOT_PARTICIPANT");const debit=await tx.telegramGroup.updateMany({where:{id:group.id,points:{gte:c.rewardPoints}},data:{points:{decrement:c.rewardPoints}}});if(!debit.count)throw new GroupServiceError("INSUFFICIENT_GROUP_POINTS");const changed=await tx.groupChallenge.updateMany({where:{id:c.id,status:"OPEN"},data:{status:"COMPLETED"}});if(!changed.count)throw new GroupServiceError("CHALLENGE_ALREADY_SETTLED");if(c.rewardPoints>0n){await tx.groupPointLedger.create({data:{idempotencyKey:"challenge:"+c.id+":debit",groupId:group.id,userId:user.id,amount:-c.rewardPoints,source:"CHALLENGE_REWARD",description:"Challenge treasury payout"}});await tx.groupMemberRewardBalance.upsert({where:{groupId_userId:{groupId:group.id,userId:winner.id}},create:{groupId:group.id,userId:winner.id,balance:c.rewardPoints},update:{balance:{increment:c.rewardPoints}}});await tx.groupPointLedger.create({data:{idempotencyKey:"challenge:"+c.id+":winner:"+winner.id,groupId:group.id,userId:winner.id,amount:c.rewardPoints,source:"CHALLENGE_REWARD",description:"Challenge winner reward"}});}const balance=await tx.telegramGroup.findUniqueOrThrow({where:{id:group.id},select:{points:true}});return {completed:true,replayed:false,winnerTelegramId:i.winnerTelegramId,points:balance.points.toString()};},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function checkTelegramGroupMembers(groupTelegramId:string,memberCount:number){const active=memberCount>=10,r=await prisma.telegramGroup.updateMany({where:{telegramId:groupTelegramId},data:{memberCount,isActive:active,lastMemberCountCheckAt:new Date()}});return {found:r.count===1,isActive:active,memberCount,minimumMembers:10};}
export async function createGroupLeague(i:{telegramUserId:string;telegramGroupId:string;name:string;maxTeams:number;idempotencyKey:string}){if(!/^[A-Za-z0-9:_-]{12,128}$/.test(i.idempotencyKey))throw new GroupServiceError("INVALID_IDEMPOTENCY_KEY");return prisma.$transaction(async tx=>{const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId,true),club=await tx.club.findUnique({where:{ownerId:user.id},select:{id:true}});if(!club)throw new GroupServiceError("CLUB_NOT_FOUND");const old=await tx.competition.findUnique({where:{idempotencyKey:i.idempotencyKey}});if(old){if(old.groupId!==group.id||old.createdByClubId!==club.id)throw new GroupServiceError("IDEMPOTENCY_CONFLICT");return {competition:old,replayed:true};}const competition=await tx.competition.create({data:{idempotencyKey:i.idempotencyKey,name:i.name,season:new Date().getUTCFullYear(),format:"LEAGUE",maxTeams:i.maxTeams,createdByClubId:club.id,groupId:group.id,entries:{create:{clubId:club.id}}}});return {competition,replayed:false};},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function joinGroupLeague(i:{telegramUserId:string;telegramGroupId:string;competitionId:string}){return prisma.$transaction(async tx=>{const {user,group}=await groupMember(tx,i.telegramUserId,i.telegramGroupId),club=await tx.club.findUnique({where:{ownerId:user.id},select:{id:true}});if(!club)throw new GroupServiceError("CLUB_NOT_FOUND");const c=await tx.competition.findFirst({where:{id:i.competitionId,groupId:group.id},include:{entries:true}});if(!c)throw new GroupServiceError("COMPETITION_NOT_FOUND");if(c.status!=="REGISTRATION")throw new GroupServiceError("COMPETITION_NOT_OPEN");if(c.entries.some(e=>e.clubId===club.id))return {joined:true,replayed:true,teams:c.entries.length};if(c.entries.length>=c.maxTeams)throw new GroupServiceError("COMPETITION_FULL");await tx.competitionEntry.create({data:{competitionId:c.id,clubId:club.id}});return {joined:true,replayed:false,teams:c.entries.length+1};},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function startGroupLeague(i:{telegramUserId:string;telegramGroupId:string;competitionId:string}){const u=await prisma.user.findUnique({where:{telegramId:i.telegramUserId},select:{id:true,club:{select:{id:true}}}});if(!u?.club)throw new GroupServiceError("CLUB_NOT_FOUND");const g=await prisma.telegramGroup.findUnique({where:{telegramId:i.telegramGroupId},select:{id:true,isActive:true,memberships:{where:{userId:u.id},select:{role:true}}}});if(!g)throw new GroupServiceError("GROUP_NOT_REGISTERED");if(!g.isActive)throw new GroupServiceError("GROUP_INACTIVE");if(!g.memberships.length||g.memberships[0]!.role==="MEMBER")throw new GroupServiceError("GROUP_MANAGER_REQUIRED");const c=await prisma.competition.findFirst({where:{id:i.competitionId,groupId:g.id},select:{id:true,createdByClubId:true}});if(!c)throw new GroupServiceError("COMPETITION_NOT_FOUND");if(c.createdByClubId!==u.club.id)throw new GroupServiceError("ONLY_CREATOR_CAN_START");return startLeague(u.id,c.id);}
export async function getGroupLeagueTable(telegramId:string,groupTelegramId:string,competitionId:string){const g=await prisma.$transaction(async tx=>(await groupMember(tx,telegramId,groupTelegramId)).group),c=await prisma.competition.findFirst({where:{id:competitionId,groupId:g.id},include:{entries:{include:{club:{select:{name:true}}},orderBy:[{points:"desc"},{goalsFor:"desc"},{goalsAgainst:"asc"}]}}});if(!c)throw new GroupServiceError("COMPETITION_NOT_FOUND");return {competition:{id:c.id,name:c.name,status:c.status,teams:c.entries.map((e,n)=>({rank:n+1,club:e.club.name,played:e.played,won:e.won,drawn:e.drawn,lost:e.lost,goalsFor:e.goalsFor,goalsAgainst:e.goalsAgainst,points:e.points}))}};}

export async function getTelegramGroupSummary(telegramUserId: string, telegramGroupId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId: telegramUserId }, select: { id: true } });
  if (!user) throw new GroupServiceError("ACCOUNT_NOT_FOUND");
  const group = await prisma.telegramGroup.findUnique({
    where: { telegramId: telegramGroupId },
    select: { id: true, telegramId: true, title: true, memberCount: true, isActive: true, points: true, _count: { select: { memberships: true } }, memberships: { where: { userId: user.id }, select: { role: true } } },
  });
  if (!group) throw new GroupServiceError("GROUP_NOT_REGISTERED");
  const membership = group.memberships[0];
  if (!membership) throw new GroupServiceError("NOT_GROUP_MEMBER");
  return {
    group: { id: group.id, telegramId: group.telegramId, title: group.title, memberCount: group.memberCount, isActive: group.isActive, points: group.points.toString() },
    role: membership.role, registeredManagers: group._count.memberships, minimumMembers: MIN_TELEGRAM_MEMBERS,
  };
}
