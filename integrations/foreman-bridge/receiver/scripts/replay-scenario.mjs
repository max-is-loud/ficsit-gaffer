#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {request} from 'node:https';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {createReceiver,loadConfig} from '../src/server.mjs';
import {openStore} from '../src/store.mjs';
import {snapshotDigest,MAX_BODY_BYTES} from '../src/protocol.mjs';

const scenarios=['duplicate','outage','snapshot-race','receiver-restart'];
const provenance={gameVersion:'513885',smlVersion:'3.12.0',bridgeVersion:'0.1.0',starterCommit:'0'.repeat(40),bridgeSourceSha256:'0'.repeat(64)};
const row=()=>{const entityId=randomUUID();return {entityId,actorPath:'/Replay/'+entityId,classPath:'/Replay/Constructor',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},player:null};};
const up=(seq,r)=>({seq:String(seq),entityId:r.entityId,type:'constructor.upsert',origin:'placed',row:r});

/** Owns a temporary database and loopback HTTPS listener; never opens config.databasePath.
 * This exercises the real receiver, not gameplay or the native delivery state machine.
 */
export async function runScenario(config,scenario) {
 if(!scenarios.includes(scenario))throw Error('Unknown scenario');
 const dir=mkdtempSync(join(tmpdir(),'foreman-replay-'));let databasePath=join(dir,'receiver.db');
 let store,server,port;
 const context={protocol:1,serverId:config.serverId,worldId:config.worldId,epoch:randomUUID()};
 const q=extra=>({...context,requestId:randomUUID(),...extra});
 async function start() {
  store=openStore(databasePath);server=createReceiver({...config,host:'127.0.0.1',port:0},store);
  server.listen(port??0,'127.0.0.1');await once(server,'listening');port=server.address().port;
 }
 async function stop() {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=undefined;}
  if(store){store.close();store=undefined;}
 }
 function send(path,body) {
  return new Promise((resolve,reject)=>{
   const req=request({host:'127.0.0.1',port,path:'/v1/'+path,method:'POST',ca:config.ca,timeout:5000,headers:{authorization:'Bearer '+config.token,'content-type':'application/json'}},res=>{
    let length=0;const chunks=[];res.on('data',c=>{length+=c.length;if(length>MAX_BODY_BYTES)res.destroy(Error('Response limit'));else chunks.push(c);});
    res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(e){reject(e);}});
   });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Request timeout')));req.end(JSON.stringify(body));
  });
 }
 async function ok(path,body) {const r=await send(path,body);assert.equal(r.status,200,`Unexpected ${path} HTTP status`);return r.body;}
 async function hello(latestSeq='0',oldestRetainedSeq='0') {const body=q({latestSeq,oldestRetainedSeq,provenance});delete body.connectionId;const r=await ok('hello',body);context.connectionId=r.connectionId;return r;}
 async function stage(rows,watermark) {
  rows=[...rows].sort((a,b)=>a.entityId.localeCompare(b.entityId));
  const snapshotId=randomUUID(),data=rows.map(r=>JSON.stringify(r)+'\n').join('');
  if(rows.length)await ok('snapshot/chunk',q({snapshotId,chunkIndex:0,data}));
  return q({snapshotId,watermark,chunkCount:rows.length?1:0,rowCount:rows.length,sha256:snapshotDigest(rows.length?[Buffer.from(data)]:[])});
 }
 const snapshot=async(rows,watermark)=>ok('snapshot/commit',await stage(rows,watermark));
 const exchange=(events=[],commandResults=[])=>ok('exchange',q({events,commandResults}));
 const count=()=>store.current(context.worldId).length;
 const status=()=>store.queryConstructors({serverId:context.serverId,worldId:context.worldId},{});
 function inspect() {
  const db=new DatabaseSync(databasePath,{readOnly:true});
  try {return {eventReceipts:db.prepare("SELECT count(*) AS n FROM receipts WHERE kind='event'").get().n,commands:db.prepare('SELECT count(*) AS n FROM commands').get().n,executedCommands:db.prepare("SELECT count(*) AS n FROM commands WHERE status='executed'").get().n};}finally{db.close();}
 }
 try {
  await start();assert.equal((await hello()).mode,'snapshotRequired');await snapshot([],'0');
  const a=row(),event=up(1,a);await exchange([event]);
  const result={scenario,epoch:context.epoch};
  if(scenario==='duplicate') {
   const retry=await exchange([event]);assert.equal(retry.ackSeq,'1');assert.equal(retry.commands.length,1);
   const receipts=[{commandId:retry.commands[0].commandId,status:'executed'}];
   await exchange([event],receipts);const final=await exchange([event],receipts);
   Object.assign(result,inspect(),{count:count(),pendingCommands:final.commands.length});
   assert.deepEqual([result.count,result.eventReceipts,result.commands,result.executedCommands,result.pendingCommands],[1,1,1,1,0]);
  } else if(scenario==='receiver-restart') {
   await stop();await start();result.restartReason=status().reason;const resume=await hello('1','1');assert.equal(resume.mode,'resume');
   result.resumedHelloReason=status().reason;await exchange();result.syncedStatus=status().status;
   Object.assign(result,{resumeCursor:resume.cursor,count:count()});assert.equal(result.count,1);assert.equal(resume.cursor,'1');
   await stop();databasePath=join(dir,'empty.db');await start();result.emptyDatabaseMode=(await hello('1','1')).mode;assert.equal(result.emptyDatabaseMode,'snapshotRequired');
  } else if(scenario==='snapshot-race') {
   const b=row(),c=row(),commit=await stage([b],'1');result.partialCount=count();assert.deepEqual(store.current(context.worldId),[a]);
   await ok('snapshot/commit',commit);const final=await exchange([up(2,c)]);assert.deepEqual(new Set(store.current(context.worldId).map(r=>r.entityId)),new Set([b.entityId,c.entityId]));
   const stale=await stage([a],'1');result.staleCommitStatus=(await send('snapshot/commit',stale)).status;
   Object.assign(result,{count:count(),cursor:final.ackSeq});assert.equal(result.staleCommitStatus,409);assert.equal(result.count,2);assert.equal(result.cursor,'2');
  } else {
   await stop();await assert.rejects(send('exchange',q({events:[],commandResults:[]})));
   const startTime=performance.now();const b=row();await delay(60000);result.outageMs=performance.now()-startTime;
   await start();const resume=await hello('2','2');assert.equal(resume.mode,'resume');assert.equal(resume.cursor,'1');
   const final=await exchange([up(2,b)]);Object.assign(result,{count:count(),cursor:final.ackSeq});
   const gap=await hello('4','4');assert.equal(gap.mode,'snapshotRequired');result.gapReason=gap.reason;assert.equal(gap.reason,'retention_gap');
   result.gapStatus=status();const c=row();await snapshot([a,b,c],'4');result.recoveredCount=count();result.recoveredStatus=status().status;assert.equal(result.count,2);assert.equal(result.cursor,'2');assert.equal(result.recoveredCount,3);
  }
  return result;
 } finally {await stop();rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const args=process.argv.slice(2);assert.equal(args.length,4);assert.equal(args[0],'--config');assert.equal(args[2],'--scenario');
  const config=loadConfig(args[1]);assert.equal(typeof config.caPath,'string');config.ca=readFileSync(config.caPath);
  console.log(JSON.stringify(await runScenario(config,args[3])));
 } catch {console.error('Replay scenario failed; verify private configuration and scenario assertions.');process.exitCode=1;}
}
