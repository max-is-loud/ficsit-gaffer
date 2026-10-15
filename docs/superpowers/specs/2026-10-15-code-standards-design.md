# Code standards and enforcement

Date: 2026-10-15

Status: Written spec approved by the user; implementation planning authorised.

Issue: #9 (milestone *Foundations — identity & standards*).

## Purpose and success

Gaffer will be published to the Satisfactory modding community. Its code must
read as carefully made by people who care: easy to understand, sensibly
organised, and commented where the reasoning isn't obvious. This sub-project
writes the standard down for humans (`CONTRIBUTING.md`) and agents
(`AGENTS.md`), and enforces as much of it as tools reliably can. Existing code
is held to a **ratchet**: today's violations are recorded, nothing new is
allowed in, and the record can only shrink.

Success means:

- A contributor or agent can read one section of `CONTRIBUTING.md` and know
  the rules, and the PR template reminds reviewers of the parts tools can't
  check.
- CI fails on any new oversized file, missing file header, new ESLint rule
  violation (function length, depth, complexity, parameters, short names) or
  unformatted TS/JS, including tests.
- CI also fails when an exempt file grows, or when a recorded violation has
  been fixed but its exemption is still on record, so the ratchet tightens as
  code improves.
- Every exemption points at a refactor issue on the Gaffer roadmap board.
- The ten copies of the ESLint and Prettier configs become one shared config.

## Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| How to handle today's violations | A ratchet list; each exempt file is linked to a GitHub refactor issue; exempt files may not grow |
| Languages | All languages get written rules, formatter configs and the file-level check now. TS/JS formatting is enforced now; C++ formatting is enforced with bridge v2 (#10); C# formatting once a CI check lands (follow-up issue) |
| Test files | Same file-size limits as source; function-length, depth and complexity rules off |
| Comment enforcement | Tools require a file header on non-test source files; export docs and *why* comments are checked in review |
| Files missing headers today | Headers are written now, in a separate PR, from reading each file |
| Bridge (`integrations/foreman-bridge`) | Exempt as one directory until bridge v2 (#10) rewrites it |

## The standard

The full text goes in `CONTRIBUTING.md` under **Code standards**, replacing and
absorbing the current six bullets (which all stay true). In summary:

1. **Readable by default.** Descriptive names; single letters only for loop
   indices and coordinates (`i`, `j`, `k`, `x`, `y`, `z`) and ignored values
   (`_`). One statement per line. Formatting is the formatter's job: Prettier
   for JS/TS, `.editorconfig` for C#, `.clang-format` (Unreal style) for C++.
2. **Comments explain why.** Every non-test source file opens with a header of
   one to three sentences: what the file is responsible for and, where useful,
   what it deliberately leaves to other files. Comments are required where code
   relies on something a reader couldn't see: a protocol rule, a game or engine
   workaround, an ordering or concurrency guarantee, a unit convention.
   Exported functions, classes and types whose behaviour isn't evident from
   their name and types get a doc comment stating the contract (inputs, units,
   errors, side effects). A comment that restates the code is removed, not
   kept.
3. **No god files.** One responsibility per file. A file over 300 lines is a
   prompt to check that it still does one thing; over 500 lines fails CI. A
   header that can only be honest by joining unrelated jobs with "and" means the
   file should be split.
4. **Small, flat functions.** At most 60 lines (blank lines and comments not
   counted), nesting depth 3, cyclomatic complexity 12 and 4 parameters; pass
   an options object instead of a fifth parameter.
5. **Extend with data, not branches.** New kinds of thing (building
   categories, event types, tool definitions) are added as entries in a
   registry or table, not as another arm of a growing `if`/`switch` chain.
6. **Existing rules stay:** curly braces always; explicit return types on
   exported functions; no `any`; errors logged with context, never swallowed;
   parser warnings collected, not thrown; British English in comments and docs.
7. **Enforced in CI; the rest in review.** The section explains each check, its
   error messages, and how the ratchet works (below).

`AGENTS.md` gets a short **Code standards — non-negotiable** list (rules 1–5 in
one line each, plus "never add to a ratchet list; never raise a recorded
count; never add an ESLint suppression by hand"), linking to `CONTRIBUTING.md`.

A new **`.github/pull_request_template.md`** carries the review checklist for
what tools can't judge:

- Names say what things are; no abbreviations a newcomer would have to guess.
- Comments explain *why*; non-obvious exports document their contract.
- Each touched file still does one thing, and its header is still true.
- New kinds of thing were added as data, not as new branches.
- No new exemptions or suppressions; any shrunk exemption has been lowered.

## Architecture

The rules split by level:

- **File-level rules** (size, header) apply to every language, so one
  language-neutral script enforces them against one ratchet list.
- **Code-level rules** (function length, depth, complexity, parameters, names,
  formatting) need a parser, so ESLint and Prettier enforce them for TS/JS.
  Their ratchet is ESLint's built-in bulk-suppressions file.

Alternatives considered: ESLint `max-lines` plus a separate C#/C++ script
(two size mechanisms and two exemption lists, so not DRY), and a hosted
quality service such as SonarCloud (an external account and dependency, rules
that don't match ours, and results kept outside the repo).

### Shared configuration

- **Root `.prettierrc.json`**, with today's settings (`semi`, `singleQuote`,
  `trailingComma: all`, `printWidth: 100`, `tabWidth: 2`). Prettier looks for
  its config in parent folders, so the ten package copies are deleted.
- **Root `eslint.config.base.js`**, exporting the shared flat-config array:
  ignores, `@eslint/js` recommended, the TypeScript parser and plugin, the
  existing rules, the new rules below, and the test-file override. Each
  package's `eslint.config.js` becomes `import base from
  '../../eslint.config.base.js'` plus only its real differences (React and
  browser globals for `ff-client`, and so on). No new workspace package. The
  four variants that exist today are reconciled during implementation: each
  difference is kept as a package override only if it is still needed.
- **Root `eslint.config.js`** lints the repository's own scripts
  (`scripts/**`, `.github/scripts/**`) with the same base.

New ESLint rules in the base, as errors:

| Rule | Setting |
|---|---|
| `max-lines-per-function` | `{ max: 60, skipBlankLines: true, skipComments: true }` |
| `max-depth` | `3` |
| `complexity` | `12` |
| `max-params` | `4` |
| `id-length` | `{ min: 2, exceptions: ['i','j','k','x','y','z','_'], properties: 'never' }` |

`properties: 'never'` leaves property names alone, because external formats
(game data, wire protocols, Unreal coordinates) dictate many of them.

Test-file override (`**/test/**`, `**/*.test.*`, `**/*.spec.*`): turn off
`max-lines-per-function`, `max-depth` and `complexity`. File size still
applies to tests (through the source check), as do the other rules.

### ESLint ratchet: bulk suppressions

ESLint 10 records existing violations in an `eslint-suppressions.json` file
next to each package's config (`eslint --suppress-all`). Verified on ESLint
10.9.1 in a scratch project:

- a new violation fails (exit 1);
- a recorded violation that has since been fixed also fails (exit 2), telling
  you to run `--prune-suppressions`.

So the suppressions file can only shrink, with no extra code. Each package
gets a `lint:prune` script (`eslint . --prune-suppressions`). Suppressions are
generated once, in PR B, after the shared config lands. Adding suppressions by
hand, or re-running `--suppress-all` later, is forbidden by the standard;
review catches a grown suppressions file.

### Source check: `scripts/check-source-files.mjs`

A small Node script, with no dependencies, run as `npm run check:source` at the
root. It follows the standard itself (file headers, small modules), split as:

| File | Responsibility |
|---|---|
| `scripts/check-source-files.mjs` | Command-line entry: parse flags, run the check, print the report, set the exit code |
| `scripts/source-check/config.mjs` | Load and validate `source-limits.json` |
| `scripts/source-check/files.mjs` | List tracked files (`git ls-files`), filter by extension and ignore globs, classify test files |
| `scripts/source-check/rules.mjs` | The size and header rules, producing findings |
| `scripts/source-check/report.mjs` | Turn findings into the messages below |
| `scripts/source-check/update.mjs` | `--update`: lower recorded counts and remove compliant entries |

**Files checked:** tracked `.ts`, `.tsx`, `.js`, `.mjs`, `.cs`, `.cpp` and `.h`
files, minus the ignore globs and exempt directories in the config.

**Test files:** any path with a `test`, `tests` or `Tests` folder, a folder
ending in `-tests`, or a name containing `.test.` or `.spec.`.

**Line count:** physical lines, the same as `wc -l`. Simple, predictable and
the same for every language.

**Header rule (non-test files only):** after skipping a shebang line and a C++
`#pragma once`, the first non-blank line must start a comment: `//`, `///`,
`/*` or `/**`. Whether the header is *good* is left to review.

**Size rules:**

| Situation | Result |
|---|---|
| ≤ 300 lines | Pass |
| 301–500 lines | Pass, listed in a warning summary at the end |
| > 500 lines, not exempt | **Fail** |
| Exempt, grown beyond its recorded count | **Fail** |
| Exempt, shrunk but still > 500 | **Fail**: lower the recorded count (`--update` does it) |
| Exempt, now ≤ 500 | **Fail**: remove the entry (`--update` does it) |
| Exemption for a file that no longer exists | **Fail**: remove the entry (`--update` does it) |

Failing on shrinkage is deliberate: it makes the ratchet tighten, so a file
can never regrow to an old high-water mark. `--update` only ever lowers counts
and removes entries; it never adds or raises one.

**Messages** say what is wrong, why it matters and how to fix it:

```text
packages/ff-server/src/x.ts: 512 lines (limit 500). Split it by responsibility — see CONTRIBUTING.md › Code standards.
packages/sf-mcp/src/query/selectors.ts: grew from 1396 to 1402 lines while exempt (#NN). Exempt files may not grow.
packages/sf-mcp/src/query/bottlenecks.ts: now 480 lines — remove its exemption (npm run check:source -- --update).
packages/ff-server/src/y.ts: no file header. Start the file with a comment saying what it is responsible for.
```

### Ratchet list: `source-limits.json`

At the repository root:

```json
{
  "$comment": "Ratchet list for npm run check:source. Entries may only be removed or lowered. See CONTRIBUTING.md › Code standards.",
  "softLimit": 300,
  "hardLimit": 500,
  "ignore": ["**/dist/**", "**/node_modules/**", "**/src/generated/**", "**/bin/**", "**/obj/**", "packages/sf-game-data/extract/CUE4Parse/**"],
  "exemptDirectories": [
    { "path": "integrations/foreman-bridge/", "issue": 10, "reason": "Rewritten to the standard by bridge v2" }
  ],
  "exemptFiles": [
    { "path": "packages/ff-server/src/tools/workOrderTools.ts", "lines": 1625, "issue": 0 }
  ]
}
```

(`issue: 0` above is a placeholder in this example only; every real entry
carries its refactor issue number.) Config validation fails on unknown keys, a
missing issue number, or a duplicate path. Exempt directories skip both the
size and header rules.

The 14 files over 500 lines today, each getting a refactor issue:

| Lines | File |
|---|---|
| 1625 | `packages/ff-server/src/tools/workOrderTools.ts` |
| 1416 | `packages/ff-server/src/services/workOrderService.ts` |
| 1396 | `packages/sf-mcp/src/query/selectors.ts` |
| 1118 | `packages/ff-server/test/workOrderTools.test.ts` |
| 865 | `packages/ff-client/src/useForeman.ts` |
| 731 | `packages/ff-client/src/components/WorkOrderPanel.tsx` |
| 673 | `tools/sf-map-renderer/sf-map-renderer/Water/WaterModelBuilder.cs` |
| 624 | `packages/ff-server/test/routes.test.ts` |
| 585 | `packages/sf-save-data/test/normalise.test.ts` |
| 560 | `packages/ff-client/src/api/client.ts` |
| 546 | `packages/sf-mcp/src/query/bottlenecks.ts` |
| 537 | `packages/sf-game-data-graph/src/graph/queries/production.ts` |
| 527 | `packages/sf-mcp/test/bottlenecks.test.ts` |
| 521 | `tools/sf-map-renderer/sf-map-renderer/Collection/SceneCollector.cs` |

The counts are recorded again at implementation time, since `main` may have
moved on. A source file and its test file share one refactor issue when they
are split together (`workOrderTools.ts` and its test; `bottlenecks.ts` and its
test).

### Formatter configs for C# and C++

- **Root `.editorconfig`**: basics for every file (UTF-8, LF, final newline,
  trimmed trailing whitespace, two-space indent for JS/TS/JSON/Markdown) and C#
  conventions (four-space indent, Allman braces, `var` preferences, `using`
  ordering) matching the existing C# code as closely as possible.
- **`integrations/foreman-bridge/mod/.clang-format`**: Unreal Engine coding
  style (tabs, Allman braces, 120-column limit). Not enforced until bridge v2.
- **C# enforcement** is deferred to a follow-up issue: `dotnet format
  whitespace --folder --verify-no-changes` runs without loading or building the
  projects, so it doesn't need the CUE4Parse clone. The follow-up issue is one
  reformat PR plus the CI step.

### CI

- `ci.yml` gains a `npm run check:source` step next to `build`, `lint` and
  `test`, and runs the script's tests.
- Each package's `lint` stays `eslint . --max-warnings 0 && prettier --check
  …`, with the Prettier pattern widened to `"{src,test}/**/*.{ts,tsx,css}"`
  (as each package needs). ESLint picks up `eslint-suppressions.json`
  automatically.
- Root `lint` also runs ESLint and Prettier over the repository scripts.
- The bridge receiver's own workflow is unchanged.

## Testing

- **Source check:** `node:test` tests in `scripts/source-check/test/`, with no
  new dependency (the root has no Vitest). Each test builds a temporary git
  repository of fixture files and a config, then asserts findings and exit
  codes, covering:
  - under, between and over the limits;
  - exempt-and-grown, exempt-and-shrunk, exempt-and-compliant, stale entry;
  - `--update` lowering, removing, and never raising or adding;
  - missing header, a test file without a header (allowed), every comment
    style, a shebang, and a `#pragma once` before the header;
  - ignored globs and exempt directories;
  - config validation (unknown key, missing issue, duplicate path).
- **ESLint config:** `npm run lint` passes on every package with suppressions
  in place; a deliberately introduced violation fails (checked once by hand
  and recorded in the PR).
- **Whole repo:** `npm run build`, `npm run lint`, `npm test` and `npm run
  check:source` all pass at the end of each PR.

## Rollout

The order matters: the header rule would fail on 113 files the moment it is
switched on, so the headers land **before** the tooling that enforces them.

1. **GitHub first**: file the refactor issues (one per oversized source file;
   a test file shares its source's issue where they are split together), plus
   the C# formatting follow-up, each with `area:` labels, the *Foundations —
   identity & standards* milestone and a *Backlog* card. The exact list is
   confirmed with the user before anything is created.
2. **PR A: file headers** (branch `feature/file-headers`, from `main`): a
   header for every non-test source file that lacks one (113 TypeScript files
   today, plus C#, C++, JS and config files such as `eslint.config.js` outside
   the bridge), written from reading each file. Where an honest header has to
   join unrelated jobs, the file is noted on its refactor issue (or a new one)
   as a split candidate. Completeness is checked with a throwaway local run of
   the header rule.
3. **PR B: tooling and the standard** (branch `feature/code-standards`,
   rebased after PR A), committed in reviewable steps:
   1. this spec;
   2. the written standard (`CONTRIBUTING.md`, `AGENTS.md`, PR template);
   3. shared Prettier and ESLint configs replacing the package copies;
   4. Prettier over `test/**`: a mechanical reformat in its own commit;
   5. the new ESLint rules plus the generated `eslint-suppressions.json`
      files, generated *after* the reformat so the recorded violations match
      the formatted code;
   6. the source check, its tests and `source-limits.json`;
   7. `.editorconfig` and `.clang-format`;
   8. CI wiring.

`AGENTS.md` exists only on PR #17 (project identity), which is still open.
Both PRs are based on `main` after #17 merges (or rebased onto it), and their
`AGENTS.md` and `CONTRIBUTING.md` changes are written against #17's versions.

## Out of scope

- Splitting any of the oversized files (the refactor issues track that).
- Reformatting or enforcing formatting for C# (follow-up issue) or C++
  (bridge v2, #10).
- Bringing the bridge up to the standard (#10).
- Fixing existing ESLint violations beyond recording them as suppressions.
- Adding doc comments to existing exports (review covers them as files are
  touched).

## Acceptance criteria

- One root Prettier config and one ESLint base config; package configs carry
  only real differences.
- `npm run lint`, `npm run check:source`, `npm run build` and `npm test` pass
  on `main` after PR B, and fail when any rule in this spec is newly broken.
- Every exemption in `source-limits.json` names a real, open refactor issue on
  the Gaffer roadmap board.
- When PR B merges, the source check reports no missing headers outside
  exempt directories (PR A having added them).
- `CONTRIBUTING.md`, `AGENTS.md` and the PR template describe the same rules
  and agree with the tooling.
