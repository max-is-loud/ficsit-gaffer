import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {validateQuery,DEFAULT_LIMIT,MAX_LIMIT} from '../src/query.mjs';
import {ProtocolError} from '../src/protocol.mjs';
import {id,row,up,remove,testClock,storeHarness} from './support.mjs';
const invalid=code=>error=>error instanceof ProtocolError&&error.code===code&&error.status===400;
const stateChanged=error=>error instanceof ProtocolError&&error.code==='state_changed'&&error.status===409;
const positions=state=>Object.fromEntries(state.locations.map(l=>[l.entityId,l.position]));

test('query validation applies bounded defaults and rejects unknown input',()=>{
 assert.equal(DEFAULT_LIMIT,50);assert.equal(MAX_LIMIT,100);
 assert.deepEqual(validateQuery({}),{includeLocations:false,limit:50});
 assert.deepEqual(validateQuery({includeLocations:true,limit:100}),{includeLocations:true,limit:100});
 for(const bad of [null,[],'x',{limit:0},{limit:101},{limit:1.5},{limit:'5'},{includeLocations:'yes'},{worldId:id()},{includeLocations:true,cursor:5},{includeLocations:true,cursor:'x'.repeat(1025)},{includeLocations:false,cursor:'abc'},{cursor:'abc'}]) {
  assert.throws(()=>validateQuery(bad),invalid('invalid_query'),JSON.stringify(bad));
 }
});
test('no committed baseline is unavailable with unknown count, even with candidate staging',t=>{
 const h=storeHarness(t,{clock:testClock()});
 const expected={protocol:1,serverId:h.binding.serverId,worldId:h.binding.worldId,revision:null,epoch:null,status:'unavailable',reason:'no_baseline',lastSyncAt:null,totalCount:null,locations:[],coordinateSystem:'unreal_cm',returnedCount:0,hasMore:false,nextCursor:null};
 const {evaluatedAt,...first}=h.query({includeLocations:true});assert.equal(typeof evaluatedAt,'number');assert.deepEqual(first,expected);
 h.hello();h.stage([row()]);
 const {evaluatedAt:_,...second}=h.query({includeLocations:true});assert.deepEqual(second,expected);
});
test('committed empty world reports zero with ordinary freshness',t=>{
 const clock=testClock(),h=storeHarness(t,{clock});h.hello();h.snapshot([]);
 const state=h.query({includeLocations:true});
 assert.equal(state.totalCount,0);assert.equal(state.status,'fresh');assert.equal(state.reason,'recent_sync');
 assert.equal(state.lastSyncAt,clock.utcNow());assert.equal(state.epoch,h.context.epoch);assert.equal(typeof state.revision,'string');
});
test('placement and removal give exact counts and recorded positions without private metadata',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();
 const a=row(id(),[100,-200,300.5]),b=row(id(),[1,2,3]);h.snapshot([a,b]);
 assert.equal(h.query().totalCount,2);
 const c=row(id(),[-5e5,6e5,7]);h.exchange([up(1,c)]);
 let state=h.query({includeLocations:true});
 assert.equal(state.totalCount,3);assert.equal(state.returnedCount,3);assert.equal(state.hasMore,false);assert.equal(state.nextCursor,null);
 assert.deepEqual(positions(state),{[a.entityId]:[100,-200,300.5],[b.entityId]:[1,2,3],[c.entityId]:[-5e5,6e5,7]});
 assert.deepEqual(state.locations.map(l=>l.entityId),[a,b,c].map(r=>r.entityId).sort());
 for(const location of state.locations)assert.deepEqual(Object.keys(location).sort(),['entityId','position']);
 assert.equal(JSON.stringify(state).includes('private-account'),false);
 h.exchange([remove(2,a.entityId)]);state=h.query({includeLocations:true});
 assert.equal(state.totalCount,2);assert.deepEqual(Object.keys(positions(state)).sort(),[b.entityId,c.entityId].sort());
});
test('count-only queries do not enumerate locations',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();h.snapshot([row(),row()]);
 const state=h.query({includeLocations:false});
 assert.deepEqual([state.totalCount,state.locations,state.returnedCount,state.hasMore,state.nextCursor],[2,[],0,false,null]);
});
test('staged replacement rows are never visible and keep the revision',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();const a=row();h.snapshot([a]);const before=h.query({includeLocations:true});
 h.stage([row(),row()]);const after=h.query({includeLocations:true});
 assert.equal(after.totalCount,1);assert.deepEqual(after.locations,before.locations);assert.equal(after.revision,before.revision);
});
test('accepted empty exchanges refresh freshness; queries, hello and staging do not',t=>{
 const clock=testClock(),h=storeHarness(t,{clock});h.hello();h.snapshot([row()]);
 clock.advance(14000);h.exchange([]);const synced=clock.utcNow();
 clock.advance(14999);assert.equal(h.query().status,'fresh');assert.equal(h.query().lastSyncAt,synced);
 clock.advance(1);assert.deepEqual([h.query().status,h.query().reason],['last_known','stale']);
 h.hello();h.stage([row()]);h.query();
 assert.deepEqual([h.query().status,h.query().reason,h.query().lastSyncAt],['last_known','stale',synced]);
 h.exchange([]);assert.deepEqual([h.query().status,h.query().lastSyncAt],['fresh',clock.utcNow()]);
});
test('revision is stable across empty exchanges and changes on every projection mutation',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();const a=row();h.snapshot([a]);
 const r1=h.query().revision;h.exchange([]);assert.equal(h.query().revision,r1);
 h.exchange([up(1,row())]);const r2=h.query().revision;assert.notEqual(r2,r1);
 h.exchange([]);assert.equal(h.query().revision,r2);
 h.exchange([remove(2,a.entityId)]);assert.notEqual(h.query().revision,r2);
});
test('snapshot replacement at an unchanged cursor changes the revision',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();const a=row();h.snapshot([a],'0');
 const before=h.query().revision;h.snapshot([a],'0');assert.notEqual(h.query().revision,before);
});
test('idempotent snapshot commit replay does not refresh freshness or revision',t=>{
 const clock=testClock(),h=storeHarness(t,{clock});h.hello();const {commit}=h.snapshot([row()]);const before=h.query();
 clock.advance(15000);h.store.commitSnapshot(commit,2000);h.store.commitSnapshot({...commit,requestId:id()},2000);
 const after=h.query();assert.deepEqual([after.status,after.reason,after.revision,after.lastSyncAt],['last_known','stale',before.revision,before.lastSyncAt]);
});
test('failed transactions refresh nothing and preserve rows, revision and last sync',t=>{
 let fail=false;const clock=testClock(),h=storeHarness(t,{clock,beforeCommit:()=>{if(fail)throw Error('simulated');}});
 h.hello();h.snapshot([row()]);const before=h.query({includeLocations:true});
 clock.advance(15000);fail=true;
 assert.throws(()=>h.exchange([]),{code:'storage_unavailable'});assert.throws(()=>h.exchange([up(1)]),{code:'storage_unavailable'});
 assert.throws(()=>h.snapshot([row()]),{code:'storage_unavailable'});
 fail=false;const after=h.query({includeLocations:true});
 assert.deepEqual([after.status,after.revision,after.lastSyncAt,after.locations],['last_known',before.revision,before.lastSyncAt,before.locations]);
});
test('receiver restart reports persisted state as last known until a validated exchange',t=>{
 const clock=testClock(),h=storeHarness(t,{clock});h.hello();const a=row(id(),[4,5,6]);h.snapshot([a]);const synced=clock.utcNow();
 h.reopen();let state=h.query({includeLocations:true});
 assert.deepEqual([state.status,state.reason,state.lastSyncAt,state.totalCount],['last_known','receiver_restarted',synced,1]);
 assert.deepEqual(state.locations,[{entityId:a.entityId,position:[4,5,6]}]);
 assert.equal(h.hello().r.mode,'resume');assert.equal(h.query().reason,'receiver_restarted');
 clock.advance(5000);h.exchange([]);state=h.query();assert.deepEqual([state.status,state.lastSyncAt],['fresh',clock.utcNow()]);
});
test('legacy database without sync metadata migrates without losing rows or ingestion semantics',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();const a=row();h.snapshot([a]);h.exchange([up(1,row())]);
 h.offline(path=>{const db=new DatabaseSync(path);db.exec('DROP TABLE sync_metadata');db.close();});let state=h.query({includeLocations:true});
 assert.deepEqual([state.status,state.reason,state.lastSyncAt,state.totalCount],['last_known','receiver_restarted',null,2]);
 assert.equal(typeof state.revision,'string');
 assert.equal(h.hello('1','1').r.mode,'resume');h.exchange([up(2,row())]);
 state=h.query();assert.deepEqual([state.status,state.totalCount],['fresh',3]);
});
test('legacy database with only candidate traffic still has no baseline',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();
 h.offline(path=>{const db=new DatabaseSync(path);db.exec('DROP TABLE sync_metadata');db.close();});assert.equal(h.query().reason,'no_baseline');
});
test('active epoch needing a snapshot keeps prior rows as last known, also across restart',t=>{
 const clock=testClock(),h=storeHarness(t,{clock});h.hello();const a=row();h.snapshot([a]);h.exchange([up(1,row())]);
 assert.equal(h.hello('5','5').r.mode,'snapshotRequired');
 let state=h.query();assert.deepEqual([state.status,state.reason,state.totalCount],['last_known','resynchronizing',2]);
 h.reopen();state=h.query();assert.deepEqual([state.status,state.reason,state.totalCount],['last_known','resynchronizing',2]);
 h.hello('5','5');const b=row();h.snapshot([b],'5');state=h.query({includeLocations:true});
 assert.deepEqual([state.status,state.totalCount,state.locations[0].entityId],['fresh',1,b.entityId]);
});
test('candidate hello and staging cannot alter or refresh active freshness',t=>{
 const clock=testClock(),h=storeHarness(t,{clock});h.hello();const a=row();h.snapshot([a]);const active={...h.context};
 h.context.epoch=id();delete h.context.connectionId;h.hello();assert.equal(h.query().status,'fresh');
 clock.advance(15000);h.stage([row()]);h.hello();
 const state=h.query({includeLocations:true});assert.deepEqual([state.status,state.reason,state.epoch,state.totalCount],['last_known','stale',active.epoch,1]);
 Object.assign(h.context,active);h.exchange([]);assert.equal(h.query().status,'fresh');
});
test('delayed unseen hello cannot take over active status',t=>{
 const clock=testClock(),h=storeHarness(t,{clock});const delayed=h.request({latestSeq:'0',oldestRetainedSeq:'0',provenance:{gameVersion:'1',smlVersion:'1',bridgeVersion:'1',starterCommit:'a'.repeat(40),bridgeSourceSha256:'b'.repeat(64)}});
 h.context.epoch=id();h.hello();h.snapshot([row()]);h.store.hello(delayed,2000);
 assert.deepEqual([h.query().status,h.query().epoch],['fresh',h.context.epoch]);
});
test('retired connections and old commit receipts cannot refresh the active projection',t=>{
 const clock=testClock(),h=storeHarness(t,{clock});h.hello();const old=h.snapshot([row()]);const oldWrite=h.request({events:[],commandResults:[]});
 h.context.epoch=id();delete h.context.connectionId;h.hello();const current=row();h.snapshot([current]);const before=h.query();
 clock.advance(15000);
 assert.throws(()=>h.store.exchange(oldWrite,2000),{code:'stale_connection'});
 assert.throws(()=>h.store.commitSnapshot(old.commit,2000),{code:'stale_connection'});
 const after=h.query();assert.deepEqual([after.status,after.revision,after.lastSyncAt],['last_known',before.revision,before.lastSyncAt]);
});
test('candidate snapshot commit atomically replaces the projection',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();h.snapshot([row(),row()]);const before=h.query();
 h.context.epoch=id();delete h.context.connectionId;h.hello();const b=row();h.snapshot([b]);
 const after=h.query({includeLocations:true});
 assert.deepEqual([after.epoch,after.totalCount,after.locations.map(l=>l.entityId)],[h.context.epoch,1,[b.entityId]]);assert.notEqual(after.revision,before.revision);
});
test('pagination defaults to 50, caps at 100, keeps exact totals and stable order',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();const rows=Array.from({length:120},()=>row());h.snapshot(rows);
 const sorted=rows.map(r=>r.entityId).sort(),seen=[];
 let page=h.query({includeLocations:true});
 assert.deepEqual([page.totalCount,page.returnedCount,page.hasMore,typeof page.nextCursor],[120,50,true,'string']);seen.push(...page.locations.map(l=>l.entityId));
 page=h.query({includeLocations:true,cursor:page.nextCursor});assert.deepEqual([page.totalCount,page.returnedCount,page.hasMore],[120,50,true]);seen.push(...page.locations.map(l=>l.entityId));
 page=h.query({includeLocations:true,cursor:page.nextCursor});assert.deepEqual([page.totalCount,page.returnedCount,page.hasMore,page.nextCursor],[120,20,false,null]);seen.push(...page.locations.map(l=>l.entityId));
 assert.deepEqual(seen,sorted);
 const big=h.query({includeLocations:true,limit:100});assert.deepEqual([big.returnedCount,big.hasMore],[100,true]);
 const exact=h.query({includeLocations:true,limit:20,cursor:h.query({includeLocations:true,limit:100}).nextCursor});assert.deepEqual([exact.returnedCount,exact.hasMore,exact.nextCursor],[20,false,null]);
});
test('cursor is invalidated by mutation or same-cursor snapshot replacement',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();const rows=Array.from({length:3},()=>row());h.snapshot(rows);
 let cursor=h.query({includeLocations:true,limit:1}).nextCursor;h.exchange([]);
 assert.equal(h.query({includeLocations:true,limit:1,cursor}).returnedCount,1);
 h.exchange([up(1,row())]);assert.throws(()=>h.query({includeLocations:true,limit:1,cursor}),stateChanged);
 cursor=h.query({includeLocations:true,limit:1}).nextCursor;h.snapshot([...rows],'1');
 assert.throws(()=>h.query({includeLocations:true,limit:1,cursor}),stateChanged);
});
test('malformed, forged or foreign cursors are rejected without selecting another world',t=>{
 const h=storeHarness(t,{clock:testClock()});h.hello();h.snapshot([row(),row()]);
 const cursor=h.query({includeLocations:true,limit:1}).nextCursor;
 const decoded=JSON.parse(Buffer.from(cursor,'base64url').toString());
 const forge=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 for(const bad of ['!!!', 'e30', forge({...decoded,w:id()}),forge({...decoded,a:"' OR 1=1 --"}),forge({...decoded,extra:1}),forge({...decoded,r:5}),forge([decoded]),Buffer.from('not json').toString('base64url')]) {
  assert.throws(()=>h.query({includeLocations:true,cursor:bad}),invalid('invalid_cursor'),bad);
 }
});
