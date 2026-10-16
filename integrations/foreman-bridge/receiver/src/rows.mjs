// Protocol v2 buildable rows: the common v1 row plus a category and a
// configuration object whose exact shape is fixed per category. Adding a
// category is one entry in CATEGORY_SCHEMAS (and its twin in the plugin's
// RowCodec), never a new branch.

import {fields,identity,requireThat,text,uint32,unicode} from './validation.mjs';

/** @typedef {{platform:string, accountId:string, displayName:string}} Player */
/** @typedef {{position:number[], rotation:number[], scale:number[]}} Transform */
/** @typedef {'manufacturer'|'extractor'|'generator'|'storage'} Category */
/** @typedef {{entityId:string, actorPath:string, classPath:string, category:Category, config:Object<string,unknown>, transform:Transform, player:Player|null}} Row */

const PURITIES=['impure','normal','pure'];
// Every field must be present; each may be null when the game cannot say.
const FIELD_CHECKS={
  path:value=>text(value,4096,'invalid_row'),
  number:value=>requireThat(typeof value==='number'&&Number.isFinite(value),'invalid_row'),
  uint32:value=>uint32(value,'invalid_row'),
  boolean:value=>requireThat(typeof value==='boolean','invalid_row'),
  purity:value=>requireThat(PURITIES.includes(value),'invalid_row'),
};

/** Configuration fields per category, by field type. */
export const CATEGORY_SCHEMAS=Object.freeze({
  manufacturer:Object.freeze({recipe:'path',clockSpeed:'number',productionBoost:'number',powerShards:'uint32',somersloops:'uint32',paused:'boolean'}),
  extractor:Object.freeze({resource:'path',purity:'purity',node:'path',clockSpeed:'number',powerShards:'uint32',paused:'boolean'}),
  generator:Object.freeze({fuel:'path',clockSpeed:'number',powerShards:'uint32',paused:'boolean'}),
  storage:Object.freeze({}),
});

function validateConfig(category,config) {
  requireThat(typeof category==='string'&&Object.hasOwn(CATEGORY_SCHEMAS,category),'invalid_row');
  const schema=CATEGORY_SCHEMAS[category];
  fields(config,Object.keys(schema),[],'invalid_row');
  for(const [key,type] of Object.entries(schema)) {
    if(config[key]!==null) { FIELD_CHECKS[type](config[key]); }
  }
}

/** Validate one row (event payload or snapshot line). @returns {Row} */
export function validateRow(row) {
  fields(row,['entityId','actorPath','classPath','category','config','transform','player'],[],'invalid_row'); identity(row.entityId);
  text(row.actorPath,4096,'invalid_row'); text(row.classPath,4096,'invalid_row');
  validateConfig(row.category,row.config);
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

/** The final `.`-separated segment of a class path — the key sf-game-data uses. */
export function className(path) {
  return path.slice(path.lastIndexOf('.')+1);
}
