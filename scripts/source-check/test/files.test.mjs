// Tests for glob matching, test-file classification and git-backed source file listing.
// Listing tests run against real temporary repositories built by fixtures.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { globToRegExp, isTestFile, listSourceFiles } from '../files.mjs';
import { makeRepo } from './fixtures.mjs';

const roots = [];
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const repo = (files) => {
  const root = makeRepo(files);
  roots.push(root);
  return root;
};

const config = {
  softLimit: 300,
  hardLimit: 500,
  ignore: ['**/dist/**'],
  exemptDirectories: [{ path: 'vendor/', issue: 1, reason: 'later' }],
  exemptFiles: [],
};

test('globToRegExp: ** spans segments and * stays within one', () => {
  const regExp = globToRegExp('**/dist/**');
  assert.ok(regExp.test('packages/x/dist/a.ts'));
  assert.ok(!regExp.test('packages/x/distance.ts'));
  assert.ok(globToRegExp('src/*.ts').test('src/a.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/deep/a.ts'));
});

test('isTestFile recognises test folders and names', () => {
  for (const yes of ['a/test/b.ts', 'a/Tests/B.cpp', 'x-tests/Y.cs', 'a.test.ts', 'a.spec.tsx']) {
    assert.ok(isTestFile(yes), yes);
  }
  for (const no of ['src/testing.ts', 'src/contest.ts']) {
    assert.ok(!isTestFile(no), no);
  }
});

test('listSourceFiles skips non-source, ignored and exempt-directory files', () => {
  const repoRoot = repo({
    'src/a.ts': '// a\n',
    'src/readme.md': 'x',
    'pkg/dist/b.ts': '// b\n',
    'vendor/c.ts': '// c\n',
  });
  assert.deepEqual(listSourceFiles({ repoRoot, config }), ['src/a.ts']);
});

test('listSourceFiles includes an untracked new file', () => {
  const repoRoot = repo({ 'src/a.ts': '// a\n' });
  fs.writeFileSync(path.join(repoRoot, 'src', 'new.ts'), '// new\n');
  assert.deepEqual(listSourceFiles({ repoRoot, config }), ['src/a.ts', 'src/new.ts']);
});

test('listSourceFiles skips a tracked file deleted from the working tree', () => {
  const repoRoot = repo({ 'src/a.ts': '// a\n', 'src/gone.ts': '// gone\n' });
  fs.rmSync(path.join(repoRoot, 'src', 'gone.ts'));
  assert.deepEqual(listSourceFiles({ repoRoot, config }), ['src/a.ts']);
});

test('listSourceFiles returns paths with spaces and accents intact', () => {
  const repoRoot = repo({ 'dir with space/naïve.ts': '// n\n' });
  assert.deepEqual(listSourceFiles({ repoRoot, config }), ['dir with space/naïve.ts']);
});
