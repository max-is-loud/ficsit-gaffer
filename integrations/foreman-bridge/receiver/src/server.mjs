import {createServer} from 'node:https';
import {readFileSync,statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {decodeRequest,ProtocolError,MAX_BODY_BYTES} from './protocol.mjs';
import {MAX_QUERY_BYTES,MAX_RESPONSE_BYTES} from './query.mjs';

/** @typedef {{token:string,queryToken?:string,serverId:string,worldId:string,host:string,port:number,databasePath:string,cert:Buffer,key:Buffer,requestTimeoutMs?:number}} ReceiverConfig */
/** @returns {ReceiverConfig} */
export function loadConfig(absolutePath) {
 if(!isAbsolute(absolutePath))throw Error('Configuration path must be absolute');
 if((statSync(absolutePath).mode&0o077)!==0)throw Error('Configuration must be private (0600)');
 const value=JSON.parse(readFileSync(absolutePath,'utf8'));
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 const token=/^[A-Za-z0-9_-]{32,256}$/;
 if(typeof value.token!=='string'||!token.test(value.token)||!uuid.test(value.serverId)||!uuid.test(value.worldId))throw Error('Invalid receiver identity or token');
 // The optional read-only credential must differ from the producer credential.
 if(value.queryToken!==undefined&&(typeof value.queryToken!=='string'||!token.test(value.queryToken)||value.queryToken===value.token))throw Error('Invalid receiver query token');
 for(const field of ['databasePath','certPath','keyPath'])if(typeof value[field]!=='string'||!isAbsolute(value[field]))throw Error('Storage and TLS paths must be absolute');
 if((statSync(value.keyPath).mode&0o077)!==0)throw Error('TLS key must be private (0600)');
 const host=value.host??'127.0.0.1',port=value.port??9443,requestTimeoutMs=value.requestTimeoutMs??5000;
 if(typeof host!=='string'||host.length===0||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<100||requestTimeoutMs>30000)throw Error('Invalid receiver listener settings');
 return {...value,host,port,requestTimeoutMs,cert:readFileSync(value.certPath),key:readFileSync(value.keyPath)};
}

const digest=value=>createHash('sha256').update(value).digest();
const QUERY_ROUTE='/query/v1/constructors';

/** HTTPS boundary: authenticate before buffering and expose only classified errors.
 * The producer credential reaches only ingestion routes; the optional query
 * credential reaches only the read-only query route. */
export function createReceiver(config,store) {
 const tokenHash=digest(config.token),queryHash=config.queryToken===undefined?undefined:digest(config.queryToken);
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
  const query=queryHash!==undefined&&req.url===QUERY_ROUTE;
  if(!timingSafeEqual(query?queryHash:tokenHash,digest(supplied)))return reply(401,{error:'unauthorized'});
  const route=query?undefined:routes.get(req.url);
  if(!query&&!route)return reply(404,{error:'not_found'});
  if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(req.headers['content-encoding']!==undefined||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))return reply(415,{error:'unsupported_media_type'});
  const limit=query?MAX_QUERY_BYTES:MAX_BODY_BYTES;
  if(Number(req.headers['content-length']??0)>limit)return reply(413,{error:'payload_too_large'});
  const chunks=[];let length=0;
  timer=setTimeout(()=>reply(408,{error:'request_timeout'}),timeout);timer.unref();
  req.on('data',chunk=>{if(finished)return;length+=chunk.length;if(length>limit){chunks.length=0;reply(413,{error:'payload_too_large'});return;}chunks.push(chunk);});
  req.on('end',()=>{
   if(finished)return;
   if(query) {
    try {
     let input;
     try {input=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks,length)));} catch {throw new ProtocolError('invalid_query');}
     const result=store.queryConstructors({serverId:config.serverId,worldId:config.worldId},input);
     if(Buffer.byteLength(JSON.stringify(result))>MAX_RESPONSE_BYTES)return reply(503,{error:'response_too_large'});
     reply(200,result);
    } catch(error) {
     if(error instanceof ProtocolError)reply(error.status,{error:error.code});
     else reply(503,{error:'storage_unavailable'});
    } finally {chunks.length=0;}
    return;
   }
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
