import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeRequest, validateResponse, snapshotDigest} from '../src/protocol.mjs';
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v1.json', import.meta.url)));
for (const fixture of fixtures.cases) {
  test(fixture.name, () => {
    const raw = fixture.rawHex ? Buffer.from(fixture.rawHex, 'hex') : Buffer.from(fixture.body);
    const run = () => fixture.direction === 'request'
      ? decodeRequest(fixture.kind, raw) : validateResponse(raw, fixture.expected);
    if (fixture.error) { assert.throws(run, {code:fixture.error}); }
    else { assert.deepEqual(run(), JSON.parse(fixture.body)); }
  });
}
for (const fixture of fixtures.digests) {
  test(fixture.name, () => assert.equal(snapshotDigest(fixture.chunks.map(x => Buffer.from(x))), fixture.sha256));
}
test('large sequences remain strings', () => {
  const body = fixtures.cases.find(x => x.name === 'validLargeSeq').body;
  assert.equal(decodeRequest('exchange', Buffer.from(body)).events[0].seq, '9007199254740993');
});
if (process.env.FOREMAN_INTEROP) {
  const interop=JSON.parse(readFileSync(process.env.FOREMAN_INTEROP));
  test('Unreal emitted every valid request fixture',()=>assert.equal(interop.requests.length,fixtures.cases.filter(x=>x.direction==='request'&&!x.error).length));
  for(const item of interop.requests) {
    test(`Unreal bytes: ${item.name}`,()=> {
      const fixture=fixtures.cases.find(x=>x.name===item.name);
      assert.deepEqual(decodeRequest(fixture.kind,Buffer.from(item.hex,'hex')),JSON.parse(fixture.body));
    });
  }
}
