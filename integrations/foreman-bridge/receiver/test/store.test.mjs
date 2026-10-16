import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../src/store.mjs';
import {snapshotDigest} from '../src/protocol.mjs';
const id = randomUUID;
const provenance={gameVersion:'513885',smlVersion:'3.12.0',bridgeVersion:'0.1.0',starterCommit:'a'.repeat(40),bridgeSourceSha256:'b'.repeat(64)};
function row(entityId=id()) { return {entityId,actorPath:'/test/'+entityId,classPath:'/Game/Build_SmelterMk1.Build_SmelterMk1_C',category:'storage',config:{},transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},player:null}; }
function up(seq,r=row(),origin='placed') {return {seq:String(seq),type:'buildable.upsert',entityId:r.entityId,row:r,origin};}
function setup(t,options) {
 const dir=mkdtempSync(join(tmpdir(),'foreman-store-')),path=join(dir,'state.db');
 let store=openStore(path,options);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 let context={protocol:2,serverId:id(),worldId:id(),epoch:id()};
 const request=extra=>({...context,requestId:id(),...extra});
 const hello=(latest='0',oldest='0')=>{const q=request({latestSeq:latest,oldestRetainedSeq:oldest,provenance});delete q.connectionId;const r=store.hello(q,1000);context.connectionId=r.connectionId;return {q,r};};
 function snapshot(rows=[],watermark='0') {
  const snapshotId=id(),data=rows.map(r=>JSON.stringify(r)+'\n').join('');
  const chunk=request({snapshotId,chunkIndex:0,data});
  if(rows.length) store.stageChunk(chunk);
  const commit=request({snapshotId,watermark,chunkCount:rows.length?1:0,rowCount:rows.length,sha256:snapshotDigest(rows.length?[Buffer.from(data)]:[])});
  return {chunk,commit,reply:store.commitSnapshot(commit,1000)};
 }
 const exchange=(events=[],commandResults=[],now=1000)=>store.exchange(request({events,commandResults}),now);
 const dump=()=>{const db=new DatabaseSync(path);try{return Object.fromEntries(['worlds','epochs','connections','receipts','buildables','snapshots','snapshot_chunks','commands','sync_metadata'].map(n=>[n,db.prepare(`SELECT * FROM ${n}`).all()]));}finally{db.close();}};
 return {get store(){return store;},context,request,hello,snapshot,exchange,dump,reopen(){store.close();store=openStore(path,options);}};
}
test('durable event receipts and hello retry survive reopen',t=>{
 const h=setup(t);const {q,r}=h.hello();assert.equal(r.mode,'snapshotRequired');h.snapshot();
 const event=up(1),first=h.exchange([event]);h.reopen();
 assert.deepEqual(h.store.hello(q,2000),r);
 const again=h.exchange([event],[],2000);assert.equal(again.ackSeq,'1');assert.deepEqual(again.commands,first.commands);
 assert.deepEqual(h.store.current(h.context.worldId),[event.row]);
 assert.equal(h.dump().receipts.filter(x=>x.kind==='event').length,1);
});
test('gap and conflicting duplicate roll back every table',t=>{
 const h=setup(t);h.hello();h.snapshot();const event=up(1);h.exchange([event]);const before=h.dump();
 assert.throws(()=>h.exchange([up(3)]),{code:'sequence_gap',status:409,expectedSeq:'2'});assert.deepEqual(h.dump(),before);
 assert.throws(()=>h.exchange([{...event,row:{...event.row,actorPath:'/changed'}}]),{code:'sequence_conflict',status:409});assert.deepEqual(h.dump(),before);
});
test('commit failure rolls back cursor projection receipt and commands',t=>{
 let fail=false;const h=setup(t,{beforeCommit:()=>{if(fail)throw Error('simulated disk failure');}});h.hello();h.snapshot();const before=h.dump();
 fail=true;assert.throws(()=>h.exchange([up(1)]),{code:'storage_unavailable',status:503});assert.deepEqual(h.dump(),before);
 fail=false;assert.equal(h.exchange([up(1)]).ackSeq,'1');
});
test('incomplete snapshot stays invisible; chunks and commits have durable idempotence',t=>{
 const h=setup(t);h.hello();const initial=row();h.snapshot([initial]);const replacement=row();
 const chunk=h.request({snapshotId:id(),chunkIndex:0,data:JSON.stringify(replacement)+'\n'});
 const reply=h.store.stageChunk(chunk);assert.deepEqual(h.store.current(h.context.worldId),[initial]);
 const retry={...chunk,requestId:id()};assert.deepEqual(h.store.stageChunk(retry),{...reply,requestId:retry.requestId});
});
test('snapshot validation, empty replacement and snapshot-covered replay',t=>{
 const h=setup(t);h.hello();const initial=row();h.snapshot([initial]);
 const replacement=row(),data=JSON.stringify(replacement)+'\n',snapshotId=id();
 const chunk=h.request({snapshotId,chunkIndex:0,data});h.store.stageChunk(chunk);
 assert.throws(()=>h.store.stageChunk({...chunk,data:JSON.stringify(row())+'\n'}),{code:'snapshot_conflict',status:409});
 const commit=h.request({snapshotId,watermark:'5',chunkCount:2,rowCount:2,sha256:snapshotDigest([Buffer.from(data),Buffer.from(data)])});
 assert.throws(()=>h.store.commitSnapshot(commit,1000),{code:'snapshot_incomplete',status:409});
 h.store.stageChunk({...chunk,requestId:id(),chunkIndex:1});
 assert.throws(()=>h.store.commitSnapshot(commit,1000),{code:'snapshot_duplicate',status:409});
 assert.deepEqual(h.store.current(h.context.worldId),[initial]);
 const good=h.snapshot([replacement],'5');h.reopen();assert.deepEqual(h.store.commitSnapshot(good.commit,2000),good.reply);
 assert.throws(()=>h.store.commitSnapshot({...good.commit,watermark:'6'},2000),{code:'request_conflict',status:409});
 assert.equal(h.exchange([up(1)]).commands.length,0);assert.deepEqual(h.store.current(h.context.worldId),[replacement]);
 const next=row();h.exchange([up(6,next),{seq:'7',type:'buildable.remove',entityId:replacement.entityId,origin:'placed'}]);assert.deepEqual(h.store.current(h.context.worldId),[next]);
 h.snapshot([],'7');assert.deepEqual(h.store.current(h.context.worldId),[]);
});
test('bad digest never replaces live state',t=>{
 const h=setup(t);h.hello();h.snapshot();const r=row(),chunk=h.request({snapshotId:id(),chunkIndex:0,data:JSON.stringify(r)+'\n'});h.store.stageChunk(chunk);
 assert.throws(()=>h.store.commitSnapshot(h.request({snapshotId:chunk.snapshotId,watermark:'1',chunkCount:1,rowCount:1,sha256:'a'.repeat(64)}),1000),{code:'snapshot_hash',status:409});assert.deepEqual(h.store.current(h.context.worldId),[]);
});
test('epoch retirement archives projection and fences stale writers/hello',t=>{
 const h=setup(t);const old=h.hello();const r=row();h.snapshot([r]);const oldWrite=h.request({events:[],commandResults:[]});
 h.context.epoch=id();delete h.context.connectionId;h.hello();assert.deepEqual(h.store.current(h.context.worldId),[r]);h.snapshot([r]);
 assert.ok(h.dump().buildables.some(x=>x.epoch===old.q.epoch));
 assert.throws(()=>h.store.exchange(oldWrite,1000),{code:'stale_connection',status:409});
 assert.throws(()=>h.store.hello(old.q,1000),{code:'retired_epoch',status:409});h.snapshot([r]);assert.equal(h.store.current(h.context.worldId).length,1);
});
test('new hello fences old connections without replaying superseded hello',t=>{
 const h=setup(t);const old=h.hello();h.snapshot();const stale=h.request({events:[],commandResults:[]});
 const fresh=h.hello();assert.notEqual(fresh.r.connectionId,old.r.connectionId);assert.equal(fresh.r.mode,'resume');
 assert.throws(()=>h.store.exchange(stale,1000),{code:'stale_connection',status:409});
 assert.throws(()=>h.store.hello(old.q,1000),{code:'stale_connection',status:409});
});
test('placements queue no chat; queued chat lifetime is fixed and results and expiry prevent replay',t=>{
 const h=setup(t);h.hello();h.snapshot([row()]);assert.equal(h.exchange([up(1,row(),'reconciled')]).commands.length,0);
 const event=up(2);assert.equal(h.exchange([event]).commands.length,0);
 const c=h.store.queueChat({worldId:h.context.worldId,epoch:h.context.epoch,causalSeq:'2',text:'Foreman: hello'},1000);
 assert.deepEqual(c,{commandId:`${h.context.worldId}/${h.context.epoch}/2/chat`,causalSeq:'2',type:'chat.send',text:'Foreman: hello',expiresAt:31000});
 assert.deepEqual(h.exchange([event],[],30000).commands,[c]);
 assert.equal(h.exchange([], [{commandId:c.commandId,status:'skipped'}],30000).commands.length,0);
 h.reopen();assert.equal(h.exchange([event],[],30001).commands.length,0);
 h.exchange([up(3)],[],40000);h.store.queueChat({worldId:h.context.worldId,epoch:h.context.epoch,causalSeq:'3',text:'again'},40000);
 assert.equal(h.exchange([],[],40001).commands.length,1);assert.equal(h.exchange([],[],70000).commands.length,0);h.reopen();assert.equal(h.exchange([],[],70001).commands.length,0);
 assert.throws(()=>h.store.queueChat({worldId:h.context.worldId,epoch:h.context.epoch,causalSeq:'4',text:'<b>'},1000),{code:'invalid_command'});
});
test('command retirement rolls back with a later gap',t=>{
 const h=setup(t);h.hello();h.snapshot();h.exchange([up(1)]);
 const c=h.store.queueChat({worldId:h.context.worldId,epoch:h.context.epoch,causalSeq:'1',text:'hello'},1000);const before=h.dump();
 assert.throws(()=>h.exchange([up(3)],[{commandId:c.commandId,status:'executed'}]),{code:'sequence_gap'});assert.deepEqual(h.dump(),before);
});
test('uint64 cursor uses exact decimal arithmetic and resume detects retention gap',t=>{
 const h=setup(t);h.hello();h.snapshot([],'9007199254740992');assert.equal(h.exchange([up('9007199254740993')]).ackSeq,'9007199254740993');
 assert.equal(h.hello('9007199254740995','9007199254740995').r.mode,'snapshotRequired');
 h.snapshot([],'18446744073709551614');assert.equal(h.exchange([up('18446744073709551615')]).ackSeq,'18446744073709551615');
});
test('new snapshot supersedes incomplete staging',t=>{
 const h=setup(t);h.hello();h.snapshot();const a=h.request({snapshotId:id(),chunkIndex:0,data:JSON.stringify(row())+'\n'});h.store.stageChunk(a);
 const b={...a,requestId:id(),snapshotId:id()};h.store.stageChunk(b);
 assert.equal(h.dump().snapshot_chunks.some(c=>c.snapshot_id===a.snapshotId),false);
 assert.throws(()=>h.store.commitSnapshot(h.request({snapshotId:a.snapshotId,watermark:'0',chunkCount:1,rowCount:1,sha256:snapshotDigest([Buffer.from(a.data)])}),1000),{code:'snapshot_incomplete'});
});
test('delayed previously unseen hello cannot retire the current world',t=>{
 const h=setup(t);const delayed=h.request({latestSeq:'0',oldestRetainedSeq:'0',provenance});
 h.context.epoch=id();h.hello();const current=row();h.snapshot([current]);
 const candidate=h.store.hello(delayed,2000);assert.equal(candidate.mode,'snapshotRequired');
 assert.deepEqual(h.store.current(h.context.worldId),[current]);assert.equal(h.hello().r.mode,'resume');
});
test('candidate staging survives restart without fencing current writer',t=>{
 const h=setup(t);h.hello();const current=row();h.snapshot([current]);const active=h.request({events:[],commandResults:[]});
 h.context.epoch=id();h.hello();const replacement=row(),chunk=h.request({snapshotId:id(),chunkIndex:0,data:JSON.stringify(replacement)+'\n'});h.store.stageChunk(chunk);h.reopen();
 assert.deepEqual(h.store.current(h.context.worldId),[current]);assert.equal(h.store.exchange(active,2000).ackSeq,'0');
 const commit=h.request({snapshotId:chunk.snapshotId,watermark:'0',chunkCount:1,rowCount:1,sha256:snapshotDigest([Buffer.from(chunk.data)])});
 const reply=h.store.commitSnapshot(commit,2000);h.reopen();assert.deepEqual(h.store.commitSnapshot(commit,3000),reply);assert.deepEqual(h.store.current(h.context.worldId),[replacement]);
 assert.throws(()=>h.store.exchange(active,3000),{code:'stale_connection'});
});
test('promotion fences competing candidate commits but permits a live candidate to renegotiate',t=>{
 const h=setup(t);h.hello();h.snapshot([row()]);
 h.context.epoch=id();h.hello();const candidate={...h.context},r=row();
 const chunk=h.request({snapshotId:id(),chunkIndex:0,data:JSON.stringify(r)+'\n'});h.store.stageChunk(chunk);
 const oldCommit=h.request({snapshotId:chunk.snapshotId,watermark:'0',chunkCount:1,rowCount:1,sha256:snapshotDigest([Buffer.from(chunk.data)])});
 h.context.epoch=id();h.hello();const winner=row();h.snapshot([winner]);
 assert.throws(()=>h.store.commitSnapshot(oldCommit,2000),{code:'stale_connection'});assert.deepEqual(h.store.current(h.context.worldId),[winner]);
 // Arrival order cannot tell which candidate is live. A fresh challenge proves it can still respond.
 Object.assign(h.context,candidate);assert.equal(h.hello().r.mode,'snapshotRequired');h.snapshot([r]);assert.deepEqual(h.store.current(h.context.worldId),[r]);
});
test('retired active epoch cannot replay a successful old snapshot commit receipt',t=>{
 const h=setup(t);const old=h.hello();const committed=h.snapshot([row()]);h.context.epoch=id();h.hello();const current=row();h.snapshot([current]);
 assert.throws(()=>h.store.commitSnapshot(committed.commit,2000),{code:'stale_connection'});
 assert.throws(()=>h.store.hello(old.q,2000),{code:'retired_epoch'});assert.deepEqual(h.store.current(h.context.worldId),[current]);
});
test('opening a protocol v1 database resets ingestion state to no baseline',t=>{
 const dir=mkdtempSync(join(tmpdir(),'foreman-v1-')),path=join(dir,'state.db');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const worldId=id(),epoch=id(),legacy=new DatabaseSync(path);
 legacy.exec(`CREATE TABLE worlds(world_id TEXT PRIMARY KEY,server_id TEXT NOT NULL,active_epoch TEXT NOT NULL);
  CREATE TABLE epochs(world_id TEXT NOT NULL,epoch TEXT NOT NULL,retired INTEGER NOT NULL DEFAULT 0,cursor TEXT NOT NULL DEFAULT '0',watermark TEXT NOT NULL DEFAULT '0',ready INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(world_id,epoch));
  CREATE TABLE constructors(world_id TEXT NOT NULL,epoch TEXT NOT NULL,entity_id TEXT NOT NULL,row_json TEXT NOT NULL,PRIMARY KEY(world_id,epoch,entity_id));
  CREATE TABLE sync_metadata(world_id TEXT PRIMARY KEY,revision TEXT NOT NULL,last_sync_at INTEGER);`);
 legacy.prepare('INSERT INTO worlds VALUES(?,?,?)').run(worldId,id(),epoch);legacy.prepare('INSERT INTO epochs(world_id,epoch,ready) VALUES(?,?,1)').run(worldId,epoch);
 legacy.prepare('INSERT INTO constructors VALUES(?,?,?,?)').run(worldId,epoch,id(),'{}');legacy.prepare('INSERT INTO sync_metadata VALUES(?,?,?)').run(worldId,id(),1);legacy.close();
 const store=openStore(path);t.after(()=>store.close());
 const db=new DatabaseSync(path);
 try {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='constructors'").get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM worlds').get().n,0);
 } finally {db.close();}
 assert.deepEqual(store.current(worldId),[]);
});
test('a committed snapshot keeps one row of every category',t=>{
 const h=setup(t);h.hello();
 const configs={manufacturer:{recipe:null,clockSpeed:1,productionBoost:1,powerShards:0,somersloops:0,paused:false},extractor:{resource:null,purity:'normal',node:null,clockSpeed:1,powerShards:0,paused:false},generator:{fuel:null,clockSpeed:1,powerShards:0,paused:true},storage:{}};
 const rows=Object.entries(configs).map(([category,config])=>({...row(),category,config})).sort((a,b)=>a.entityId<b.entityId?-1:1);
 h.snapshot(rows);assert.deepEqual(h.store.current(h.context.worldId),rows);
});
