// Tests for the ratchet updater: it may only lower counts and remove entries, never add or raise.
// writeConfig is checked for the on-disk shape that reviewers will see in diffs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyUpdates, writeConfig } from '../update.mjs';

const baseConfig = () => ({
  softLimit: 300,
  hardLimit: 500,
  ignore: ['**/dist/**'],
  exemptDirectories: [],
  exemptFiles: [
    { path: 'a.ts', lines: 900, issue: 1 },
    { path: 'b.ts', lines: 800, issue: 2 },
    { path: 'c.ts', lines: 700, issue: 3 },
  ],
});
const finding = (fields) => ({ severity: 'error', ...fields });

test('lowers a shrunk count', () => {
  const result = applyUpdates({
    config: baseConfig(),
    findings: [
      finding({ path: 'a.ts', kind: 'exempt-shrunk', lines: 850, recorded: 900, issue: 1 }),
    ],
  });
  assert.equal(result.exemptFiles.find((entry) => entry.path === 'a.ts').lines, 850);
});

test('removes a compliant entry and a missing-file entry', () => {
  const result = applyUpdates({
    config: baseConfig(),
    findings: [
      finding({ path: 'a.ts', kind: 'exempt-compliant', lines: 400, issue: 1 }),
      finding({ path: 'b.ts', kind: 'exempt-missing', issue: 2 }),
    ],
  });
  assert.deepEqual(
    result.exemptFiles.map((entry) => entry.path),
    ['c.ts'],
  );
});

test('leaves a grown entry unchanged', () => {
  const result = applyUpdates({
    config: baseConfig(),
    findings: [finding({ path: 'a.ts', kind: 'exempt-grew', lines: 950, recorded: 900, issue: 1 })],
  });
  assert.deepEqual(result, baseConfig());
});

test('never adds an entry for a new oversized file', () => {
  const result = applyUpdates({
    config: baseConfig(),
    findings: [finding({ path: 'new.ts', kind: 'too-long', lines: 600 })],
  });
  assert.deepEqual(result, baseConfig());
});

test('does not mutate the config it is given', () => {
  const config = baseConfig();
  applyUpdates({
    config,
    findings: [finding({ path: 'a.ts', kind: 'exempt-compliant', lines: 400, issue: 1 })],
  });
  assert.deepEqual(config, baseConfig());
});

test('writeConfig puts $comment first and ends with a newline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-update-'));
  const target = path.join(dir, 'source-limits.json');
  writeConfig({ path: target, config: baseConfig() });
  const text = fs.readFileSync(target, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(text.endsWith('}\n'));
  assert.equal(Object.keys(JSON.parse(text))[0], '$comment');
  assert.ok(text.includes('\n  "softLimit": 300,'));
});
