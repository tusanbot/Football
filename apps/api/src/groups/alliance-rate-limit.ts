import { prisma } from "../db.js";
export async function consumeAllianceActionRateLimit(input:{telegramUserId:string;telegramGroupId:string;action:string;limit:number;now?:Date}):Promise<boolean>{
 const now=input.now??new Date(),windowStart=new Date(Math.floor(now.getTime()/60000)*60000),key=[input.telegramUserId,input.telegramGroupId,input.action].join(":").slice(0,240);
 const affected=await prisma.$executeRaw`
INSERT INTO "AllianceActionThrottle" ("key","windowStart","count","updatedAt") VALUES (${key},${windowStart},1,${now})
ON CONFLICT ("key") DO UPDATE SET "windowStart"=EXCLUDED."windowStart","count"=CASE WHEN "AllianceActionThrottle"."windowStart"=EXCLUDED."windowStart" THEN "AllianceActionThrottle"."count"+1 ELSE 1 END,"updatedAt"=EXCLUDED."updatedAt"
WHERE "AllianceActionThrottle"."windowStart"<>EXCLUDED."windowStart" OR "AllianceActionThrottle"."count"<${input.limit}`;
 return affected===1;
}