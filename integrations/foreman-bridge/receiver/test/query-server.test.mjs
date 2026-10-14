import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {request} from 'node:https';
import {once} from 'node:events';
import {createReceiver,loadConfig} from '../src/server.mjs';
import {MAX_RESPONSE_BYTES} from '../src/query.mjs';
import {row,storeHarness,testClock,up} from './support.mjs';
const path='/query/v1/constructors';
let dir,ca,cert,key;
before(()=>{dir=mkdtempSync(join(tmpdir(),'foreman-query-https-'));execFileSync('bash',['scripts/make-test-cert.sh',dir,'127.0.0.1'],{stdio:'pipe'});ca=readFileSync(join(dir,'ca.pem'));cert=readFileSync(join(dir,'server.pem'));key=readFileSync(join(dir,'server-key.pem'));});
after(()=>rmSync(dir,{recursive:true,force:true}));
async function listen(t,config,store) {
 const server=createReceiver({cert,key,host:'127.0.0.1',port:0,requestTimeoutMs:250,...config},store);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const port=server.address().port;
 return (body,{token,method='POST',route=path,headers={}}={})=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path:route,method,ca,headers:{'content-type':'application/json',...(token===undefined?{}:{authorization:'Bearer '+token}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,text,body:text?JSON.parse(text):undefined});});});
  req.on('error',reject);req.end(typeof body==='string'?body:JSON.stringify(body));
 });
}
async function setup(t,{queryToken=randomBytes(32).toString('hex'),clock=testClock()}={}) {
 const h=storeHarness(t,{clock}),token=randomBytes(32).toString('hex');
 const send=await listen(t,{token,...(queryToken?{queryToken}:{}),...h.binding},h.store);
 return {h,token,queryToken,send,clock};
}
test('query token receives the contract response with no-store caching',async t=>{
 const {h,queryToken,send}=await setup(t);h.hello();const a=row(randomUUID(),[1,2,3]);h.snapshot([a]);
 const response=await send({includeLocations:true},{token:queryToken});
 assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.match(response.headers['content-type'],/^application\/json/);
 const {evaluatedAt,revision,lastSyncAt,...rest}=response.body;
 assert.deepEqual(rest,{protocol:1,serverId:h.binding.serverId,worldId:h.binding.worldId,epoch:h.context.epoch,status:'fresh',reason:'recent_sync',totalCount:1,locations:[{entityId:a.entityId,position:[1,2,3]}],coordinateSystem:'unreal_cm',returnedCount:1,hasMore:false,nextCursor:null});
 assert.equal(typeof revision,'string');assert.equal(typeof evaluatedAt,'number');assert.equal(typeof lastSyncAt,'number');
});
test('no-baseline query is an ordinary 200 unavailable result',async t=>{
 const {queryToken,send}=await setup(t);const response=await send({},{token:queryToken});
 assert.equal(response.status,200);assert.deepEqual([response.body.status,response.body.reason,response.body.totalCount],['unavailable','no_baseline',null]);
});
test('absent, wrong and producer credentials cannot query; query credential cannot ingest',async t=>{
 const {h,token,queryToken,send}=await setup(t);h.hello();h.snapshot([]);
 for(const credential of [undefined,'wrong',token])assert.deepEqual((await send({},{token:credential})).body,{error:'unauthorized'});
 const hello={protocol:1,...h.binding,epoch:randomUUID(),requestId:randomUUID(),latestSeq:'0',oldestRetainedSeq:'0',provenance:{gameVersion:'1',smlVersion:'1',bridgeVersion:'1',starterCommit:'a'.repeat(40),bridgeSourceSha256:'b'.repeat(64)}};
 for(const route of ['/v1/hello','/v1/exchange','/v1/snapshot/chunk','/v1/snapshot/commit'])assert.equal((await send(hello,{token:queryToken,route})).status,401,route);
 assert.equal((await send(hello,{token,route:'/v1/hello'})).status,200);
});
test('unauthenticated query fails before the body is buffered',async t=>{
 const {h,token}=await setup(t);
 const port=await new Promise(resolve=>{const s=createReceiver({cert,key,token,queryToken:randomBytes(32).toString('hex'),...h.binding,requestTimeoutMs:5000},h.store);s.listen(0,'127.0.0.1',()=>resolve(s));t.after(()=>new Promise(r=>{s.closeAllConnections();s.close(r);}));}).then(s=>s.address().port);
 const status=await new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path,method:'POST',ca,headers:{authorization:'Bearer wrong','content-type':'application/json','transfer-encoding':'chunked'}},res=>{res.resume();res.on('end',()=>{req.destroy();resolve(res.statusCode);});});
  req.on('error',reject);req.write('{'); // Never finished: a 401 must not wait for the body.
 });assert.equal(status,401);
});
test('query routes are disabled without a query credential while ingestion still works',async t=>{
 const {h,token,send}=await setup(t,{queryToken:null});
 assert.equal((await send({},{token})).status,404);
 const hello={protocol:1,...h.binding,epoch:randomUUID(),requestId:randomUUID(),latestSeq:'0',oldestRetainedSeq:'0',provenance:{gameVersion:'1',smlVersion:'1',bridgeVersion:'1',starterCommit:'a'.repeat(40),bridgeSourceSha256:'b'.repeat(64)}};
 assert.equal((await send(hello,{token,route:'/v1/hello'})).status,200);
});
test('malformed queries are 400, a changed cursor is 409 and oversized bodies are 413',async t=>{
 const {h,queryToken,send}=await setup(t);h.hello();h.snapshot([row(),row(),row()]);
 for(const body of ['{',JSON.stringify({limit:101}),JSON.stringify({worldId:randomUUID()}),JSON.stringify({includeLocations:false,cursor:'abc'}),'[]','null'])assert.equal((await send(body,{token:queryToken})).status,400,body);
 assert.deepEqual((await send({includeLocations:true,cursor:'!!'},{token:queryToken})).body,{error:'invalid_cursor'});
 const first=(await send({includeLocations:true,limit:1},{token:queryToken})).body;h.exchange([up(1,row())]);
 const changed=await send({includeLocations:true,limit:1,cursor:first.nextCursor},{token:queryToken});assert.deepEqual([changed.status,changed.body],[409,{error:'state_changed'}]);
 assert.equal((await send(' '.repeat(8193),{token:queryToken})).status,413);
 assert.equal((await send(' '.repeat(8192-2)+'{}',{token:queryToken})).status,200);
 assert.equal((await send({},{token:queryToken,method:'GET'})).status,405);
 assert.equal((await send({},{token:queryToken,headers:{'content-type':'text/plain'}})).status,415);
});
test('a full page response stays within the response bound',async t=>{
 const {h,queryToken,send}=await setup(t);h.hello();h.snapshot(Array.from({length:120},()=>row(randomUUID(),[-123456789.125,987654321.5,-0.000001])));
 const response=await send({includeLocations:true,limit:100},{token:queryToken});
 assert.equal(response.status,200);assert.equal(response.body.returnedCount,100);assert.ok(Number(response.headers['content-length'])<=MAX_RESPONSE_BYTES);
});
test('an oversized query result is refused rather than truncated',async t=>{
 const token=randomBytes(32).toString('hex'),queryToken=randomBytes(32).toString('hex');
 const huge={queryConstructors:()=>({padding:'x'.repeat(MAX_RESPONSE_BYTES)})};
 const send=await listen(t,{token,queryToken,serverId:randomUUID(),worldId:randomUUID()},huge);
 assert.deepEqual((await send({},{token:queryToken})).body,{error:'response_too_large'});
});
test('storage failures are classified without internal detail',async t=>{
 const {h,queryToken,send}=await setup(t);h.hello();h.snapshot([]);
 const store=h.store;const original=store.queryConstructors;store.queryConstructors=()=>{throw Error('private sqlite path /secret/db');};
 t.after(()=>{store.queryConstructors=original;});
 const response=await send({},{token:queryToken});assert.deepEqual([response.status,response.text],[503,'{"error":"storage_unavailable"}']);
});
test('config accepts an optional distinct query credential',()=>{
 const configPath=join(dir,'query-config.json'),base={token:'x'.repeat(64),serverId:randomUUID(),worldId:randomUUID(),databasePath:join(dir,'receiver.db'),certPath:join(dir,'server.pem'),keyPath:join(dir,'server-key.pem')};
 writeFileSync(configPath,JSON.stringify(base),{mode:0o600});assert.equal(loadConfig(configPath).queryToken,undefined);
 writeFileSync(configPath,JSON.stringify({...base,queryToken:'y'.repeat(64)}));assert.equal(loadConfig(configPath).queryToken,'y'.repeat(64));
 for(const queryToken of ['x'.repeat(64),'short',42,'bad token with spaces'.repeat(4)]) {
  writeFileSync(configPath,JSON.stringify({...base,queryToken}));assert.throws(()=>loadConfig(configPath),JSON.stringify(queryToken));
 }
});
