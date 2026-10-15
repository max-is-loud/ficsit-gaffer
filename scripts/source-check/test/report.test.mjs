// Tests for the source check's message copy and report assembly.
// The four spec examples are asserted verbatim because the wording is part of the contract.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatFinding, formatReport } from '../report.mjs';

const config = {
  softLimit: 300,
  hardLimit: 500,
  ignore: [],
  exemptDirectories: [],
  exemptFiles: [],
};
const error = (finding) => ({ severity: 'error', ...finding });

test('too-long message matches the spec', () => {
  assert.equal(
    formatFinding(
      error({ path: 'packages/ff-server/src/x.ts', kind: 'too-long', lines: 512 }),
      config,
    ),
    'packages/ff-server/src/x.ts: 512 lines (limit 500). Split it by responsibility — see CONTRIBUTING.md › Code standards.',
  );
});

test('exempt-grew message matches the spec', () => {
  const finding = error({
    path: 'packages/sf-mcp/src/query/selectors.ts',
    kind: 'exempt-grew',
    lines: 1402,
    recorded: 1396,
    issue: 23,
  });
  assert.equal(
    formatFinding(finding, config),
    'packages/sf-mcp/src/query/selectors.ts: grew from 1396 to 1402 lines while exempt (#23). Exempt files may not grow.',
  );
});

test('exempt-compliant message matches the spec', () => {
  const finding = error({
    path: 'packages/sf-mcp/src/query/bottlenecks.ts',
    kind: 'exempt-compliant',
    lines: 480,
  });
  assert.equal(
    formatFinding(finding, config),
    'packages/sf-mcp/src/query/bottlenecks.ts: now 480 lines — remove its exemption (npm run check:source -- --update).',
  );
});

test('missing-header message matches the spec', () => {
  assert.equal(
    formatFinding(error({ path: 'packages/ff-server/src/y.ts', kind: 'missing-header' }), config),
    'packages/ff-server/src/y.ts: no file header. Start the file with a comment saying what it is responsible for.',
  );
});

test('the remaining kinds use the same path-first style', () => {
  const shrunk = error({ path: 'a.ts', kind: 'exempt-shrunk', lines: 650, recorded: 700 });
  assert.match(formatFinding(shrunk, config), /^a\.ts: now 650 lines, recorded 700.*--update\)\.$/);
  const missing = error({ path: 'a.ts', kind: 'exempt-missing' });
  assert.match(formatFinding(missing, config), /^a\.ts: .*no longer exists.*--update\)\.$/);
  const soft = { path: 'a.ts', kind: 'soft-limit', severity: 'warning', lines: 320 };
  assert.equal(formatFinding(soft, config), 'a.ts: 320 lines (over 300).');
});

test('warnings alone exit 0 and are summarised under a heading', () => {
  const soft = { path: 'a.ts', kind: 'soft-limit', severity: 'warning', lines: 320 };
  const { text, exitCode } = formatReport({ findings: [soft], config });
  assert.equal(exitCode, 0);
  assert.match(text, /Files over 300 lines \(warning only\):\na\.ts: 320 lines \(over 300\)\./);
});

test('any error exits 1 and is listed before the warnings', () => {
  const soft = { path: 'a.ts', kind: 'soft-limit', severity: 'warning', lines: 320 };
  const bad = error({ path: 'b.ts', kind: 'missing-header' });
  const { text, exitCode } = formatReport({ findings: [soft, bad], config });
  assert.equal(exitCode, 1);
  assert.ok(text.indexOf('b.ts: no file header') < text.indexOf('Files over 300'));
});

test('no findings gives an empty-ish passing report', () => {
  const { text, exitCode } = formatReport({ findings: [], config });
  assert.equal(exitCode, 0);
  assert.doesNotMatch(text, /Files over/);
});
