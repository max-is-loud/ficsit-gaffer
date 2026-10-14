import {createServer} from 'node:https';
import {readFileSync,statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {decodeRequest,ProtocolError,MAX_BODY_BYTES} from './protocol.mjs';

/** @typedef {{token:string,serverId:string,worldId:string,host:string,port:number,databasePath:string,cert:Buffer,key:Buffer,requestTimeoutMs?:number}} ReceiverConfig */
/** @returns {ReceiverConfig} */
export function loadConfig(absolutePath) {
 if(!isAbsolute(absolutePath))throw Error('Configuration path must be absolute');
 if((statSync(absolutePath).mode&0o077)!==0)throw Error('Configuration must be private (0600)');
 const value=JSON.parse(readFileSync(absolutePath,'utf8'));
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 if(typeof value.token!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(value.token)||!uuid.test(value.serverId)||!uuid.test(value.worldId))throw Error('Invalid receiver identity or token');
 for(const field of ['databasePath','certPath','keyPath'])if(typeof value[field]!=='string'||!isAbsolute(value[field]))throw Error('Storage and TLS paths must be absolute');
 if((statSync(value.keyPath).mode&0o077)!==0)throw Error('TLS key must be private (0600)');
 const host=value.host??'127.0.0.1',port=value.port??9443,requestTimeoutMs=value.requestTimeoutMs??5000;
 if(typeof host!=='string'||host.length===0||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<100||requestTimeoutMs>30000)throw Error('Invalid receiver listener settings');
 return {...value,host,port,requestTimeoutMs,cert:readFileSync(value.certPath),key:readFileSync(value.keyPath)};
}

/** HTTPS boundary: authenticate before buffering and expose only classified errors. */
export function createReceiver(config,store) {
 const tokenHash=createHash('sha256').update(config.token).digest();
 const routes=new Map([['/v1/hello',['hello','hello']],['/v1/snapshot/chunk',['snapshot/chunk','stageChunk']],['/v1/snapshot/commit',['snapshot/commit','commitSnapshot']],['/v1/exchange',['exchange','exchange']]]);
 const timeout=config.requestTimeoutMs??5000;
 const server=createServer({key:config.key,cert:config.cert,minVersion:'TLSv1.2',maxHeaderSize:8192,requestTimeout:timeout,headersTimeout:timeout,handshakeTimeout:timeout},(req,res)=>{
  let finished=false,timer;
  const reply=(status,body)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   const bytes=Buffer.from(JSON.stringify(body));
   res.writeHead(status,{'content-type':'application/json','content-length':bytes.length,'cache-control':'no-store',connection:'close'});res.end(bytes);
  };
  if(req.url==='/healthz'&&req.method==='GET')return reply(200,{ready:true});
  const auth=req.headers.authorization;
  const supplied=typeof auth==='string'&&auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!timingSafeEqual(tokenHash,createHash('sha256').update(supplied).digest()))return reply(401,{error:'unauthorized'});
  const route=routes.get(req.url);
  if(!route)return reply(404,{error:'not_found'});
  if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(req.headers['content-encoding']!==undefined||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))return reply(415,{error:'unsupported_media_type'});
  if(Number(req.headers['content-length']??0)>MAX_BODY_BYTES)return reply(413,{error:'payload_too_large'});
  const chunks=[];let length=0;
  timer=setTimeout(()=>reply(408,{error:'request_timeout'}),timeout);timer.unref();
  req.on('data',chunk=>{if(finished)return;length+=chunk.length;if(length>MAX_BODY_BYTES){chunks.length=0;reply(413,{error:'payload_too_large'});return;}chunks.push(chunk);});
  req.on('end',()=>{
   if(finished)return;
   try {
    const q=decodeRequest(route[0],Buffer.concat(chunks,length));
    if(q.serverId!==config.serverId||q.worldId!==config.worldId)return reply(403,{error:'wrong_binding'});
    const result=store[route[1]](q,Date.now());
    reply(200,result);
   } catch(error) {
    if(error instanceof ProtocolError)reply(error.status,{error:error.code,...(error.expectedSeq?{expectedSeq:error.expectedSeq}:{})});
    else reply(503,{error:'storage_unavailable'});
   }finally{chunks.length=0;}
  });
  req.on('error',()=>{clearTimeout(timer);finished=true;});
  req.on('close',()=>clearTimeout(timer));
 });
 server.maxHeadersCount=40;server.keepAliveTimeout=1000;
 server.on('clientError',(error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');else socket.destroy();});
 return server;
}
