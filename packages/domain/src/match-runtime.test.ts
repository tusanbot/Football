import assert from "node:assert/strict";
import test from "node:test";
import { canAcquireMatchRuntimeLease,isMatchRuntimeLeaseCurrent,matchRuntimeNextCheckpoint,type MatchRuntimeLease } from "./match-runtime.js";
const now=new Date("2026-11-15T12:00:00.000Z");
test("lease is available when absent or expired",()=>{
 assert.equal(canAcquireMatchRuntimeLease({leaseOwner:null,leaseToken:null,leaseExpiresAt:null},now),true);
 assert.equal(canAcquireMatchRuntimeLease({leaseOwner:"a",leaseToken:"a",leaseExpiresAt:new Date(now.getTime()-1)},now),true);
 assert.equal(canAcquireMatchRuntimeLease({leaseOwner:"a",leaseToken:"a",leaseExpiresAt:new Date(now.getTime()+1)},now),false);
});
test("lease validity requires owner, token and unexpired deadline",()=>{
 const lease:MatchRuntimeLease={owner:"worker-a",token:"lease-1",expiresAt:new Date(now.getTime()+30000)};
 assert.equal(isMatchRuntimeLeaseCurrent({leaseOwner:"worker-a",leaseToken:"lease-1",leaseExpiresAt:lease.expiresAt},lease,now),true);
 assert.equal(isMatchRuntimeLeaseCurrent({leaseOwner:"worker-b",leaseToken:"lease-1",leaseExpiresAt:lease.expiresAt},lease,now),false);
 assert.equal(isMatchRuntimeLeaseCurrent({leaseOwner:"worker-a",leaseToken:"stale",leaseExpiresAt:lease.expiresAt},lease,now),false);
 assert.equal(isMatchRuntimeLeaseCurrent({leaseOwner:"worker-a",leaseToken:"lease-1",leaseExpiresAt:now},lease,now),false);
});
test("server checkpoint timeline is ordered",()=>{
 assert.deepEqual(matchRuntimeNextCheckpoint(0),{minute:45,kind:"HALF_TIME"});
 assert.deepEqual(matchRuntimeNextCheckpoint(45),{minute:60,kind:"MINUTE_60"});
 assert.deepEqual(matchRuntimeNextCheckpoint(60),{minute:75,kind:"MINUTE_75"});
 assert.deepEqual(matchRuntimeNextCheckpoint(75),{minute:90,kind:"FULL_TIME"});
 assert.equal(matchRuntimeNextCheckpoint(90),null);
 assert.throws(()=>matchRuntimeNextCheckpoint(-1),/INVALID_MATCH_RUNTIME_MINUTE/);
});
