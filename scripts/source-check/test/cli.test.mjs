// End-to-end tests for runCheck against throwaway git repositories.
// They cover exit codes, --update, root discovery and the one-line error exits.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runCheck } from '../../check-source-files.mjs';
import { makeRepo } from './fixtures.mjs';

const HEADER = '// A file.\n';
const lines = (count) => HEADER + 'const x = 1;\n'.repeat(count - 1);

const limits = (exemptFiles = []) =>
  JSON.stringify({
    softLimit: 300,
    hardLimit: 500,
    ignore: [],
    exemptDirectories: [],
    exemptFiles,
  });

test('a clean repo exits 0', () => {
  const root = makeRepo({ 'source-limits.json': limits(), 'src/a.ts': lines(10) });
  assert.equal(runCheck({ cwd: root, update: false }).exitCode, 0);
});

test('an oversized new file exits 1 with the too-long message', () => {
  const root = makeRepo({ 'source-limits.json': limits(), 'src/big.ts': lines(520) });
  const result = runCheck({ cwd: root, update: false });
  assert.equal(result.exitCode, 1);
  assert.match(result.text, /src\/big\.ts: 520 lines \(limit 500\)/);
});

test('--update after shrinking an exempt file rewrites the list and the next run exits 0', () => {
  const root = makeRepo({
    'source-limits.json': limits([{ path: 'src/big.ts', lines: 600, issue: 5 }]),
    'src/big.ts': lines(550),
  });
  assert.equal(runCheck({ cwd: root, update: false }).exitCode, 1);
  assert.equal(runCheck({ cwd: root, update: true }).exitCode, 0);
  const written = JSON.parse(fs.readFileSync(path.join(root, 'source-limits.json'), 'utf8'));
  assert.equal(written.exemptFiles[0].lines, 550);
  assert.equal(runCheck({ cwd: root, update: false }).exitCode, 0);
});

test('running from a subdirectory finds the root', () => {
  const root = makeRepo({ 'source-limits.json': limits(), 'src/big.ts': lines(520) });
  const result = runCheck({ cwd: path.join(root, 'src'), update: false });
  assert.equal(result.exitCode, 1);
});

test('running outside a git repo exits 2 with a one-line message', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
  const result = runCheck({ cwd: dir, update: false });
  assert.equal(result.exitCode, 2);
  assert.equal(result.text.split('\n').length, 1);
});

test('invalid JSON in source-limits.json exits 2 with a one-line message', () => {
  const root = makeRepo({ 'source-limits.json': '{ nope' });
  const result = runCheck({ cwd: root, update: false });
  assert.equal(result.exitCode, 2);
  assert.equal(result.text.split('\n').length, 1);
  assert.match(result.text, /^source-limits\.json: /);
});
