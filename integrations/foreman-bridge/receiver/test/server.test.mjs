import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {request} from 'node:https';
import {once} from 'node:events';
import {createReceiver,loadConfig} from '../src/server.mjs';
import {openStore} from '../src/store.mjs';
import {snapshotDigest,MAX_BODY_BYTES} from '../src/protocol.mjs';
let dir,ca,cert,key;
before(()=>{dir=mkdtempSync(join(tmpdir(),'foreman-https-'));execFileSync('bash',['scripts/make-test-cert.sh',dir,'127.0.0.1'],{stdio:'pipe'});ca=readFileSync(join(dir,'ca.pem'));cert=readFileSync(join(dir,'server.pem'));key=readFileSync(join(dir,'server-key.pem'));});
after(()=>rmSync(dir,{recursive:true,force:true}));
async function setup(t,options={}) {
 const token=randomBytes(32).toString('hex'),serverId=randomUUID(),worldId=randomUUID();
 const store=openStore(join(dir,randomUUID()+'.db'),options);
 const config={token,serverId,worldId,cert,key,host:'127.0.0.1',port:0,requestTimeoutMs:250};
 const server=createReceiver(config,store);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();});
 const port=server.address().port;
 function send(body,path='/v1/hello',changes={}) {return new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path,method:'POST',ca,headers:{authorization:'Bearer '+token,'content-type':'application/json',...changes.headers},...changes},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(typeof body==='string'?body:JSON.stringify(body));
 });}
 const hello={protocol:1,serverId,worldId,epoch:randomUUID(),requestId:randomUUID(),latestSeq:'0',oldestRetainedSeq:'0',provenance:{gameVersion:'513885',smlVersion:'3.12',bridgeVersion:'0.1',starterCommit:'a'.repeat(40),bridgeSourceSha256:'b'.repeat(64)}};
 async function baseline(){const h=JSON.parse((await send(hello)).body);const q={protocol:1,serverId,worldId,epoch:hello.epoch,connectionId:h.connectionId,requestId:randomUUID()};await send({...q,snapshotId:randomUUID(),watermark:'0',chunkCount:0,rowCount:0,sha256:snapshotDigest([])},'/v1/snapshot/commit');return q;}
 return {send,hello,baseline,token,port,store,config};
}
test('TLS trust/hostname enforced and health exposes readiness only',async t=>{
 const h=await setup(t);assert.deepEqual(await h.send('', '/healthz',{method:'GET'}),{status:200,body:'{"ready":true}'});
 await assert.rejects(h.send(h.hello,'/v1/hello',{ca:undefined}));
 await assert.rejects(h.send(h.hello,'/v1/hello',{servername:'wrong.example'}),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});
 assert.equal((await h.send(h.hello)).status,200);
});
test('auth before parsing, binding, strict schema, routes and encoding',async t=>{
 const h=await setup(t);
 for(const authorization of ['', 'Bearer wrong'])assert.equal((await h.send('bad json','/v1/hello',{headers:{authorization,'content-type':'application/json'}})).status,401);
 assert.equal((await h.send({...h.hello,worldId:randomUUID()})).status,403);
 assert.equal((await h.send({...h.hello,serverId:randomUUID()})).status,403);
 assert.equal((await h.send('{')).status,400);
 assert.equal((await h.send({...h.hello,protocol:2})).status,426);
 assert.equal((await h.send({...h.hello,latestSeq:1})).status,400);
 assert.equal((await h.send(h.hello,'/v1/nope')).status,404);
 assert.equal((await h.send(h.hello,'/v1/hello',{method:'PUT'})).status,405);
 assert.equal((await h.send(h.hello,'/v1/hello',{headers:{authorization:'Bearer '+h.token,'content-type':'application/json','content-encoding':'gzip'}})).status,415);
});
test('size limit rejects ordinary and unfinished chunked uploads',async t=>{
 const h=await setup(t);assert.equal((await h.send(' '.repeat(MAX_BODY_BYTES+1))).status,413);
 const status=await new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:h.port,path:'/v1/hello',method:'POST',ca,headers:{authorization:'Bearer '+h.token,'content-type':'application/json','transfer-encoding':'chunked'}},res=>{res.resume();res.on('end',()=>{req.destroy();resolve(res.statusCode);});});req.on('error',reject);
  req.write(Buffer.alloc(MAX_BODY_BYTES+1,32)); // No terminating chunk: must reject before upload completion.
 });assert.equal(status,413);
});
test('unfinished authenticated request times out',async t=>{
 const h=await setup(t);
 const status=await new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:h.port,path:'/v1/hello',method:'POST',ca,headers:{authorization:'Bearer '+h.token,'content-type':'application/json','transfer-encoding':'chunked'}},res=>{res.resume();res.on('end',()=>{req.destroy();resolve(res.statusCode);});});req.on('error',reject);req.write('{');
 });assert.equal(status,408);
});
test('durable ACK, conflicts and database failures map to safe HTTP errors',async t=>{
 let fail=false;const h=await setup(t,{beforeCommit:()=>{if(fail)throw Error('private failure detail');}});const q=await h.baseline();
 const event={seq:'1',type:'constructor.remove',origin:'placed',entityId:randomUUID()};
 const response=await h.send({...q,requestId:randomUUID(),events:[event],commandResults:[]},'/v1/exchange');assert.equal(response.status,200);assert.equal(JSON.parse(response.body).ackSeq,'1');
 assert.equal((await h.send({...q,events:[{...event,entityId:randomUUID()}],commandResults:[]},'/v1/exchange')).status,409);
 assert.equal((await h.send({...q,connectionId:randomUUID(),events:[],commandResults:[]},'/v1/exchange')).status,409);
 fail=true;const failed=await h.send({...q,events:[{...event,seq:'2'}],commandResults:[]},'/v1/exchange');assert.equal(failed.status,503);assert.deepEqual(JSON.parse(failed.body),{error:'storage_unavailable'});
 fail=false;const recovered=await h.send({...q,events:[],commandResults:[]},'/v1/exchange');assert.equal(JSON.parse(recovered.body).ackSeq,'1');
});
test('private absolute config loads TLS files with loopback default',()=>{
 const path=join(dir,'config.json'),data={token:'x'.repeat(64),serverId:randomUUID(),worldId:randomUUID(),port:9443,databasePath:join(dir,'receiver.db'),certPath:join(dir,'server.pem'),keyPath:join(dir,'server-key.pem')};
 writeFileSync(path,JSON.stringify(data),{mode:0o600});assert.equal(loadConfig(path).host,'127.0.0.1');assert.throws(()=>loadConfig('relative.json'));
 chmodSync(path,0o644);assert.throws(()=>loadConfig(path));chmodSync(path,0o600);
 writeFileSync(path,JSON.stringify({...data,token:'short'}));assert.throws(()=>loadConfig(path));
});
