import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {ProtocolError,decodeRequest,snapshotDigest,MAX_BODY_BYTES} from './protocol.mjs';

function canonical(value) {
 if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function conflict(code,extra={}) {throw Object.assign(new ProtocolError(code,409),extra);}
function envelope(q) {return Object.fromEntries(['protocol','serverId','worldId','epoch','requestId','connectionId'].filter(k=>q[k]!==undefined).map(k=>[k,q[k]]));}
function validate(kind,q) {return decodeRequest(kind,Buffer.from(JSON.stringify(q)));}

/** Synchronous durable receiver store. beforeCommit is an optional fault-injection hook. */
export function openStore(databasePath,{beforeCommit=()=>{}}={}) {
 const db=new DatabaseSync(databasePath);
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS worlds(world_id TEXT PRIMARY KEY,server_id TEXT NOT NULL,active_epoch TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS epochs(world_id TEXT NOT NULL,epoch TEXT NOT NULL,retired INTEGER NOT NULL DEFAULT 0,cursor TEXT NOT NULL DEFAULT '0',watermark TEXT NOT NULL DEFAULT '0',ready INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(world_id,epoch),FOREIGN KEY(world_id) REFERENCES worlds(world_id));
 CREATE TABLE IF NOT EXISTS connections(connection_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,epoch TEXT NOT NULL,active INTEGER NOT NULL,FOREIGN KEY(world_id,epoch) REFERENCES epochs(world_id,epoch));
 CREATE TABLE IF NOT EXISTS receipts(world_id TEXT NOT NULL,epoch TEXT NOT NULL,kind TEXT NOT NULL,receipt_key TEXT NOT NULL,payload TEXT NOT NULL,reply TEXT,PRIMARY KEY(world_id,epoch,kind,receipt_key),FOREIGN KEY(world_id,epoch) REFERENCES epochs(world_id,epoch));
 CREATE TABLE IF NOT EXISTS constructors(world_id TEXT NOT NULL,epoch TEXT NOT NULL,entity_id TEXT NOT NULL,row_json TEXT NOT NULL,PRIMARY KEY(world_id,epoch,entity_id),FOREIGN KEY(world_id,epoch) REFERENCES epochs(world_id,epoch));
 CREATE TABLE IF NOT EXISTS snapshots(world_id TEXT NOT NULL,epoch TEXT NOT NULL,snapshot_id TEXT NOT NULL,commit_json TEXT,PRIMARY KEY(world_id,epoch,snapshot_id),FOREIGN KEY(world_id,epoch) REFERENCES epochs(world_id,epoch));
 CREATE TABLE IF NOT EXISTS snapshot_chunks(world_id TEXT NOT NULL,epoch TEXT NOT NULL,snapshot_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(world_id,epoch,snapshot_id,chunk_index),FOREIGN KEY(world_id,epoch,snapshot_id) REFERENCES snapshots(world_id,epoch,snapshot_id));
 CREATE TABLE IF NOT EXISTS commands(command_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,epoch TEXT NOT NULL,command_json TEXT NOT NULL,expires_at INTEGER NOT NULL,status TEXT,FOREIGN KEY(world_id,epoch) REFERENCES epochs(world_id,epoch));`);
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
 function putRow(q,row) {
  run('INSERT INTO constructors VALUES(?,?,?,?) ON CONFLICT(world_id,epoch,entity_id) DO UPDATE SET row_json=excluded.row_json',q.worldId,q.epoch,row.entityId,JSON.stringify(row));
 }
 return {
  hello(input,nowMs) {
   const q=validate('hello',input);
   return transaction(()=>{
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
    remember(q,'hello',q.requestId,payload,reply);return reply;
   });
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
   const q=validate('snapshot/commit',input);
   return transaction(()=>{
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
    run('DELETE FROM constructors WHERE world_id=? AND epoch=?',q.worldId,q.epoch);
    for(const row of rows)putRow(q,row);
    run('UPDATE epochs SET cursor=?,watermark=?,ready=1 WHERE world_id=? AND epoch=?',q.watermark,q.watermark,q.worldId,q.epoch);
    // Snapshot recovery covers history; pending greetings must not masquerade as fresh placements.
    for(const c of all('SELECT * FROM commands WHERE world_id=? AND epoch=? AND status IS NULL',q.worldId,q.epoch)) {
     if(BigInt(JSON.parse(c.command_json).causalSeq)<=BigInt(q.watermark))run("UPDATE commands SET status='skipped' WHERE command_id=?",c.command_id);
    }
    if(!s)run('INSERT INTO snapshots VALUES(?,?,?,?)',q.worldId,q.epoch,q.snapshotId,metadata);
    else run('UPDATE snapshots SET commit_json=? WHERE world_id=? AND epoch=? AND snapshot_id=?',metadata,q.worldId,q.epoch,q.snapshotId);
    remember(q,'commit',q.requestId,payload,reply);return reply;
   });
  },
  exchange(input,nowMs) {
   const q=validate('exchange',input);
   return transaction(()=>{
    const e=connected(q);
    if(!e.ready)conflict('snapshot_required');
    let cursor=BigInt(e.cursor);const watermark=BigInt(e.watermark);
    for(const event of q.events) {
     const seq=BigInt(event.seq);if(seq<=watermark)continue;
     const payload=canonical(event),old=receipt(q,'event',event.seq,payload);
     if(old)continue;
     if(seq!==cursor+1n)conflict('sequence_gap',{expectedSeq:String(cursor+1n)});
     if(event.type==='constructor.upsert')putRow(q,event.row);
     else run('DELETE FROM constructors WHERE world_id=? AND epoch=? AND entity_id=?',q.worldId,q.epoch,event.entityId);
     remember(q,'event',event.seq,payload);cursor=seq;
     if(event.type==='constructor.upsert'&&event.origin==='placed') {
      const command={commandId:`${q.worldId}/${q.epoch}/${event.seq}/chat`,causalSeq:event.seq,type:'chat.send',text:`Foreman bridge: constructor recorded (event ${event.seq}).`,expiresAt:nowMs+30000};
      run('INSERT INTO commands VALUES(?,?,?,?,?,NULL)',command.commandId,q.worldId,q.epoch,JSON.stringify(command),command.expiresAt);
     }
    }
    for(const result of q.commandResults)run('UPDATE commands SET status=? WHERE command_id=? AND world_id=? AND epoch=? AND status IS NULL',result.status,result.commandId,q.worldId,q.epoch);
    run("UPDATE commands SET status='expired' WHERE world_id=? AND epoch=? AND expires_at<=? AND status IS NULL",q.worldId,q.epoch,nowMs);
    run('UPDATE epochs SET cursor=? WHERE world_id=? AND epoch=?',String(cursor),q.worldId,q.epoch);
    const reply={...envelope(q),ackSeq:String(cursor),commands:[]};
    const pending=all('SELECT command_json FROM commands WHERE world_id=? AND epoch=? AND status IS NULL ORDER BY expires_at,command_id LIMIT 128',q.worldId,q.epoch);
    for(const c of pending) {reply.commands.push(JSON.parse(c.command_json));if(Buffer.byteLength(JSON.stringify(reply))>MAX_BODY_BYTES){reply.commands.pop();break;}}
    return reply;
   });
  },
  current(worldId) {return all('SELECT c.row_json FROM constructors c JOIN worlds w ON c.world_id=w.world_id AND c.epoch=w.active_epoch WHERE c.world_id=? ORDER BY c.entity_id',worldId).map(r=>JSON.parse(r.row_json));},
  close() {db.close();}
 };
}
