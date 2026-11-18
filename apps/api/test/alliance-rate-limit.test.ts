import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../src/db.js";
import { consumeAllianceActionRateLimit } from "../src/groups/alliance-rate-limit.js";
test("alliance action limits are atomic per actor, group and minute",async t=>{if(!process.env.DATABASE_URL){t.skip("DATABASE_URL is only configured in ephemeral PostgreSQL CI.");return;}const id="rate-test-"+randomUUID(),now=new Date("2026-11-14T12:00:00.000Z");try{assert.equal(await consumeAllianceActionRateLimit({telegramUserId:id,telegramGroupId:"-100123",action:"invite",limit:2,now}),true);assert.equal(await consumeAllianceActionRateLimit({telegramUserId:id,telegramGroupId:"-100123",action:"invite",limit:2,now}),true);assert.equal(await consumeAllianceActionRateLimit({telegramUserId:id,telegramGroupId:"-100123",action:"invite",limit:2,now}),false);assert.equal(await consumeAllianceActionRateLimit({telegramUserId:id,telegramGroupId:"-100123",action:"invite",limit:2,now:new Date(now.getTime()+60000)}),true);}finally{await prisma.allianceActionThrottle.deleteMany({where:{key:{startsWith:id}}});}});
