import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeRequest, validateResponse, snapshotDigest, ProtocolError} from '../src/protocol.mjs';
import {className, CATEGORY_SCHEMAS} from '../src/rows.mjs';
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2.json', import.meta.url)));
for (const fixture of fixtures.cases) {
  test(fixture.name, () => {
    const raw = fixture.rawHex ? Buffer.from(fixture.rawHex, 'hex') : Buffer.from(fixture.body);
    const run = () => fixture.direction === 'request'
      ? decodeRequest(fixture.kind, raw) : validateResponse(raw, fixture.expected);
    if (fixture.error) { assert.throws(run, error => error instanceof ProtocolError && error.code===fixture.error); }
    else { assert.deepEqual(run(), JSON.parse(fixture.body)); }
  });
}
for (const fixture of fixtures.digests) {
  test(fixture.name, () => assert.equal(snapshotDigest(fixture.chunks.map(x => Buffer.from(x))), fixture.sha256));
}
test('provenance hashes must be strings before pattern checks', () => {
  const valid = JSON.parse(fixtures.cases.find(x => x.name === 'helloEmpty').body);
  assert.deepEqual(decodeRequest('hello', Buffer.from(JSON.stringify(valid))), valid);
  for (const field of ['starterCommit', 'bridgeSourceSha256']) {
    const malformed = {...valid, provenance:{...valid.provenance, [field]:[valid.provenance[field]]}};
    assert.throws(() => decodeRequest('hello', Buffer.from(JSON.stringify(malformed))), ProtocolError);
  }
});
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
test('class name is the final dotted segment of a class path', () => {
  assert.equal(className('/Game/X/Build_SmelterMk1.Build_SmelterMk1_C'), 'Build_SmelterMk1_C');
  assert.equal(className('Build_Thing_C'), 'Build_Thing_C');
});
test('every category has a schema and storage has no fields', () => {
  assert.deepEqual(Object.keys(CATEGORY_SCHEMAS).sort(), ['extractor','generator','manufacturer','storage']);
  assert.deepEqual(CATEGORY_SCHEMAS.storage, {});
});
