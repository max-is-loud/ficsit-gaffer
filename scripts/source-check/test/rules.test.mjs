// Tests for the source check's size and header rules, one case per row of the spec's size table.
// Configs are built inline so each case states exactly the exemption it depends on.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFile, countLines, findMissingExemptions, hasHeader } from '../rules.mjs';

const lines = (count) => '// header\n' + 'x\n'.repeat(count - 1);
const exempt = (recorded) => ({
  softLimit: 300,
  hardLimit: 500,
  ignore: [],
  exemptDirectories: [],
  exemptFiles: [{ path: 'src/big.ts', lines: recorded, issue: 23 }],
});
const plain = exempt(0);
plain.exemptFiles = [];

const kinds = (findings) => findings.map((finding) => finding.kind);
const check = (text, config, path = 'src/big.ts') => checkFile({ path, text, config });

test('countLines counts newlines like wc -l', () => {
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\nb'), 1);
});

test('up to 300 lines passes silently', () => {
  assert.deepEqual(check(lines(300), plain), []);
});

test('301 to 500 lines passes with a soft-limit warning', () => {
  const findings = check(lines(301), plain);
  assert.deepEqual(kinds(findings), ['soft-limit']);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].lines, 301);
  assert.deepEqual(kinds(check(lines(500), plain)), ['soft-limit']);
});

test('over 500 lines and not exempt fails as too-long', () => {
  const findings = check(lines(501), plain);
  assert.deepEqual(kinds(findings), ['too-long']);
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].lines, 501);
});

test('an exempt file that grew fails as exempt-grew', () => {
  const findings = check(lines(702), exempt(700));
  assert.deepEqual(kinds(findings), ['exempt-grew']);
  assert.deepEqual([findings[0].lines, findings[0].recorded, findings[0].issue], [702, 700, 23]);
});

test('an exempt file at its recorded count passes', () => {
  assert.deepEqual(check(lines(700), exempt(700)), []);
});

test('an exempt file that shrank but is still over 500 fails as exempt-shrunk', () => {
  const findings = check(lines(650), exempt(700));
  assert.deepEqual(kinds(findings), ['exempt-shrunk']);
  assert.equal(findings[0].recorded, 700);
});

test('an exempt file now at or under 500 lines fails as exempt-compliant', () => {
  assert.deepEqual(kinds(check(lines(480), exempt(700))), ['exempt-compliant']);
  assert.deepEqual(kinds(check(lines(500), exempt(700))), ['exempt-compliant']);
  assert.deepEqual(kinds(check(lines(100), exempt(700))), ['exempt-compliant']);
});

test('an exemption for a missing file fails as exempt-missing', () => {
  const findings = findMissingExemptions({ config: exempt(700), checkedPaths: new Set() });
  assert.deepEqual(kinds(findings), ['exempt-missing']);
  assert.equal(findings[0].path, 'src/big.ts');
  assert.equal(findings[0].issue, 23);
  assert.deepEqual(
    findMissingExemptions({ config: exempt(700), checkedPaths: new Set(['src/big.ts']) }),
    [],
  );
});

test('hasHeader accepts every comment opener', () => {
  for (const opener of ['// a', '/// a', '/* a */', '/** a */']) {
    assert.equal(hasHeader(`${opener}\ncode();\n`), true, opener);
  }
});

test('hasHeader skips a BOM, a shebang, #pragma once and blank lines', () => {
  assert.equal(hasHeader('\uFEFF// a\n'), true);
  assert.equal(hasHeader('#!/usr/bin/env node\n// a\n'), true);
  assert.equal(hasHeader('#pragma once\n\n// a\n'), true);
  assert.equal(hasHeader('\n\n  // a\n'), true);
});

test('hasHeader rejects code and empty files', () => {
  assert.equal(hasHeader("import x from 'y';\n"), false);
  assert.equal(hasHeader(''), false);
  assert.equal(hasHeader('#!/usr/bin/env node\n'), false);
});

test('a non-test file without a header gets missing-header, independent of size', () => {
  const findings = check("import x from 'y';\n", plain);
  assert.deepEqual(kinds(findings), ['missing-header']);
  assert.equal(findings[0].severity, 'error');
  assert.deepEqual(kinds(check("import x from 'y';\n" + 'x\n'.repeat(600), plain)).sort(), [
    'missing-header',
    'too-long',
  ]);
});

test('test files never produce missing-header but keep the size rules', () => {
  assert.deepEqual(check('code();\n', plain, 'src/a.test.ts'), []);
  assert.deepEqual(kinds(check('x\n'.repeat(501), plain, 'pkg/test/a.ts')), ['too-long']);
});
