import {performance} from 'node:perf_hooks';

export const STALE_AFTER_MS=15000;
/** @typedef {{utcNow():number, monotonicNow():number}} Clock */
/** @typedef {'fresh'|'last_known'} FreshnessStatus */
/** @typedef {'recent_sync'|'stale'|'resynchronizing'|'receiver_restarted'} FreshnessReason */
/** @type {Clock} */
export const systemClock={utcNow:()=>Date.now(),monotonicNow:()=>performance.now()};

/**
 * Process-local freshness. Only monotonic elapsed time since a committed
 * synchronization in this process can make state fresh: persisted UTC times
 * are reported but never trusted after restart or wall-clock movement.
 * Callers mutate only after the corresponding database commit succeeds.
 * @param {Clock} clock
 */
export function createFreshness(clock=systemClock) {
 /** @type {Map<string,{syncedAt:number,recovering:boolean}>} */
 const worlds=new Map();
 return {
  markSynchronized(worldId) {worlds.set(worldId,{syncedAt:clock.monotonicNow(),recovering:false});},
  markRecovering(worldId) {const state=worlds.get(worldId);if(state)state.recovering=true;},
  /** @returns {{status:FreshnessStatus,reason:FreshnessReason,evaluatedAt:number}} */
  evaluate(worldId,lastSyncAt) {
   const evaluatedAt=clock.utcNow(),state=worlds.get(worldId);
   if(!state||lastSyncAt===null)return {status:'last_known',reason:'receiver_restarted',evaluatedAt};
   if(state.recovering)return {status:'last_known',reason:'resynchronizing',evaluatedAt};
   const age=clock.monotonicNow()-state.syncedAt;
   if(age<0||age>=STALE_AFTER_MS)return {status:'last_known',reason:'stale',evaluatedAt};
   return {status:'fresh',reason:'recent_sync',evaluatedAt};
  }
 };
}
