import {createHash} from 'node:crypto';

/** @typedef {{platform:string, accountId:string, displayName:string}} Player */
/** @typedef {{position:number[], rotation:number[], scale:number[]}} Transform */
/** @typedef {{entityId:string, actorPath:string, classPath:string, transform:Transform, player:Player|null}} Row */
/** @typedef {{seq:string, type:'constructor.upsert'|'constructor.remove', entityId:string, row?:Row, origin:'placed'|'reconciled'}} Event */
/** @typedef {{protocol:1, serverId:string, worldId:string, epoch:string, requestId:string, connectionId?:string}} Envelope */
/** @typedef {{gameVersion:string, smlVersion:string, bridgeVersion:string, starterCommit:string, bridgeSourceSha256:string}} Provenance */
/** @typedef {Envelope & {latestSeq:string, oldestRetainedSeq:string, provenance:Provenance}} Hello */
/** @typedef {Envelope & {snapshotId:string, chunkIndex:number, data:string}} SnapshotChunk */
/** @typedef {Envelope & {snapshotId:string, watermark:string, chunkCount:number, rowCount:number, sha256:string}} SnapshotCommit */
/** @typedef {'executed'|'skipped'|'expired'|'rejected'} CommandStatus */
/** @typedef {{commandId:string, status:CommandStatus}} CommandResult */
/** @typedef {{commandId:string, causalSeq:string, type:'chat.send', text:string, expiresAt:number}} Command */
/** @typedef {Envelope & {events:Event[], commandResults:CommandResult[]}} Exchange */
/** @typedef {Envelope & ({mode:'resume',cursor:string}|{mode:'snapshotRequired',reason:string})} HelloReply */
/** @typedef {Envelope & {snapshotId:string,chunkIndex:number}} ChunkReply */
/** @typedef {Envelope & {snapshotId:string,watermark:string}} SnapshotReply */
/** @typedef {Envelope & {ackSeq:string,commands:Command[],resyncRequired?:string}} ExchangeReply */
/** @typedef {Hello|SnapshotChunk|SnapshotCommit|Exchange} Request */
/** @typedef {HelloReply|ChunkReply|SnapshotReply|ExchangeReply} Reply */
/** @typedef {Envelope & {kind:string}} ExpectedReply */

