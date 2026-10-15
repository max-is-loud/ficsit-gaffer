// Tests for parsing and validating source-limits.json.
// They pin the accepted shape and every rejection the ratchet list relies on.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, parseConfig } from '../config.mjs';

const valid = {
  $comment: 'ratchet',
  softLimit: 300,
  hardLimit: 500,
  ignore: ['**/dist/**'],
  exemptDirectories: [{ path: 'integrations/foreman-bridge/', issue: 10, reason: 'Rewrite' }],
  exemptFiles: [{ path: 'packages/a/src/big.ts', lines: 900, issue: 42 }],
};

const parse = (overrides) => parseConfig(JSON.stringify({ ...valid, ...overrides }));

test('parses a valid config', () => {
  const { $comment, ...expected } = valid;
  assert.equal($comment, 'ratchet');
  assert.deepEqual(parse({}), expected);
});

test('rejects invalid JSON with a ConfigError', () => {
  assert.throws(
    () => parseConfig('{nope'),
    (error) => error instanceof ConfigError && error.message.includes('source-limits.json'),
  );
});

test('rejects unknown keys', () => {
  assert.throws(() => parse({ extra: 1 }), /source-limits\.json: .*extra/);
  assert.throws(
    () => parse({ exemptFiles: [{ path: 'a.ts', lines: 600, issue: 1, more: true }] }),
    ConfigError,
  );
});

test('rejects an exemption without an issue number', () => {
  assert.throws(
    () => parse({ exemptFiles: [{ path: 'a.ts', lines: 600 }] }),
    /source-limits\.json: .*issue/,
  );
});

test('rejects a non-positive or fractional issue number', () => {
  for (const issue of [0, -3, 1.5, '7']) {
    assert.throws(
      () => parse({ exemptFiles: [{ path: 'a.ts', lines: 600, issue }] }),
      /source-limits\.json: .*issue/,
    );
  }
});

test('rejects duplicate exempt paths', () => {
  const entry = { path: 'a.ts', lines: 600, issue: 1 };
  assert.throws(() => parse({ exemptFiles: [entry, entry] }), /source-limits\.json: .*duplicate/i);
});

test('rejects softLimit >= hardLimit', () => {
  assert.throws(() => parse({ softLimit: 500 }), /source-limits\.json: .*softLimit/);
});
