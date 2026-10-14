import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withCommitGate} from '../scripts/acceptance-receiver.mjs';
test('acceptance commit gate leaves store untouched until released',()=>{
 let held=true,calls=0;
 const store={commitSnapshot(q,now){++calls;return {q,now};},stageChunk(q){return q;}};
 const gated=withCommitGate(store,()=>held);
 assert.equal(gated.stageChunk('staged'),'staged');
 assert.throws(()=>gated.commitSnapshot('commit',123),{status:503,code:'acceptance_commit_held'});assert.equal(calls,0);
 held=false;assert.deepEqual(gated.commitSnapshot('commit',124),{q:'commit',now:124});assert.equal(calls,1);
});
