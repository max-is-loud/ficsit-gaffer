// Reads the committed buildable projection for /query/v2/buildables: exact
// filtered totals, optional groups, and either an id-ordered page (with a
// revision-bound cursor) or one distance-sorted page. Runs inside the
// caller's read transaction so count, page, revision and status agree.

import {ProtocolError} from '../validation.mjs';
import {encodeCursor} from '../query.mjs';

const GROUP_COLUMNS={category:'category',class:'class_name',recipe:'recipe_name'};
const FILTER_COLUMNS={category:'category',className:'class_name',recipeName:'recipe_name'};

/** WHERE clause and parameters for the active epoch plus the query's filter. */
function scope(worldId,epoch,filter) {
 const clauses=['world_id=?','epoch=?'],params=[worldId,epoch];
 for(const [key,column] of Object.entries(FILTER_COLUMNS)) {
  if(filter[key]!==undefined) {clauses.push(`${column}=?`);params.push(filter[key]);}
 }
 return {where:clauses.join(' AND '),params};
}
function present(stored,distanceCm) {
 const {entityId,category,classPath,config,transform}=JSON.parse(stored);
 const row={entityId,category,classPath,position:transform.position,config};
 if(distanceCm!==undefined)row.distanceMetres=Math.round(distanceCm/10)/10;
 return row;
}
function groups(db,scoped,groupBy) {
 const column=GROUP_COLUMNS[groupBy];
 return db.all(`SELECT ${column} AS key,count(*) AS n FROM buildables WHERE ${scoped.where} GROUP BY ${column} ORDER BY n DESC,key IS NULL,key`,...scoped.params)
  .map(group=>({key:group.key,count:group.n}));
}
function nearest(db,scoped,query) {
 const [x,y,z]=query.from;
 const ranked=db.all(`SELECT entity_id,row_json FROM buildables WHERE ${scoped.where}`,...scoped.params).map(stored=>{
  const [px,py,pz]=JSON.parse(stored.row_json).transform.position;
  return {stored,distance:Math.hypot(px-x,py-y,pz-z)};
 }).sort((a,b)=>a.distance-b.distance||(a.stored.entity_id<b.stored.entity_id?-1:1));
 const page=ranked.slice(0,query.limit);
 return {rows:page.map(r=>present(r.stored.row_json,r.distance)),hasMore:ranked.length>query.limit,nextCursor:null};
}
function idOrdered(db,scoped,query,cursor,binding,revision) {
 const stored=db.all(`SELECT entity_id,row_json FROM buildables WHERE ${scoped.where} AND entity_id>? ORDER BY entity_id LIMIT ?`,...scoped.params,cursor?.after??'',query.limit+1);
 const page=stored.slice(0,query.limit),hasMore=stored.length>query.limit;
 return {rows:page.map(r=>present(r.row_json)),hasMore,nextCursor:hasMore?encodeCursor(binding.worldId,revision,page.at(-1).entity_id):null};
}

/** @param {{get:Function,all:Function,evaluate:Function,now:Function}} db accessors and freshness for this store */
export function readBuildables(db,binding,query,cursor) {
 const base={protocol:2,serverId:binding.serverId,worldId:binding.worldId};
 const empty={rows:[],coordinateSystem:'unreal_cm',returnedCount:0,hasMore:false,nextCursor:null};
 const w=db.get('SELECT * FROM worlds WHERE world_id=?',binding.worldId);
 const m=db.get('SELECT * FROM sync_metadata WHERE world_id=?',binding.worldId);
 if(!w||w.server_id!==binding.serverId||w.active_epoch===''||!m) {
  if(cursor)throw new ProtocolError('state_changed',409);
  return {...base,revision:null,epoch:null,status:'unavailable',reason:'no_baseline',lastSyncAt:null,evaluatedAt:db.now(),totalCount:null,...(query.groupBy?{groups:[]}:{}),...empty};
 }
 if(cursor&&cursor.revision!==m.revision)throw new ProtocolError('state_changed',409);
 const e=db.get('SELECT ready FROM epochs WHERE world_id=? AND epoch=?',binding.worldId,w.active_epoch);
 // A pending snapshot for the active epoch is persisted, so it also survives restart.
 const status=e.ready?db.evaluate(binding.worldId,m.last_sync_at):{status:'last_known',reason:'resynchronizing',evaluatedAt:db.now()};
 const scoped=scope(binding.worldId,w.active_epoch,query.filter);
 const totalCount=db.get(`SELECT count(*) AS n FROM buildables WHERE ${scoped.where}`,...scoped.params).n;
 const state={...base,revision:m.revision,epoch:w.active_epoch,...status,lastSyncAt:m.last_sync_at,totalCount,...(query.groupBy?{groups:groups(db,scoped,query.groupBy)}:{}),...empty};
 if(!query.includeRows)return state;
 const page=query.from?nearest(db,scoped,query):idOrdered(db,scoped,query,cursor,binding,m.revision);
 return {...state,...page,returnedCount:page.rows.length};
}
