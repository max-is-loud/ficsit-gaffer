# Code Standards and Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write Gaffer's code standard down for humans and agents, and enforce it in CI with a ratchet that lets today's violations stand but never grow.

**Architecture:** File-level rules (size, header) are checked for every language by one dependency-free Node script against one ratchet list (`source-limits.json`). Code-level rules (function length, depth, complexity, parameters, names, formatting) are enforced for TS/JS by one shared ESLint base config and one root Prettier config, with ESLint's bulk-suppressions file as their ratchet. File headers land first (PR A), then the tooling (PR B).

**Tech Stack:** Node ≥ 22 (ES modules, `node:test`, `node:child_process`), ESLint 10 flat config, `@typescript-eslint` 8, Prettier 3, git, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-10-15-code-standards-design.md`. Read it first; this plan argues from it.

## Global Constraints

- Soft limit **300** lines (warning only), hard limit **500** lines (failure); physical lines, as `wc -l` counts them.
- ESLint rules, all `error`: `max-lines-per-function: { max: 60, skipBlankLines: true, skipComments: true }`, `max-depth: 3`, `complexity: 12`, `max-params: 4`, `id-length: { min: 2, exceptions: ['i','j','k','x','y','z','_'], properties: 'never' }`.
- Test files (`**/test/**`, `**/*.test.*`, `**/*.spec.*`) turn off `max-lines-per-function`, `max-depth`, `complexity`; file size still applies; headers are not required.
- Header rule: after an optional BOM, shebang line and C++ `#pragma once`, the first non-blank line starts with `//`, `///`, `/*` or `/**`.
- Checked extensions: `.ts`, `.tsx`, `.js`, `.mjs`, `.cs`, `.cpp`, `.h`.
- `integrations/foreman-bridge/` is one exempt directory linked to #10 — skip size and header rules there, and don't lint or format it.
- The source check has **no npm dependencies**; its tests use `node:test`.
- `--update` only ever lowers recorded counts and removes entries; nothing ever adds or raises one.
- Prettier settings stay exactly: `semi: true`, `singleQuote: true`, `trailingComma: "all"`, `printWidth: 100`, `tabWidth: 2`.
- Conventions from `CONTRIBUTING.md`: Conventional Commits with a body; `feature/` branches; never commit to `main`; British English; AI-generated PR bodies start with `🤖 AI-generated PR — Please review carefully.`
- GitHub items are created only on `max-is-loud/ficsit-gaffer`, never upstream; every issue is added to board 4 (`gh project item-add 4 --owner max-is-loud --url …`; `gh issue create --project` is broken in gh 2.46).
- New code follows the standard it introduces: file headers, small functions, descriptive names.

## Review Focus

1. **Files with a UTF-8 BOM** (common in C#): the header check must look past the BOM, or every C# file is falsely reported. Test in Task 9.
2. **Files deleted in the working tree but still tracked**, and **new untracked files**: the check must skip the first without crashing and check the second, so it works locally before `git add`. Test in Task 8.
3. **A malformed `source-limits.json`** (invalid JSON, a missing issue number, a duplicate path): a one-line message and exit code 2, never a stack trace. Test in Task 8.
4. **Running from a subdirectory or outside a git repository**: resolve the repository root with git; outside a repo, print a clear message and exit 2. Test in Task 10.
5. **Paths with spaces or non-ASCII characters**: list files with `git ls-files -z`, never by splitting on newlines or spaces. Test in Task 8.

---

## Part 1 — GitHub issues (before any PR)

### Task 1: File the refactor issues and the C# follow-up

**Files:** none in the repo.

**Interfaces:**
- Produces: an issue number for each row below, used by Task 10's `source-limits.json` and noted in Task 2–6 commits where a header reveals a split candidate.

- [ ] **Step 1: Re-measure the oversized files on current `main`**

Run: `git ls-files '*.ts' '*.tsx' '*.mjs' '*.js' '*.cs' '*.cpp' '*.h' | grep -v '^integrations/' | xargs wc -l | grep -v ' total$' | awk '$1>500' | sort -rn`
Expected: the 14 files in the spec's table (counts may have moved). Use the fresh counts below.

- [ ] **Step 2: Show the user the list and wait for an explicit OK**

Twelve refactor issues plus one follow-up. Title format: `refactor(<area>): split <file name> by responsibility`. Labels `enhancement` plus the area; milestone *Foundations — identity & standards*; board status *Backlog*.

| # | Files | Area label |
|---|---|---|
| 1 | `ff-server/src/tools/workOrderTools.ts` + `ff-server/test/workOrderTools.test.ts` | `area:ff-server` |
| 2 | `ff-server/src/services/workOrderService.ts` | `area:ff-server` |
| 3 | `sf-mcp/src/query/selectors.ts` | `area:sf-mcp` |
| 4 | `ff-client/src/useForeman.ts` | `area:ff-client` |
| 5 | `ff-client/src/components/WorkOrderPanel.tsx` | `area:ff-client` |
| 6 | `tools/sf-map-renderer/sf-map-renderer/Water/WaterModelBuilder.cs` | `area:repo` |
| 7 | `ff-server/test/routes.test.ts` | `area:ff-server` |
| 8 | `sf-save-data/test/normalise.test.ts` | `area:sf-save-data` |
| 9 | `ff-client/src/api/client.ts` | `area:ff-client` |
| 10 | `sf-mcp/src/query/bottlenecks.ts` + `sf-mcp/test/bottlenecks.test.ts` | `area:sf-mcp` |
| 11 | `sf-game-data-graph/src/graph/queries/production.ts` | `area:sf-game-data` |
| 12 | `tools/sf-map-renderer/sf-map-renderer/Collection/SceneCollector.cs` | `area:repo` |
| 13 | `ci: enforce C# formatting with dotnet format` — one reformat PR, then `dotnet format whitespace --folder --verify-no-changes` in CI | `area:repo` |

Each refactor body: the current line count, the 500-line limit, "listed in `source-limits.json`; may not grow", and "split along responsibilities; record the split candidates found while writing headers (PR A) here".

- [ ] **Step 3: Create them after the OK**

For each row: `url=$(gh issue create -R max-is-loud/ficsit-gaffer --title … --body-file … --label … --milestone "Foundations — identity & standards")`, then `gh project item-add 4 --owner max-is-loud --url "$url"`, then set Status to *Backlog* (project `PVT_kwHOAnxrc84BnNVv`, field `PVTSSF_lAHOAnxrc84BnNVvzhlzAL8`, option `e2d04cfe`) with `gh project item-edit`.
Expected: 13 URLs; each issue's `projectItems` shows *Backlog*. Record the number for every row.

---

## Part 2 — PR A: file headers (branch `feature/file-headers` from `main`)

Rules for every header in Tasks 2–6:
- One to three sentences of `//` line comments at the very top: what the file is responsible for and, where useful, what it leaves to other files. `/** */` stays for symbol docs. C# headers go above the `using` lines.
- Write it from reading the file. Don't restate the file name.
- If the file's leading comment already documents the first declaration rather than the file (e.g. `/** Server default conversation history window … */` in `ff-client/src/llmSettings.ts`), add a file header above it.
- If an honest header has to join unrelated jobs with "and", write the honest header anyway and add a comment on that file's refactor issue (Task 1), or file a new one with the same labels after asking the user, naming it a split candidate.
- Change nothing but comments.

Missing-header lister (throwaway, not committed), run from the repo root:

```sh
node -e '
const {execSync}=require("child_process"),fs=require("fs");
const files=execSync("git ls-files -z",{encoding:"utf8"}).split("\0").filter(Boolean);
const ext=/\.(ts|tsx|js|mjs|cs|cpp|h)$/, test=/(^|\/)(test|tests|Tests)\/|-tests\/|\.(test|spec)\./;
const skip=/^integrations\/|\/dist\/|\/node_modules\/|\/src\/generated\/|\/(bin|obj)\/|^packages\/sf-game-data\/extract\/CUE4Parse\//;
for (const f of files) { if(!ext.test(f)||test.test(f)||skip.test(f)||!fs.existsSync(f)) continue;
  const lines=fs.readFileSync(f,"utf8").replace(/^﻿/,"").split("\n").filter(l=>!/^#!|^\s*#pragma once/.test(l));
  const first=(lines.find(l=>l.trim())||"").trim();
  if(!/^(\/\/|\/\*)/.test(first)) console.log(f); }' | sort
```

The list it prints is the work for Tasks 2–6. Each task also reviews the files in its scope that *do* start with a comment, for the "documents the first declaration" case.

### Task 2: Headers for `ff-server`

**Files:** Modify: every file under `packages/ff-server/` that the lister prints, plus first-declaration cases.

- [ ] **Step 1: Run the lister, filtered to `packages/ff-server/`.** Expected: the list of files to do.
- [ ] **Step 2: Write each header** (rules above).
- [ ] **Step 3: Verify.** Run the lister again, filtered. Expected: no output. Run `npm run lint -w @foreman/ff-server && npm test -w @foreman/ff-server`. Expected: pass.
- [ ] **Step 4: Commit.** `docs(server): add file headers to ff-server sources`, with a body listing any split candidates and where they were recorded.

### Task 3: Headers for `ff-client`

Same steps as Task 2 for `packages/ff-client/` (including `vite.config.*` and other config files). Workspace `@foreman/ff-client`. Commit `docs(client): add file headers to ff-client sources`.

### Task 4: Headers for `sf-mcp`

Same steps for `packages/sf-mcp/`. Workspace `@foreman/sf-mcp`. Commit `docs(mcp): add file headers to sf-mcp sources`.

### Task 5: Headers for the remaining TypeScript packages

Same steps for `sf-core`, `sf-present`, `sf-flow`, `sf-game-data` (TS only), `sf-game-data-graph`, `sf-save-data`, `sf-save-data-graph`. Verify with `npm run lint && npm test` at the root. Commit `docs: add file headers to sf-* library sources`.

### Task 6: Headers for C#, repository scripts and remaining config files, then open PR A

**Files:** Modify: the C# files under `packages/sf-game-data/extract/` (not the `CUE4Parse` clone) and `tools/sf-map-renderer/`, `.github/scripts/*.mjs`, and every `eslint.config.js` (a short header saying it holds the package's lint rules; Task 7 rewrites these, so keep it to one line).

- [ ] **Step 1: Run the lister unfiltered.** Expected: only files in this task's scope remain.
- [ ] **Step 2: Write each header.**
- [ ] **Step 3: Verify.** Run the lister. Expected: **no output at all**. Run `npm run build && npm run lint && npm test`. Expected: pass. (C# isn't built on Linux; comments only, so review the diff to confirm nothing but comments changed: `git diff --stat main -- '*.cs'` and `git diff main -- '*.cs' | grep '^[+-]' | grep -v '^[+-]\s*//' | grep -v '^[+-]\{3\}'` should print nothing.)
- [ ] **Step 4: Commit.** `docs: add file headers to C# tools and repository scripts`.
- [ ] **Step 5: Push and open PR A** titled `docs: add file headers to every source file`, body opening with the AI-generated line, `Refs #9`, the split candidates found, and the verification commands above. Link it in T3 Code (`link_pull_request`). Ask the user to review and merge before Part 3.

---

## Part 3 — PR B: tooling and the standard (branch `feature/code-standards`)

Start: `git switch feature/code-standards && git rebase main` once PR A and #17 are merged. The branch already holds the spec commits.

### Task 7: One shared Prettier and ESLint config

**Files:**
- Create: `.prettierrc.json` (root), `.prettierignore` (root), `eslint.config.base.js` (root), `eslint.config.js` (root)
- Delete: `packages/*/.prettierrc.json` (10 files)
- Modify: `packages/*/eslint.config.js` (10 files), root `package.json`

**Interfaces:**
- Produces: `eslint.config.base.js` default-exports a flat-config array; package configs are `import base from '../../eslint.config.base.js'; export default [...base, …overrides];`. Task 9 adds rules to this file.

- [ ] **Step 1: Write the shared configs.**
  - `.prettierrc.json`: the five settings from Global Constraints.
  - `.prettierignore`: `integrations/foreman-bridge/`, `**/dist/`, `**/src/generated/`, `packages/sf-game-data/data/`.
  - `eslint.config.base.js`: the current shared content, which is the union of today's variants. Ignores `dist/**`, `node_modules/**`, `src/generated/**`; `js.configs.recommended`; `files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs']` with the TS parser (`ecmaVersion: 2022`, `sourceType: 'module'`, `ecmaFeatures: { jsx: true }`); today's rules (`no-undef` off with its existing comment, `no-unused-vars` off, `@typescript-eslint/no-unused-vars` with `^_` patterns, `@typescript-eslint/no-explicit-any`, `curly: ['error', 'all']`); the `**/*.d.ts` override turning `@typescript-eslint/no-unused-vars` off.
  - Each package's `eslint.config.js`: base plus only differences that a lint run proves necessary (try with none first).
  - Root `eslint.config.js`: base, scoped to `scripts/**` and `.github/scripts/**`, with Node globals (`globals.node`, as a devDependency if not already hoisted).
  - Root `package.json`: add devDependencies `eslint`, `@eslint/js`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `prettier` (and `globals` if used) at the versions the packages already use. Add the script `"lint:root": "eslint scripts .github/scripts eslint.config.base.js eslint.config.js && prettier --check \"scripts/**/*.mjs\" \".github/scripts/**/*.mjs\" \"*.js\""` (no `*.json`: that would check `package-lock.json`) and change `"lint"` to `"npm run lint --workspaces --if-present && npm run lint:root"`. (`scripts/` doesn't exist until Task 8; until then, keep `scripts` out of the command.)
  - Update the `description` and `author` fields only if the user asks; renaming is #15.
- [ ] **Step 2: Verify.** `npm install && npm run lint`. Expected: pass with **no** rule changes and no Prettier diffs. Confirm `git ls-files 'packages/*/.prettierrc.json'` prints nothing.
- [ ] **Step 3: Commit.** `build: share one ESLint and Prettier config across packages`.

### Task 8: Prettier over tests (mechanical)

**Files:** Modify: each `packages/*/package.json` `lint` and `format` scripts; every test file Prettier reformats.

- [ ] **Step 1: Widen the patterns.** `src/**/*.ts` → `"{src,test}/**/*.ts"` (and `{src,test}/**/*.{ts,tsx,css}` for `ff-client`), in both `lint` and `format`, only for packages that have a `test/` folder.
- [ ] **Step 2: Reformat.** `npm run format --workspaces --if-present`. Expected: only files under `test/` change (`git diff --stat` confirms).
- [ ] **Step 3: Verify.** `npm run lint && npm test`. Expected: pass.
- [ ] **Step 4: Commit.** `style: format test files with Prettier` (body: mechanical; no behaviour change).

### Task 9: New ESLint rules and their suppressions

**Files:**
- Modify: `eslint.config.base.js`; each `packages/*/package.json` (add `"lint:prune": "eslint . --prune-suppressions"`)
- Create: `packages/*/eslint-suppressions.json` (generated)

- [ ] **Step 1: Add the five rules** from Global Constraints to the shared rules block, and a test-file override (`files: ['**/test/**', '**/*.test.*', '**/*.spec.*']`) turning off `max-lines-per-function`, `max-depth`, `complexity`, with a one-line comment saying why: `describe`/`it` nesting and table-driven cases are how tests are meant to be written.
- [ ] **Step 2: Confirm the rules bite.** `npm run lint`. Expected: FAIL with violations of the new rules.
- [ ] **Step 3: Generate the suppressions.** In each package: `npx eslint . --suppress-all`; at the root: `npx eslint .github/scripts eslint.config.base.js eslint.config.js --suppress-all` (the existing `.github/scripts/check-game-data.mjs` may break the new rules). Expected: one `eslint-suppressions.json` per package (and at the root) that has violations. Add `"lint:prune"` at the root too.
- [ ] **Step 4: Verify.** `npm run lint`. Expected: pass. Then add `function f(a,b,c,d,e){}` to any `src` file and run that package's lint. Expected: FAIL naming `max-params` and `id-length`. Revert it. Record both results for the PR body.
- [ ] **Step 5: Commit.** `build: add size, depth, complexity and naming lint rules`, with a body listing the suppression counts per package (`jq '[.[]|.[]|.count]|add'` per file).

### Task 10: Source check — configuration and file listing

**Files:**
- Create: `scripts/source-check/config.mjs`, `scripts/source-check/files.mjs`, `scripts/source-check/test/config.test.mjs`, `scripts/source-check/test/files.test.mjs`, `scripts/source-check/test/fixtures.mjs`
- Modify: root `package.json` (add `"test:scripts": "node --test scripts/source-check/test/"`; append `&& npm run test:scripts` to `"test"`; add `scripts` to `lint:root`)

**Interfaces:**
- Produces:
  - `config.mjs`: `export class ConfigError extends Error {}`; `export function parseConfig(jsonText: string): SourceLimitsConfig` (throws `ConfigError`); `export function loadConfig(path: string): SourceLimitsConfig`. `SourceLimitsConfig` is `{ softLimit: number, hardLimit: number, ignore: string[], exemptDirectories: { path: string, issue: number, reason: string }[], exemptFiles: { path: string, lines: number, issue: number }[] }`, with JSDoc typedefs, and `$comment` allowed and dropped.
  - `files.mjs`: `export const SOURCE_EXTENSIONS: readonly string[]`; `export function globToRegExp(glob: string): RegExp` (`**` matches any number of path segments, `*` matches within one segment); `export function isTestFile(path: string): boolean`; `export function listSourceFiles({ repoRoot: string, config: SourceLimitsConfig }): string[]`, which returns repo-relative POSIX paths of tracked and untracked-but-not-ignored files (`git ls-files -z --cached --others --exclude-standard`) that exist on disk, have a checked extension, and aren't ignored or inside an exempt directory.
  - `test/fixtures.mjs`: `export function makeRepo(files: Record<string, string>): string`, which creates a temporary git repo, writes and `git add`s the files, and returns its path.

- [ ] **Step 1: Write the failing tests.**
  - `config.test.mjs`:
    - `parses a valid config` (the spec's example shape, with a real issue number)
    - `rejects invalid JSON with a ConfigError` (the message includes `source-limits.json`)
    - `rejects unknown keys`
    - `rejects an exemption without an issue number`
    - `rejects duplicate exempt paths`
    - `rejects softLimit >= hardLimit`
  - `files.test.mjs`:
    - `globToRegExp` matches `packages/x/dist/a.ts` with `**/dist/**`, and does not match `packages/x/distance.ts`
    - `isTestFile` is true for `a/test/b.ts`, `a/Tests/B.cpp`, `x-tests/Y.cs`, `a.test.ts`, `a.spec.tsx`; false for `src/testing.ts` and `src/contest.ts`
    - `listSourceFiles`:
      - skips non-source extensions, ignored globs and exempt directories
      - includes an untracked new file
      - skips a tracked file deleted from the working tree
      - returns `dir with space/naïve.ts` intact
- [ ] **Step 2: Run them.** `node --test scripts/source-check/test/`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement `config.mjs` and `files.mjs`** to the interfaces above, each with a file header.
- [ ] **Step 4: Run them.** Expected: PASS. Then `npm run lint:root`. Expected: pass.
- [ ] **Step 5: Commit.** `feat(repo): add source-check configuration and file listing`.

### Task 11: Source check — rules and report

**Files:**
- Create: `scripts/source-check/rules.mjs`, `scripts/source-check/report.mjs`, `scripts/source-check/test/rules.test.mjs`, `scripts/source-check/test/report.test.mjs`

**Interfaces:**
- Consumes: `SourceLimitsConfig`, `isTestFile` (Task 10).
- Produces:
  - `rules.mjs`: `export function countLines(text: string): number` (number of `\n`, as `wc -l` counts); `export function hasHeader(text: string): boolean`; `export function checkFile({ path: string, text: string, config: SourceLimitsConfig }): Finding[]`; `export function findMissingExemptions({ config: SourceLimitsConfig, checkedPaths: Set<string> }): Finding[]`. `Finding` is `{ path: string, kind: 'too-long' | 'soft-limit' | 'exempt-grew' | 'exempt-shrunk' | 'exempt-compliant' | 'exempt-missing' | 'missing-header', severity: 'error' | 'warning', lines?: number, recorded?: number, issue?: number }`.
  - `report.mjs`: `export function formatFinding(finding: Finding, config: SourceLimitsConfig): string`; `export function formatReport({ findings: Finding[], config: SourceLimitsConfig }): { text: string, exitCode: 0 | 1 }` (errors first, then a "files over 300 lines" warning summary; exit 1 only if there are errors).

- [ ] **Step 1: Write the failing tests.**
  - `rules.test.mjs`, one test per row of the spec's size-rules table, plus:
    - `countLines('a\nb\n') === 2`
    - `hasHeader` is true for each of `//`, `///`, `/*`, `/**`; true after a BOM, after a shebang, and after `#pragma once`; false for `import x from 'y';` and for an empty file
    - test files never produce `missing-header`
    - `findMissingExemptions` reports a path not in `checkedPaths`
  - `report.test.mjs`: `formatFinding` reproduces the four example messages from the spec exactly, with the spec's numbers; `formatReport` returns `exitCode: 0` when there are only warnings, and `1` otherwise.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `rules.mjs` and `report.mjs`.** Message copy must match the spec's examples character for character, including the em dashes and `CONTRIBUTING.md › Code standards`.
- [ ] **Step 4: Run them.** Expected: PASS. `npm run lint:root`: pass.
- [ ] **Step 5: Commit.** `feat(repo): add source-check size and header rules`.

### Task 12: Source check — command, `--update`, the real ratchet list

**Files:**
- Create: `scripts/source-check/update.mjs`, `scripts/check-source-files.mjs`, `scripts/source-check/test/update.test.mjs`, `scripts/source-check/test/cli.test.mjs`, `source-limits.json`
- Modify: root `package.json` (add `"check:source": "node scripts/check-source-files.mjs"`)

**Interfaces:**
- Consumes: Tasks 10–11.
- Produces:
  - `update.mjs`: `export function applyUpdates({ config: SourceLimitsConfig, findings: Finding[] }): SourceLimitsConfig` (lowers `lines` for `exempt-shrunk`; removes entries for `exempt-compliant` and `exempt-missing`; never adds or raises); `export function writeConfig({ path: string, config: SourceLimitsConfig }): void` (2-space JSON, `$comment` first, trailing newline).
  - `check-source-files.mjs`: `export function runCheck({ cwd: string, update: boolean }): { text: string, exitCode: 0 | 1 | 2 }`, where the repository root is found with `git rev-parse --show-toplevel` and the config path is `<root>/source-limits.json`. When run directly, it parses `--update` and prints and exits. Exit 2 means a config or environment error (message only, no stack trace).

- [ ] **Step 1: Write the failing tests.**
  - `update.test.mjs`:
    - lowers a shrunk count
    - removes a compliant entry and a missing-file entry
    - leaves a grown entry unchanged (it stays a failure)
    - never adds an entry for a new oversized file
  - `cli.test.mjs`, using `makeRepo`:
    - a clean repo exits 0
    - an oversized new file exits 1 with the `too-long` message
    - `--update` after shrinking an exempt file rewrites `source-limits.json` and the next run exits 0
    - running from a subdirectory finds the root
    - running outside a git repo exits 2 with a one-line message
    - invalid JSON in `source-limits.json` exits 2 with a one-line message
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `update.mjs` and `check-source-files.mjs`.**
- [ ] **Step 4: Write the real `source-limits.json`** in the spec's shape: the spec's `ignore` globs, the bridge directory entry (issue 10), and one `exemptFiles` entry per file over 500 lines with its current count (`wc -l`) and its Task 1 issue number. A test file shares its source's issue.
- [ ] **Step 5: Verify.**
  - `npm run test:scripts`. Expected: PASS.
  - `npm run check:source`. Expected: exit 0, with a warning summary listing the files between 300 and 500 lines and no missing headers (PR A added them).
  - Append one line to an exempt file and run it again. Expected: exit 1 with the `exempt-grew` message. Revert.
- [ ] **Step 6: Commit.** `feat(repo): add source-check command and ratchet list`.

### Task 13: Formatter configs for C# and C++

**Files:** Create: `.editorconfig` (root), `integrations/foreman-bridge/mod/.clang-format`.

- [ ] **Step 1: Write `.editorconfig`.** `root = true`; `[*]`: UTF-8, LF, final newline, trim trailing whitespace; `[*.{ts,tsx,js,mjs,json,md,yml,yaml,css}]`: two-space indent; `[*.md]`: no trailing-whitespace trimming; `[*.cs]`: four-space indent, Allman braces (`csharp_new_line_before_open_brace = all`), `using` ordering with `System` first. Read three of the larger C# files and match what they already do where the two disagree.
- [ ] **Step 2: Write `.clang-format`.** Unreal style: `UseTab: Always`, `TabWidth: 4`, `IndentWidth: 4`, `BreakBeforeBraces: Allman`, `ColumnLimit: 120`, `PointerAlignment: Left`, plus a comment line saying enforcement starts with bridge v2 (#10).
- [ ] **Step 3: Verify.** `npm run lint` still passes. Prettier honours `.editorconfig` only where `.prettierrc.json` is silent, so `prettier --check` must show no new diffs.
- [ ] **Step 4: Commit.** `build: add editorconfig and clang-format for C# and C++`.

### Task 14: The written standard

**Files:** Modify: `CONTRIBUTING.md` (the *Code standards* section), `AGENTS.md` (new *Code standards — non-negotiable* section after *Conventions*). Create: `.github/pull_request_template.md`.

- [ ] **Step 1: Write `CONTRIBUTING.md › Code standards`**: the spec's seven rules (keeping the six existing bullets' content), then *How it's enforced*:
  - the source check and its messages
  - the ESLint rules and test override
  - the ratchet, covering `source-limits.json`, `--update` and `lint:prune`
  - "never add an exemption or suppression; never raise a count"
  - the commands `npm run check:source`, `npm run lint`, `npm run format`

  Also change the *Development* block's `npm run lint` comment to mention the source check.
- [ ] **Step 2: Write the `AGENTS.md` section**: rules 1–5 in one line each, plus the ratchet prohibitions, linking to `CONTRIBUTING.md › Code standards`.
- [ ] **Step 3: Write the PR template**: a *What / Why* heading pair, then the spec's five-item review checklist as unchecked boxes.
- [ ] **Step 4: Verify** every command and path named in these docs exists: run each command once, and `ls` each path. Expected: all succeed.
- [ ] **Step 5: Commit.** `docs: write down the code standards and review checklist`.

### Task 15: CI wiring, final verification, PR B

**Files:** Modify: `.github/workflows/ci.yml`.

- [ ] **Step 1: Add a step** `- name: Source check` / `run: npm run check:source` after *Lint*. (`npm test` already runs `test:scripts` via Task 10.)
- [ ] **Step 2: Verify the whole repository.** `npm run build && npm run lint && npm test && npm run check:source`. Expected: all pass.
- [ ] **Step 3: Commit.** `ci: run the source check on every pull request`.
- [ ] **Step 4: Push and open PR B** titled `build: enforce code standards with a shrinking ratchet`. The body opens with the AI-generated line, then `Closes #9`, a summary per commit, the suppression and exemption counts, and the deliberate-violation results from Tasks 9 and 12. Link it in T3 Code. Move #9's board card to *In Progress* when the PR opens.

---

## Self-review notes

- Spec coverage: standard text → Task 14; shared configs → 7; tests formatted → 8; rules and suppressions → 9; source check → 10–12; ratchet list and issues → 1, 12; formatter configs → 13; CI → 15; headers PR → 2–6; rollout order → Parts 1–3.
- Spec deviation: the spec lists the written standard as PR B's second commit. Here it comes after the tooling (Task 14), so the docs describe commands that already exist and are verified. The content is unchanged.
