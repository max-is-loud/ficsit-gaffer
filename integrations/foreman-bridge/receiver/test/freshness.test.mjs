import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFreshness,STALE_AFTER_MS} from '../src/freshness.mjs';
function clock(utc=1_700_000_000_000,mono=0) {
 return {utcNow:()=>utc,monotonicNow:()=>mono,set(u,m){utc=u;mono=m;},advance(ms){utc+=ms;mono+=ms;}};
}
const world='00000002-0000-4000-8000-000000000001';
test('stale threshold is 15 seconds',()=>assert.equal(STALE_AFTER_MS,15000));
test('new process treats persisted state as restarted until synchronized',()=>{
 const c=clock(),f=createFreshness(c);
 assert.deepEqual(f.evaluate(world,c.utcNow()-1000),{status:'last_known',reason:'receiver_restarted',evaluatedAt:c.utcNow()});
 assert.deepEqual(f.evaluate(world,null),{status:'last_known',reason:'receiver_restarted',evaluatedAt:c.utcNow()});
});
test('age 14999 ms is fresh and 15000 ms is last known',()=>{
 const c=clock(),f=createFreshness(c);f.markSynchronized(world);const synced=c.utcNow();
 c.advance(14999);assert.deepEqual(f.evaluate(world,synced),{status:'fresh',reason:'recent_sync',evaluatedAt:c.utcNow()});
 c.advance(1);assert.deepEqual(f.evaluate(world,synced),{status:'last_known',reason:'stale',evaluatedAt:c.utcNow()});
});
test('monotonic elapsed time decides freshness despite wall clock moving',()=>{
 const c=clock(1_700_000_000_000,500),f=createFreshness(c);f.markSynchronized(world);
 c.set(1_600_000_000_000,15500);assert.equal(f.evaluate(world,1_700_000_000_000).status,'last_known');
 const d=clock(1_700_000_000_000,500),g=createFreshness(d);g.markSynchronized(world);
 d.set(1_800_000_000_000,600);assert.equal(g.evaluate(world,1_700_000_000_000).status,'fresh');
});
test('known recovery is last known until a later synchronization',()=>{
 const c=clock(),f=createFreshness(c);f.markSynchronized(world);f.markRecovering(world);
 assert.deepEqual(f.evaluate(world,c.utcNow()),{status:'last_known',reason:'resynchronizing',evaluatedAt:c.utcNow()});
 f.markSynchronized(world);assert.equal(f.evaluate(world,c.utcNow()).status,'fresh');
});
test('worlds are tracked independently',()=>{
 const c=clock(),f=createFreshness(c);f.markSynchronized(world);
 assert.equal(f.evaluate('00000002-0000-4000-8000-000000000002',null).reason,'receiver_restarted');
});