export const MAX_BODY_BYTES = 256*1024;
export const MAX_BATCH = 128;
const MAX_SEQ = 18446744073709551615n;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const envelopeKeys = ['protocol','serverId','worldId','epoch','requestId'];
export class ProtocolError extends Error {
  constructor(code, status=400) { super(code); this.name='ProtocolError'; this.code=code; this.status=status; }
}
function requireThat(condition, code, status=400) { if (!condition) { throw new ProtocolError(code,status); } }
function object(value, code='invalid_schema') {
  requireThat(value !== null && typeof value==='object' && !Array.isArray(value),code);
}
function fields(value, required, optional=[], code='invalid_schema') {
  object(value,code);
  requireThat(required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => required.includes(key)||optional.includes(key)),code);
}
function text(value, max=4096, code='invalid_schema') {
  requireThat(typeof value==='string' && value.length>0 && Buffer.byteLength(value)<=max,code);
}
export function sequence(value, allowZero=true) {
  requireThat(typeof value==='string' && /^(0|[1-9][0-9]{0,19})$/.test(value), 'invalid_sequence');
  const number=BigInt(value);
  requireThat(number<=MAX_SEQ && (allowZero || number!==0n),'invalid_sequence');
  return number;
}
function identity(value) { requireThat(typeof value==='string' && uuid.test(value),'invalid_identity'); }
function uint32(value, code='invalid_snapshot') { requireThat(Number.isInteger(value) && value>=0 && value<=4294967295,code); }
function unicode(value, depth=0) {
  requireThat(depth<=32,'invalid_schema');
  if (typeof value==='string') { requireThat(value.isWellFormed(),'invalid_unicode'); }
  else if (Array.isArray(value)) { for(const item of value) { unicode(item,depth+1); } }
  else if (value && typeof value==='object') {
    for(const [key,item] of Object.entries(value)) { unicode(key,depth+1); unicode(item,depth+1); }
  }
}
function parse(raw) {
  requireThat(raw instanceof Uint8Array,'invalid_schema');
  requireThat(raw.byteLength<=MAX_BODY_BYTES,'payload_too_large',413);
  let source;
  try { source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw); }
  catch { throw new ProtocolError('invalid_unicode'); }
  let value;
  try { value=JSON.parse(source); } catch { throw new ProtocolError('invalid_json'); }
  unicode(value); object(value);
  return value;
}
function envelope(value, connected) {
  requireThat(value.protocol===1,'unsupported_protocol',426);
  for(const key of ['serverId','worldId','epoch','requestId']) { identity(value[key]); }
  if(connected) { identity(value.connectionId); }
}
export function validateRow(row) {
  fields(row,['entityId','actorPath','classPath','transform','player'],[],'invalid_row'); identity(row.entityId);
  text(row.actorPath,4096,'invalid_row'); text(row.classPath,4096,'invalid_row');
  fields(row.transform,['position','rotation','scale'],[],'invalid_row');
  for(const vector of Object.values(row.transform)) {
    requireThat(Array.isArray(vector) && vector.length===3 && vector.every(x=>typeof x==='number' && Number.isFinite(x)),'invalid_row');
  }
  if(row.player!==null) {
    fields(row.player,['platform','accountId','displayName'],[],'invalid_row');
    for(const key of ['platform','accountId','displayName']) { text(row.player[key],1024,'invalid_row'); }
  }
  unicode(row); return row;
}
function event(value) {
  requireThat(value?.type==='constructor.upsert'||value?.type==='constructor.remove','invalid_event');
  fields(value,['seq','type','entityId','origin',...(value.type==='constructor.upsert'?['row']:[])],[],'invalid_event');
  sequence(value.seq,false); identity(value.entityId);
  requireThat(value.origin==='placed'||value.origin==='reconciled','invalid_event');
  if(value.type==='constructor.upsert') { validateRow(value.row); requireThat(value.row.entityId===value.entityId,'invalid_row'); }
}
function commandId(value, context, causalSeq) {
  text(value,128,'invalid_command');
  const parts=value.split('/');
  requireThat(parts.length===4 && parts[0]===context.worldId && parts[1]===context.epoch && parts[3]==='chat','invalid_command');
  sequence(parts[2],false);
  if(causalSeq!==undefined) { requireThat(parts[2]===causalSeq,'invalid_command'); }
}
function command(value, context) {
  fields(value,['commandId','causalSeq','type','text','expiresAt'],[],'invalid_command');
  sequence(value.causalSeq,false); commandId(value.commandId,context,value.causalSeq);
  requireThat(value.type==='chat.send','invalid_command');
  text(value.text,2048,'invalid_command');
  requireThat([...value.text].length<=512 && !/[\p{Cc}\p{Cf}<>]/u.test(value.text),'invalid_command');
  requireThat(Number.isSafeInteger(value.expiresAt) && value.expiresAt>=0,'invalid_command');
}
function result(value,context) {
  fields(value,['commandId','status'],[],'invalid_command');commandId(value.commandId,context);
  requireThat(['executed','skipped','expired','rejected'].includes(value.status),'invalid_command');
}
function boundedArray(value,check,code) {
  requireThat(Array.isArray(value)&&value.length<=MAX_BATCH,code);
  value.forEach(check);
}
/** Validate the whole request before returning any projection input. @returns {Request} */
export function decodeRequest(kind,rawUtf8) {
  const value=parse(rawUtf8); envelope(value,kind!=='hello');
  const keys=[...envelopeKeys,...(kind==='hello'?[]:['connectionId'])];
  if(kind==='hello') {
    fields(value,[...keys,'latestSeq','oldestRetainedSeq','provenance']);
    const latest=sequence(value.latestSeq),oldest=sequence(value.oldestRetainedSeq);
    requireThat(oldest<=latest,'invalid_sequence');
    fields(value.provenance,['gameVersion','smlVersion','bridgeVersion','starterCommit','bridgeSourceSha256']);
    for(const key of ['gameVersion','smlVersion','bridgeVersion']) { text(value.provenance[key],128); }
    const {starterCommit,bridgeSourceSha256}=value.provenance;
    // RegExp.test coerces non-strings, so ["<hash>"] would otherwise pass.
    requireThat(typeof starterCommit==='string'&&typeof bridgeSourceSha256==='string','invalid_schema');
    requireThat(/^[0-9a-f]{40}$/.test(starterCommit)&&/^[0-9a-f]{64}$/.test(bridgeSourceSha256),'invalid_schema');
  } else if(kind==='exchange') {
    fields(value,[...keys,'events','commandResults']);
    boundedArray(value.events,event,'invalid_event');
    boundedArray(value.commandResults,x=>result(x,value),'invalid_command');
  } else if(kind==='snapshot/chunk') {
    fields(value,[...keys,'snapshotId','chunkIndex','data']);identity(value.snapshotId);uint32(value.chunkIndex);
    text(value.data,MAX_BODY_BYTES,'invalid_snapshot'); requireThat(value.data.endsWith('\n'),'invalid_snapshot');
    let previous='';
    for(const line of value.data.slice(0,-1).split('\n')) {
      let row; try { row=JSON.parse(line); } catch { throw new ProtocolError('invalid_snapshot'); }
      validateRow(row); requireThat(row.entityId>previous,'invalid_snapshot');previous=row.entityId;
    }
  } else if(kind==='snapshot/commit') {
    fields(value,[...keys,'snapshotId','watermark','chunkCount','rowCount','sha256']);identity(value.snapshotId);sequence(value.watermark);
    uint32(value.chunkCount);uint32(value.rowCount);
    requireThat(typeof value.sha256==='string' && /^[0-9a-f]{64}$/.test(value.sha256),'invalid_snapshot');
    requireThat((value.chunkCount===0)===(value.rowCount===0) && value.chunkCount<=value.rowCount,'invalid_snapshot');
    if(value.rowCount===0) { requireThat(value.sha256===snapshotDigest([]),'invalid_snapshot'); }
  } else { throw new ProtocolError('invalid_type'); }
  return value;
}
/** @param {Uint8Array} rawUtf8 @param {ExpectedReply} expected @returns {Reply} */
export function validateResponse(rawUtf8,expected) {
  const value=parse(rawUtf8);envelope(value,true);
  for(const key of envelopeKeys) { requireThat(value[key]===expected[key],'stale_reply'); }
  if(expected.kind!=='hello') { requireThat(value.connectionId===expected.connectionId,'stale_reply'); }
  const keys=[...envelopeKeys,'connectionId'];
  if(expected.kind==='hello') {
    requireThat(value.mode==='resume'||value.mode==='snapshotRequired','invalid_schema');
    if(value.mode==='resume') { fields(value,[...keys,'mode','cursor']);sequence(value.cursor); }
    else { fields(value,[...keys,'mode','reason']);text(value.reason,256); }
  } else if(expected.kind==='exchange') {
    fields(value,[...keys,'ackSeq','commands'],['resyncRequired']);sequence(value.ackSeq);
    boundedArray(value.commands,x=>command(x,value),'invalid_command');
    if(value.resyncRequired!==undefined) { text(value.resyncRequired,256); }
  } else if(expected.kind==='snapshot/chunk') {
    fields(value,[...keys,'snapshotId','chunkIndex']);identity(value.snapshotId);uint32(value.chunkIndex);
  } else if(expected.kind==='snapshot/commit') {
    fields(value,[...keys,'snapshotId','watermark']);identity(value.snapshotId);sequence(value.watermark);
  } else { throw new ProtocolError('invalid_type'); }
  return value;
}
/** Hash exact decoded UTF-8 NDJSON bytes, never reserialised objects. */
export function snapshotDigest(chunks) {
  const hash=createHash('sha256');
  for(const chunk of chunks) { requireThat(chunk instanceof Uint8Array,'invalid_snapshot'); hash.update(chunk); }
  return hash.digest('hex');
}
