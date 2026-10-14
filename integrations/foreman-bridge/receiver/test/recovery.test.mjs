import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {runScenario} from '../scripts/replay-scenario.mjs';
let dir,config;
before(()=>{
 dir=mkdtempSync(join(tmpdir(),'foreman-recovery-tls-'));
 execFileSync('bash',['scripts/make-test-cert.sh',dir,'127.0.0.1'],{stdio:'pipe'});
 config={host:'127.0.0.1',port:0,token:randomBytes(32).toString('hex'),serverId:randomUUID(),worldId:randomUUID(),cert:readFileSync(join(dir,'server.pem')),key:readFileSync(join(dir,'server-key.pem')),ca:readFileSync(join(dir,'ca.pem'))};
});
after(()=>rmSync(dir,{recursive:true,force:true}));
test('HTTPS duplicate events and command results have one durable effect',async()=>{
 const r=await runScenario(config,'duplicate');
 assert.equal(r.count,1);assert.equal(r.eventReceipts,1);assert.equal(r.commands,1);assert.equal(r.executedCommands,1);assert.equal(r.pendingCommands,0);
});
test('HTTPS receiver reopen retains cursor; fresh database requires snapshot',async()=>{
 const r=await runScenario(config,'receiver-restart');
 assert.equal(r.resumeCursor,'1');assert.equal(r.count,1);assert.equal(r.emptyDatabaseMode,'snapshotRequired');
});
test('HTTPS partial snapshot stays invisible and post-watermark event survives',async()=>{
 const r=await runScenario(config,'snapshot-race');
 assert.equal(r.partialCount,1);assert.equal(r.count,2);assert.equal(r.cursor,'2');assert.equal(r.staleCommitStatus,409);
});
test('HTTPS 60-second receiver outage converges and retention loss requests snapshot',async()=>{
 const r=await runScenario(config,'outage');
 assert.ok(r.outageMs>=60000);assert.equal(r.count,2);assert.equal(r.cursor,'2');assert.equal(r.gapReason,'retention_gap');assert.equal(r.recoveredCount,3);
});
