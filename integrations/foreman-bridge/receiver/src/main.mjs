import {loadConfig,createReceiver} from './server.mjs';
import {openStore} from './store.mjs';
if(process.argv.length!==4||process.argv[2]!=='--config') {
 console.error('Usage: node src/main.mjs --config /absolute/private/config.json');process.exitCode=1;
} else {
 try {
  const config=loadConfig(process.argv[3]),store=openStore(config.databasePath),server=createReceiver(config,store);
  server.on('error',()=>{console.error('Receiver listener failed');store.close();process.exitCode=1;});
  server.listen(config.port,config.host,()=>console.log(`Receiver ready on ${config.host}:${config.port}`));
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;server.closeAllConnections();server.close(()=>store.close());};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }catch{console.error('Receiver startup failed; check private config, TLS files and database permissions');process.exitCode=1;}
}
