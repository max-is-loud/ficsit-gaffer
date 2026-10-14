import {ProtocolError} from './protocol.mjs';

/** @typedef {{includeLocations:boolean, limit:number, cursor?:string}} ConstructorQuery */
/** @typedef {{worldId:string, revision:string, after:string}} Cursor */
export const DEFAULT_LIMIT=50;
export const MAX_LIMIT=100;
export const MAX_QUERY_BYTES=8192;
export const MAX_RESPONSE_BYTES=256*1024;
const MAX_CURSOR_LENGTH=1024;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid=code=>new ProtocolError(code,400);

/** Validate an application query. Unknown fields never pass. @returns {ConstructorQuery} */
export function validateQuery(input) {
 if(input===null||typeof input!=='object'||Array.isArray(input))throw invalid('invalid_query');
 if(!Object.keys(input).every(key=>key==='includeLocations'||key==='limit'||key==='cursor'))throw invalid('invalid_query');
 const includeLocations=input.includeLocations??false,limit=input.limit??DEFAULT_LIMIT;
 if(typeof includeLocations!=='boolean')throw invalid('invalid_query');
 if(!Number.isInteger(limit)||limit<1||limit>MAX_LIMIT)throw invalid('invalid_query');
 const query={includeLocations,limit};
 if(input.cursor!==undefined) {
  // A continuation only makes sense for a location listing.
  if(!includeLocations||typeof input.cursor!=='string'||input.cursor.length===0||input.cursor.length>MAX_CURSOR_LENGTH)throw invalid('invalid_query');
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
