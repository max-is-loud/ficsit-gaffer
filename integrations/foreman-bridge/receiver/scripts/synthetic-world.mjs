#!/usr/bin/env node
// Time the receiver against a synthetic world of N buildables: snapshot
// staging + commit through the real store, then the queries the foreman makes
// (count, group by recipe, 100 nearest rows). Uses a temporary database only.
//
//   node scripts/synthetic-world.mjs --rows 5000
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {openStore} from '../src/store.mjs';
import {snapshotDigest} from '../src/protocol.mjs';

const CHUNK_BYTES=32000; // Matches the plugin's snapshot chunking.
const RECIPES=['Recipe_IngotIron_C','Recipe_IronPlate_C','Recipe_IronRod_C','Recipe_Screw_C','Recipe_Wire_C',null];
const KINDS=[
 index=>({category:'manufacturer',classPath:'/Game/FactoryGame/Buildable/Factory/SmelterMk1/Build_SmelterMk1.Build_SmelterMk1_C',
  config:{recipe:RECIPES[index%RECIPES.length]&&`/Game/FactoryGame/Recipes/R/${RECIPES[index%RECIPES.length].slice(0,-2)}.${RECIPES[index%RECIPES.length]}`,clockSpeed:1,productionBoost:1,powerShards:index%4,somersloops:0,paused:index%17===0}}),
 ()=>({category:'extractor',classPath:'/Game/FactoryGame/Buildable/Factory/MinerMk2/Build_MinerMk2.Build_MinerMk2_C',
  config:{resource:'/Game/FactoryGame/Resource/RawResources/OreIron/Desc_OreIron.Desc_OreIron_C',purity:'normal',node:'Persistent_Level.BP_ResourceNode_1',clockSpeed:1.5,powerShards:1,paused:false}}),
 ()=>({category:'generator',classPath:'/Game/FactoryGame/Buildable/Factory/GeneratorCoal/Build_GeneratorCoal.Build_GeneratorCoal_C',
  config:{fuel:'/Game/FactoryGame/Resource/RawResources/Coal/Desc_Coal.Desc_Coal_C',clockSpeed:1,powerShards:0,paused:false}}),
 ()=>({category:'storage',classPath:'/Game/FactoryGame/Buildable/Factory/StorageContainerMk1/Build_StorageContainerMk1.Build_StorageContainerMk1_C',config:{}}),
];

function syntheticRows(count) {
 return Array.from({length:count},(_,index)=>{
  const entityId=randomUUID();
  return {entityId,actorPath:`Persistent_Level.Build_${index}`,...KINDS[index%KINDS.length](index),
   transform:{position:[(index%100)*800,Math.floor(index/100)*800,(index%7)*400],rotation:[0,90,0],scale:[1,1,1]},player:null};
 }).sort((a,b)=>a.entityId<b.entityId?-1:1);
}
function chunks(rows) {
 const out=[];let chunk='';
 for(const row of rows) {
  const line=JSON.stringify(row)+'\n';
  if(chunk.length+line.length>CHUNK_BYTES) {out.push(chunk);chunk='';}
  chunk+=line;
 }
 if(chunk)out.push(chunk);
 return out;
}
function timed(fn) {const start=performance.now();const result=fn();return {ms:Math.round((performance.now()-start)*100)/100,result};}

export function measure(rowCount) {
 const dir=mkdtempSync(join(tmpdir(),'foreman-synthetic-')),store=openStore(join(dir,'state.db'));
 try {
  const context={protocol:2,serverId:randomUUID(),worldId:randomUUID(),epoch:randomUUID()},binding={serverId:context.serverId,worldId:context.worldId};
  const request=extra=>({...context,requestId:randomUUID(),...extra});
  const hello=store.hello({...request({latestSeq:'0',oldestRetainedSeq:'0',provenance:{gameVersion:'1',smlVersion:'1',bridgeVersion:'1',starterCommit:'a'.repeat(40),bridgeSourceSha256:'b'.repeat(64)}})},Date.now());
  context.connectionId=hello.connectionId;
  const rows=syntheticRows(rowCount),data=chunks(rows),snapshotId=randomUUID();
  const commit=timed(()=>{
   data.forEach((chunk,chunkIndex)=>store.stageChunk(request({snapshotId,chunkIndex,data:chunk})));
   store.commitSnapshot(request({snapshotId,watermark:'0',chunkCount:data.length,rowCount:rows.length,sha256:snapshotDigest(data.map(x=>Buffer.from(x)))}),Date.now());
  });
  const count=timed(()=>store.queryBuildables(binding,{}));
  const grouped=timed(()=>store.queryBuildables(binding,{groupBy:'recipe'}));
  const nearest=timed(()=>store.queryBuildables(binding,{from:[0,0,0],includeRows:true,limit:100}));
  if(count.result.totalCount!==rowCount||nearest.result.returnedCount!==Math.min(100,rowCount))throw new Error('synthetic world did not round-trip');
  return {rows:rowCount,chunks:data.length,snapshotCommitMs:commit.ms,countQueryMs:count.ms,groupByRecipeMs:grouped.ms,distance100Ms:nearest.ms};
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===`file://${process.argv[1]}`) {
 const flag=process.argv.indexOf('--rows'),rowCount=Number(process.argv[flag+1]);
 if(flag<0||!Number.isInteger(rowCount)||rowCount<1) {console.error('Usage: synthetic-world.mjs --rows <N>');process.exit(2);}
 console.log(JSON.stringify(measure(rowCount)));
}
