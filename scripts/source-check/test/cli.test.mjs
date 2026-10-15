// End-to-end tests for runCheck against throwaway git repositories.
// They cover exit codes, --update, root discovery and the one-line error exits.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCheck } from '../cli.mjs';
import { HERMETIC_GIT_ENV, makeRepo } from './fixtures.mjs';

const SCRIPT = fileURLToPath(new URL('../../check-source-files.mjs', import.meta.url));
const roots = [];
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const track = (dir) => {
  roots.push(dir);
  return dir;
};
const makeTracked = (files) => track(makeRepo(files));

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
  const root = makeTracked({ 'source-limits.json': limits(), 'src/a.ts': lines(10) });
  assert.equal(runCheck({ cwd: root, update: false }).exitCode, 0);
});

test('an oversized new file exits 1 with the too-long message', () => {
  const root = makeTracked({ 'source-limits.json': limits(), 'src/big.ts': lines(520) });
  const result = runCheck({ cwd: root, update: false });
  assert.equal(result.exitCode, 1);
  assert.match(result.text, /src\/big\.ts: 520 lines \(limit 500\)/);
});

test('--update after shrinking an exempt file rewrites the list and the next run exits 0', () => {
  const root = makeTracked({
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
  const root = makeTracked({ 'source-limits.json': limits(), 'src/big.ts': lines(520) });
  const result = runCheck({ cwd: path.join(root, 'src'), update: false });
  assert.equal(result.exitCode, 1);
});

test('running outside a git repo exits 2 with a one-line message', () => {
  const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-')));
  // A TMPDIR inside a repository must not turn this into a repo.
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(dir);
  const result = runCheck({ cwd: dir, update: false });
  delete process.env.GIT_CEILING_DIRECTORIES;
  assert.equal(result.exitCode, 2);
  assert.equal(result.text.split('\n').length, 1);
});

test('invalid JSON in source-limits.json exits 2 with a one-line message', () => {
  const root = makeTracked({ 'source-limits.json': '{ nope' });
  const result = runCheck({ cwd: root, update: false });
  assert.equal(result.exitCode, 2);
  assert.equal(result.text.split('\n').length, 1);
  assert.match(result.text, /^source-limits\.json: /);
});

// NODE_TEST_CONTEXT would make the child process behave as a nested test-runner worker.
const { NODE_TEST_CONTEXT: _context, ...CHILD_ENV } = HERMETIC_GIT_ENV;

const run = (script, root, args = []) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: CHILD_ENV,
  });

test('the script run as a subprocess reports an oversized file on stdout and exits 1', () => {
  const root = makeTracked({ 'source-limits.json': limits(), 'src/big.ts': lines(520) });
  const result = run(SCRIPT, root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /src\/big\.ts: 520 lines \(limit 500\)/);
});

test('the script reports invalid JSON as one line on stderr and exits 2', () => {
  const root = makeTracked({ 'source-limits.json': '{ nope' });
  const result = run(SCRIPT, root);
  assert.equal(result.status, 2);
  assert.equal(result.stderr.trimEnd().split('\n').length, 1);
  assert.equal(result.stdout, '');
});

test('the script still reports findings when launched through a symlink', () => {
  const root = makeTracked({ 'source-limits.json': limits(), 'src/big.ts': lines(520) });
  const linkDir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'source-check-link-')));
  const link = path.join(linkDir, 'check.mjs');
  fs.symlinkSync(SCRIPT, link);
  const result = run(link, root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /src\/big\.ts: 520 lines/);
});

test('an unknown flag exits 2 with a one-line message', () => {
  const root = makeTracked({ 'source-limits.json': limits(), 'src/a.ts': lines(10) });
  const result = run(SCRIPT, root, ['--udpate']);
  assert.equal(result.status, 2);
  assert.equal(result.stderr.trimEnd().split('\n').length, 1);
  assert.match(result.stderr, /--udpate/);
});

test('an unexpected failure exits 2 with a one-line message, not a stack', () => {
  const root = makeTracked({ 'src/a.ts': lines(10) });
  // A directory where the config file should be is an I/O error, not a ConfigError.
  fs.mkdirSync(path.join(root, 'source-limits.json'));
  const result = run(SCRIPT, root);
  assert.equal(result.status, 2);
  assert.equal(result.stderr.trimEnd().split('\n').length, 1);
});
