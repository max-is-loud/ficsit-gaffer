import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {snapshotDigest} from '../src/protocol.mjs';
export const id=randomUUID;
export const provenance={gameVersion:'513885',smlVersion:'3.12.0',bridgeVersion:'0.1.0',starterCommit:'a'.repeat(40),bridgeSourceSha256:'b'.repeat(64)};
export const SMELTER='/Game/FactoryGame/Buildable/Factory/SmelterMk1/Build_SmelterMk1.Build_SmelterMk1_C';
export const IRON_INGOT='/Game/FactoryGame/Recipes/Smelter/Recipe_IngotIron.Recipe_IngotIron_C';
export const manufacturer=(recipe=IRON_INGOT)=>({recipe,clockSpeed:1,productionBoost:1,powerShards:0,somersloops:0,paused:false});
/** A v2 row; `kind` overrides classPath/category/config (default: a Smelter on Iron Ingot). */
export function row(entityId=id(),position=[0,0,0],kind={}) {
 return {entityId,actorPath:'/test/'+entityId,classPath:SMELTER,category:'manufacturer',config:manufacturer(),...kind,transform:{position,rotation:[0,0,0],scale:[1,1,1]},player:{platform:'Steam',accountId:'private-account',displayName:'Pioneer'}};
}
export function up(seq,r=row(),origin='placed') {return {seq:String(seq),type:'buildable.upsert',entityId:r.entityId,row:r,origin};}
export function remove(seq,entityId) {return {seq:String(seq),type:'buildable.remove',entityId,origin:'placed'};}
/** Controllable UTC and monotonic clock; advance() moves both. */
export function testClock(utc=1_700_000_000_000,mono=1_000) {
 return {utcNow:()=>utc,monotonicNow:()=>mono,set(u,m){utc=u;mono=m;},advance(ms){utc+=ms;mono+=ms;}};
}
/** Disposable store driven through the real ingestion methods. */
export function storeHarness(t,options={}) {
 const dir=mkdtempSync(join(tmpdir(),'foreman-query-')),path=join(dir,'state.db');
 let store=openStore(path,options);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const context={protocol:2,serverId:id(),worldId:id(),epoch:id()};
 const binding={serverId:context.serverId,worldId:context.worldId};
 const request=extra=>({...context,requestId:id(),...extra});
 function hello(latest='0',oldest='0') {const q=request({latestSeq:latest,oldestRetainedSeq:oldest,provenance});delete q.connectionId;const r=store.hello(q,1000);context.connectionId=r.connectionId;return {q,r};}
 function stage(rows) {
  const sorted=[...rows].sort((a,b)=>a.entityId<b.entityId?-1:1),snapshotId=id(),data=sorted.map(r=>JSON.stringify(r)+'\n').join('');
  if(sorted.length)store.stageChunk(request({snapshotId,chunkIndex:0,data}));
  return request({snapshotId,watermark:'0',chunkCount:sorted.length?1:0,rowCount:sorted.length,sha256:snapshotDigest(sorted.length?[Buffer.from(data)]:[])});
 }
 function snapshot(rows=[],watermark='0') {const commit={...stage(rows),watermark};return {commit,reply:store.commitSnapshot(commit,1000)};}
 const exchange=(events=[],commandResults=[])=>store.exchange(request({events,commandResults}),1000);
 const query=(q={})=>store.queryBuildables(binding,q);
 return {get store(){return store;},path,context,binding,request,hello,stage,snapshot,exchange,query,reopen(){store.close();store=openStore(path,options);},offline(fn){store.close();fn(path);store=openStore(path,options);}};
}
