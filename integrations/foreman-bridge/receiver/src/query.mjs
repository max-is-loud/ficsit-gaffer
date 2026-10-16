// The read-only buildables query contract (docs/query-v2.md): request
// validation and the opaque, revision-bound pagination cursor.
import {ProtocolError} from './protocol.mjs';

/** @typedef {{category?:string, className?:string, recipeName?:string}} BuildablesFilter */
/** @typedef {{filter:BuildablesFilter, groupBy?:'category'|'class'|'recipe', from?:number[], includeRows:boolean, limit:number, cursor?:string}} BuildablesQuery */
/** @typedef {{worldId:string, revision:string, after:string}} Cursor */
export const DEFAULT_LIMIT=50;
export const MAX_LIMIT=100;
export const MAX_QUERY_BYTES=8192;
export const MAX_RESPONSE_BYTES=256*1024;
const MAX_CURSOR_LENGTH=1024;
const MAX_NAME_LENGTH=256;
const QUERY_KEYS=['filter','groupBy','from','includeRows','limit','cursor'];
const FILTER_KEYS=['category','className','recipeName'];
const CATEGORIES=['manufacturer','extractor','generator','storage'];
const GROUPS=['category','class','recipe'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid=code=>new ProtocolError(code,400);
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const requireQuery=condition=>{if(!condition)throw invalid('invalid_query');};

function validateFilter(input={}) {
 requireQuery(isObject(input)&&Object.keys(input).every(key=>FILTER_KEYS.includes(key)));
 if(input.category!==undefined)requireQuery(CATEGORIES.includes(input.category));
 for(const key of ['className','recipeName']) {
  if(input[key]!==undefined)requireQuery(typeof input[key]==='string'&&input[key].length>0&&input[key].length<=MAX_NAME_LENGTH);
 }
 return {...input};
}

/** Validate an application query. Unknown fields never pass. @returns {BuildablesQuery} */
export function validateBuildablesQuery(input) {
 requireQuery(isObject(input)&&Object.keys(input).every(key=>QUERY_KEYS.includes(key)));
 const includeRows=input.includeRows??false,limit=input.limit??DEFAULT_LIMIT;
 requireQuery(typeof includeRows==='boolean'&&Number.isInteger(limit)&&limit>=1&&limit<=MAX_LIMIT);
 const query={filter:validateFilter(input.filter),includeRows,limit};
 if(input.groupBy!==undefined) {requireQuery(GROUPS.includes(input.groupBy));query.groupBy=input.groupBy;}
 if(input.from!==undefined) {
  requireQuery(Array.isArray(input.from)&&input.from.length===3&&input.from.every(x=>typeof x==='number'&&Number.isFinite(x)));
  query.from=[...input.from];
 }
 if(input.cursor!==undefined) {
  // A continuation only makes sense for an id-ordered row listing.
  requireQuery(includeRows&&query.from===undefined&&typeof input.cursor==='string'&&input.cursor.length>0&&input.cursor.length<=MAX_CURSOR_LENGTH);
  query.cursor=input.cursor;
 }
 return query;
}

/** Opaque continuation bound to world, committed revision and last returned entity. */
export function encodeCursor(worldId,revision,after) {
 return Buffer.from(JSON.stringify({v:1,w:worldId,r:revision,a:after})).toString('base64url');
}

/** Decode a continuation; the caller still checks world and revision. @returns {Cursor} */
export function decodeCursor(cursor) {
 if(!/^[A-Za-z0-9_-]+$/.test(cursor))throw invalid('invalid_cursor');
 let value;
 try {value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));} catch {throw invalid('invalid_cursor');}
 if(value===null||typeof value!=='object'||Array.isArray(value))throw invalid('invalid_cursor');
 const keys=Object.keys(value).sort();
 if(keys.join()!=='a,r,v,w'||value.v!==1)throw invalid('invalid_cursor');
 for(const key of ['w','r','a'])if(typeof value[key]!=='string'||!uuid.test(value[key]))throw invalid('invalid_cursor');
 return {worldId:value.w,revision:value.r,after:value.a};
}
