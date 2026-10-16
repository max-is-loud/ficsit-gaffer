// The receiver's durable store: ingestion (hello, snapshot staging and
// commit, exchange) with epoch fencing and idempotent receipts, plus the
// read-only buildables query. Schema lives in store/schema.mjs, the
// projection in store/projection.mjs and the query reader in
// store/buildablesQuery.mjs.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {ProtocolError,decodeRequest,snapshotDigest,validateCommand,MAX_BODY_BYTES} from './protocol.mjs';
import {createFreshness,systemClock} from './freshness.mjs';
import {validateBuildablesQuery,decodeCursor} from './query.mjs';
import {migrate} from './store/schema.mjs';
import {putBuildable,deleteBuildable,clearBuildables} from './store/projection.mjs';
import {readBuildables} from './store/buildablesQuery.mjs';

function canonical(value) {
 if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function conflict(code,extra={}) {throw Object.assign(new ProtocolError(code,409),extra);}
function envelope(q) {return Object.fromEntries(['protocol','serverId','worldId','epoch','requestId','connectionId'].filter(k=>q[k]!==undefined).map(k=>[k,q[k]]));}
function validate(kind,q) {return decodeRequest(kind,Buffer.from(JSON.stringify(q)));}

/** Synchronous durable receiver store. beforeCommit is an optional fault-injection hook;
 * clock supplies UTC for reporting and monotonic time for freshness. */
export function openStore(databasePath,{beforeCommit=()=>{},clock=systemClock}={}) {
 const db=new DatabaseSync(databasePath);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
 migrate(db);
 const freshness=createFreshness(clock);
 const get=(sql,...args)=>db.prepare(sql).get(...args);
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 const run=(sql,...args)=>db.prepare(sql).run(...args);
 function transaction(fn) {
  let begun=false;
  try {db.exec('BEGIN IMMEDIATE');begun=true;const reply=fn();beforeCommit();db.exec('COMMIT');return reply;}
  catch(error) {if(begun) {try{db.exec('ROLLBACK');}catch{/* Preserve original failure. */}}if(error instanceof ProtocolError)throw error;throw new ProtocolError('storage_unavailable',503);}
 }
 const epoch=q=>get('SELECT * FROM epochs WHERE world_id=? AND epoch=?',q.worldId,q.epoch);
 function connected(q,candidate=false) {
  const w=get('SELECT * FROM worlds WHERE world_id=?',q.worldId);
  const c=get('SELECT * FROM connections WHERE connection_id=?',q.connectionId);
  const e=epoch(q);
  if(!w||w.server_id!==q.serverId||(!candidate&&w.active_epoch!==q.epoch)||!e||e.retired||!c||!c.active||c.world_id!==q.worldId||c.epoch!==q.epoch)conflict('stale_connection');
  return e;
 }
 function receipt(q,kind,key,payload) {
  const old=get('SELECT * FROM receipts WHERE world_id=? AND epoch=? AND kind=? AND receipt_key=?',q.worldId,q.epoch,kind,key);
  if(old&&old.payload!==payload)conflict(kind==='event'?'sequence_conflict':'request_conflict');
  return old;
 }
 function remember(q,kind,key,payload,reply=null) {
  run('INSERT INTO receipts VALUES(?,?,?,?,?,?)',q.worldId,q.epoch,kind,key,payload,reply===null?null:JSON.stringify(reply));
 }
 /** Record an accepted synchronization; a projection mutation also issues a new opaque revision. */
 function synchronized(worldId,mutated) {
  run('INSERT INTO sync_metadata VALUES(?,?,?) ON CONFLICT(world_id) DO UPDATE SET revision=CASE WHEN ? THEN excluded.revision ELSE revision END,last_sync_at=excluded.last_sync_at',worldId,randomUUID(),clock.utcNow(),mutated?1:0);
 }
 // Databases from before sync metadata keep their projection with no trusted sync time.
 transaction(()=>{
  for(const w of all("SELECT world_id FROM worlds WHERE active_epoch<>'' AND world_id NOT IN (SELECT world_id FROM sync_metadata)"))run('INSERT INTO sync_metadata VALUES(?,?,NULL)',w.world_id,randomUUID());
 });
 const reader={get,all,evaluate:(worldId,lastSyncAt)=>freshness.evaluate(worldId,lastSyncAt),now:()=>clock.utcNow()};
 return {
  hello(input,nowMs) {
   const q=validate('hello',input);let recovering=false;
   const result=transaction(()=>{
    let w=get('SELECT * FROM worlds WHERE world_id=?',q.worldId);
    if(w&&w.server_id!==q.serverId)throw new ProtocolError('wrong_binding',403);
    const previous=epoch(q);
    if(previous?.retired)conflict('retired_epoch');
    const payload=canonical(q),old=receipt(q,'hello',q.requestId,payload);
    if(old) {const reply=JSON.parse(old.reply);connected(reply,true);return reply;}
    // An unseen hello is only a candidate: an old world's first request may arrive late.
    // A validated snapshot commit proves the world received this connection challenge.
    if(!w) {run('INSERT INTO worlds VALUES(?,?,?)',q.worldId,q.serverId,'');w={active_epoch:''};}
    if(!previous)run('INSERT INTO epochs(world_id,epoch) VALUES(?,?)',q.worldId,q.epoch);
    run('UPDATE connections SET active=0 WHERE world_id=? AND epoch=?',q.worldId,q.epoch);
    const connectionId=randomUUID();run('INSERT INTO connections VALUES(?,?,?,1)',connectionId,q.worldId,q.epoch);
    const e=epoch(q),cursor=BigInt(e.cursor),latest=BigInt(q.latestSeq),oldest=BigInt(q.oldestRetainedSeq);
    const resume=e.ready&&cursor<=latest&&(cursor===latest||(oldest>0n&&cursor+1n>=oldest));
    const reply={...envelope(q),connectionId,...(resume?{mode:'resume',cursor:e.cursor}:{mode:'snapshotRequired',reason:e.ready?'retention_gap':'baseline_required'})};
    if(!resume)run('UPDATE epochs SET ready=0 WHERE world_id=? AND epoch=?',q.worldId,q.epoch);
    // Only the active epoch's own challenge marks its projection as resynchronizing; candidates cannot.
    recovering=!resume&&w.active_epoch===q.epoch;
    remember(q,'hello',q.requestId,payload,reply);return reply;
   });
   if(recovering)freshness.markRecovering(q.worldId);
   return result;
  },
  stageChunk(input) {
   const q=validate('snapshot/chunk',input);
   return transaction(()=>{
    connected(q,true);
    const s=get('SELECT * FROM snapshots WHERE world_id=? AND epoch=? AND snapshot_id=?',q.worldId,q.epoch,q.snapshotId);
    const old=get('SELECT * FROM snapshot_chunks WHERE world_id=? AND epoch=? AND snapshot_id=? AND chunk_index=?',q.worldId,q.epoch,q.snapshotId,q.chunkIndex);
    if(old&&old.data!==q.data)conflict('snapshot_conflict');
    if(!old) {
     if(s?.commit_json)conflict('snapshot_conflict');
     if(!s) {
      run('DELETE FROM snapshot_chunks WHERE world_id=? AND epoch=? AND snapshot_id IN (SELECT snapshot_id FROM snapshots WHERE world_id=? AND epoch=? AND commit_json IS NULL)',q.worldId,q.epoch,q.worldId,q.epoch);
      run('DELETE FROM snapshots WHERE world_id=? AND epoch=? AND commit_json IS NULL',q.worldId,q.epoch);
      run('INSERT INTO snapshots VALUES(?,?,?,NULL)',q.worldId,q.epoch,q.snapshotId);
     }
     run('INSERT INTO snapshot_chunks VALUES(?,?,?,?,?)',q.worldId,q.epoch,q.snapshotId,q.chunkIndex,q.data);
    }
    return {...envelope(q),snapshotId:q.snapshotId,chunkIndex:q.chunkIndex};
   });
  },
  commitSnapshot(input,nowMs) {
   const q=validate('snapshot/commit',input);let installed=false;
   const result=transaction(()=>{
    const e=connected(q,true),payload=canonical(q),old=receipt(q,'commit',q.requestId,payload);
    if(old)return JSON.parse(old.reply);
    const metadata=canonical({snapshotId:q.snapshotId,watermark:q.watermark,chunkCount:q.chunkCount,rowCount:q.rowCount,sha256:q.sha256});
    const s=get('SELECT * FROM snapshots WHERE world_id=? AND epoch=? AND snapshot_id=?',q.worldId,q.epoch,q.snapshotId);
    const reply={...envelope(q),snapshotId:q.snapshotId,watermark:q.watermark};
    if(s?.commit_json) {
     if(s.commit_json!==metadata)conflict('snapshot_conflict');
     remember(q,'commit',q.requestId,payload,reply);return reply;
    }
    if(BigInt(q.watermark)<BigInt(e.cursor))conflict('snapshot_stale');
    const chunks=all('SELECT * FROM snapshot_chunks WHERE world_id=? AND epoch=? AND snapshot_id=? ORDER BY chunk_index',q.worldId,q.epoch,q.snapshotId);
    if(chunks.length!==q.chunkCount||chunks.some((c,i)=>c.chunk_index!==i))conflict('snapshot_incomplete');
    if(snapshotDigest(chunks.map(c=>Buffer.from(c.data)))!==q.sha256)conflict('snapshot_hash');
    const rows=chunks.flatMap(c=>c.data.slice(0,-1).split('\n').map(line=>JSON.parse(line)));
    if(rows.length!==q.rowCount)conflict('snapshot_count');
    const ids=new Set();let previous='';
    for(const row of rows) {if(ids.has(row.entityId))conflict('snapshot_duplicate');if(row.entityId<previous)conflict('snapshot_order');ids.add(row.entityId);previous=row.entityId;}
    const w=get('SELECT * FROM worlds WHERE world_id=?',q.worldId);
    if(w.active_epoch!==q.epoch) {
     // Fence every issued competing connection, but don't permanently retire never-active
     // candidates: a live one must be able to renegotiate after concurrent promotion.
     run('UPDATE epochs SET retired=1 WHERE world_id=? AND epoch=?',q.worldId,w.active_epoch);
     run('UPDATE connections SET active=0 WHERE world_id=? AND epoch<>?',q.worldId,q.epoch);
     run("UPDATE commands SET status='expired' WHERE world_id=? AND epoch<>? AND status IS NULL",q.worldId,q.epoch);
     run('UPDATE worlds SET active_epoch=? WHERE world_id=?',q.epoch,q.worldId);
    }
    clearBuildables(db,q.worldId,q.epoch);
    for(const row of rows)putBuildable(db,q.worldId,q.epoch,row);
    run('UPDATE epochs SET cursor=?,watermark=?,ready=1 WHERE world_id=? AND epoch=?',q.watermark,q.watermark,q.worldId,q.epoch);
    // Snapshot recovery covers history; pending greetings must not masquerade as fresh placements.
    for(const c of all('SELECT * FROM commands WHERE world_id=? AND epoch=? AND status IS NULL',q.worldId,q.epoch)) {
     if(BigInt(JSON.parse(c.command_json).causalSeq)<=BigInt(q.watermark))run("UPDATE commands SET status='skipped' WHERE command_id=?",c.command_id);
    }
    if(!s)run('INSERT INTO snapshots VALUES(?,?,?,?)',q.worldId,q.epoch,q.snapshotId,metadata);
    else run('UPDATE snapshots SET commit_json=? WHERE world_id=? AND epoch=? AND snapshot_id=?',metadata,q.worldId,q.epoch,q.snapshotId);
    // Every installation issues a new revision, even at an unchanged watermark; receipt replays above do not.
    synchronized(q.worldId,true);installed=true;
    remember(q,'commit',q.requestId,payload,reply);return reply;
   });
   if(installed)freshness.markSynchronized(q.worldId);
   return result;
  },
  exchange(input,nowMs) {
   const q=validate('exchange',input);
   const result=transaction(()=>{
    const e=connected(q);
    if(!e.ready)conflict('snapshot_required');
    let cursor=BigInt(e.cursor),mutated=false;const watermark=BigInt(e.watermark);
    for(const event of q.events) {
     const seq=BigInt(event.seq);if(seq<=watermark)continue;
     const payload=canonical(event),old=receipt(q,'event',event.seq,payload);
     if(old)continue;
     if(seq!==cursor+1n)conflict('sequence_gap',{expectedSeq:String(cursor+1n)});
     if(event.type==='buildable.upsert')putBuildable(db,q.worldId,q.epoch,event.row);
     else deleteBuildable(db,q.worldId,q.epoch,event.entityId);
     remember(q,'event',event.seq,payload);cursor=seq;mutated=true;
    }
    for(const result of q.commandResults)run('UPDATE commands SET status=? WHERE command_id=? AND world_id=? AND epoch=? AND status IS NULL',result.status,result.commandId,q.worldId,q.epoch);
    run("UPDATE commands SET status='expired' WHERE world_id=? AND epoch=? AND expires_at<=? AND status IS NULL",q.worldId,q.epoch,nowMs);
    run('UPDATE epochs SET cursor=? WHERE world_id=? AND epoch=?',String(cursor),q.worldId,q.epoch);
    // An accepted exchange on the current connection is synchronization, even with no events.
    // It proves these observations were accepted, not that the game's whole backlog arrived.
    synchronized(q.worldId,mutated);
    const reply={...envelope(q),ackSeq:String(cursor),commands:[]};
    const pending=all('SELECT command_json FROM commands WHERE world_id=? AND epoch=? AND status IS NULL ORDER BY expires_at,command_id LIMIT 128',q.worldId,q.epoch);
    for(const c of pending) {reply.commands.push(JSON.parse(c.command_json));if(Buffer.byteLength(JSON.stringify(reply))>MAX_BODY_BYTES){reply.commands.pop();break;}}
    return reply;
   });
   freshness.markSynchronized(q.worldId);
   return result;
  },
  /** Queue an in-game chat line for the epoch (plumbing for the future in-game foreman; no
   * receiver flow calls it yet). Same validation and fixed 30 s lifetime as every command. */
  queueChat({worldId,epoch,causalSeq,text},nowMs) {
   const command={commandId:`${worldId}/${epoch}/${causalSeq}/chat`,causalSeq,type:'chat.send',text,expiresAt:nowMs+30000};
   validateCommand(command,{worldId,epoch});
   return transaction(()=>{run('INSERT INTO commands VALUES(?,?,?,?,?,NULL)',command.commandId,worldId,epoch,JSON.stringify(command),command.expiresAt);return command;});
  },
  /** One consistent read of committed state for the configured binding; staged rows are never visible. */
  queryBuildables(binding,input) {
   const query=validateBuildablesQuery(input),cursor=query.cursor===undefined?undefined:decodeCursor(query.cursor);
   if(cursor&&cursor.worldId!==binding.worldId)throw new ProtocolError('invalid_cursor',400);
   let begun=false;
   try {
    db.exec('BEGIN');begun=true;
    const state=readBuildables(reader,binding,query,cursor);
    db.exec('COMMIT');begun=false;return state;
   } catch(error) {
    if(begun) {try{db.exec('ROLLBACK');}catch{/* Preserve original failure. */}}
    if(error instanceof ProtocolError)throw error;throw new ProtocolError('storage_unavailable',503);
   }
  },
  current(worldId) {return all('SELECT b.row_json FROM buildables b JOIN worlds w ON b.world_id=w.world_id AND b.epoch=w.active_epoch WHERE b.world_id=? ORDER BY b.entity_id',worldId).map(r=>JSON.parse(r.row_json));},
  close() {db.close();}
 };
}
