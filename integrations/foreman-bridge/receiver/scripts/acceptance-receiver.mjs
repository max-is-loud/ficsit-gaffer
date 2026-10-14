#!/usr/bin/env node
// Explicit acceptance-only entrypoint. The normal receiver never reads this gate.
import {existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadConfig,createReceiver} from '../src/server.mjs';
import {openStore} from '../src/store.mjs';
import {ProtocolError} from '../src/protocol.mjs';
export function withCommitGate(store,held) {
 return {...store,commitSnapshot(q,now){
  if(held())throw new ProtocolError('acceptance_commit_held',503);
  return store.commitSnapshot(q,now);
 }};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  if(process.argv.length!==4||process.argv[2]!=='--config')throw Error('Arguments');
  const config=loadConfig(process.argv[3]);
  const gate=join(dirname(process.argv[3]),'hold-snapshot-commit');
  const store=openStore(config.databasePath),server=createReceiver(config,withCommitGate(store,()=>existsSync(gate)));
  server.on('error',()=>{console.error('Acceptance listener failed');store.close();process.exitCode=1;});
  server.listen(config.port,config.host,()=>console.log('Acceptance receiver ready; snapshot commit gate available'));
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;server.closeAllConnections();server.close(()=>store.close());};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }catch{console.error('Acceptance receiver startup failed');process.exitCode=1;}
}
