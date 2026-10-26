# Contributing to Gaffer

Thanks for helping out. This is a community-first project — contributions of
code, docs, and game-data updates are all welcome.

## Conventions

This file is the single home for our conventions (`AGENTS.md`, which `CLAUDE.md`
imports, points here).

### Commits — Conventional Commits, body required
- Format `type(optional-scope): subject` — imperative, lowercase subject, no
  trailing full stop (e.g. `feat(server): add HTTP transport`).
- Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, `revert`.
- **A body is required** — explain *what* changed and *why* (wrap ~72 cols).
- Breaking changes: `type!: subject` plus a `BREAKING CHANGE:` footer.

### Branches
- Prefix by work type: `feature/<slug>`, `bugfix/<slug>`, `hotfix/<slug>`,
  `chore/<slug>` (tooling, configuration, dependencies and other upkeep that
  is neither a feature nor a fix).
- `<slug>`: lowercase, words joined by `-`, drop filler words.
- **Never commit directly to `main`** — branch first (also enforced by a ruleset).

### Pull requests
- One logical change per PR; keep it small (aim < ~500 changed lines).
- **Squash-merge** so `main` stays linear; the squash message follows the commit
  convention above.
- Update a branch from `main` with **rebase**, not a merge commit.
- Title: the Conventional Commit summary. Write the **complete** description at
  creation time, not in a later edit.
- **Link the PR to the issue(s) it resolves** with a closing keyword in the body
  (`Closes #N` / `Fixes #N`), so the issue auto-closes on merge and the issue
  shows the PR cross-reference. For a PR that advances but doesn't finish an
  issue, link it without the keyword (`Refs #N`) and leave the issue open.
- AI-generated PRs must begin the body with: `🤖 AI-generated PR — Please review
  carefully.`

### Issues
Issues live in [Gaffer's tracker](https://github.com/max-is-loud/ficsit-foreman/issues),
never upstream's. When you open an issue, label it and slot it onto the roadmap:
- **One type label** — `enhancement` (a feature or capability), `bug`,
  `documentation`, or `question` (an open decision to settle).
- **At least one `area:` label** for the part(s) it touches — `area:ff-client`,
  `area:ff-server`, `area:sf-mcp`, `area:sf-game-data`, `area:sf-save-data`,
  `area:sf-flow`, `area:bridge` (SML plugin and receiver), or `area:repo` (docs,
  tooling, CI and repository setup).
- **A milestone** — *Foundations — identity & standards*, *Live world*, or
  *Public release*. If none fits, leave it unset and explain why in the body.
- **A card on the [Gaffer roadmap](https://github.com/users/max-is-loud/projects/4)**
  board. New cards start in **Backlog**. After that, only the Mainspring project
  orchestrator changes the board, with `mainspring project-sync`. The stages are
  **Backlog**, **Ready**, **In progress**, **In review**, **Awaiting approval**
  and **Done**; the **Blocked** field marks a blocked card. A card goes to
  **Done** only after its PR merges.

References to the upstream FICSIT Foreman tracker are written as links labelled
`upstream #N`; a bare `#N` always means a Gaffer issue or PR.

### Closing issues — keep the roadmap honest
What actually ships often diverges from what an issue first proposed. When you
close one (usually by merging its PR), reconcile the surrounding roadmap in the
same stroke — a closed issue with a stale body, or a sibling that still claims
work you've absorbed, misleads the next reader.

- **Always add a closing comment** when you close an issue — summarise what
  shipped and link the PR (e.g. `Closed by #NNN`), even when the scope matched the
  body exactly. When the delivered scope differs (it grew, shrank, or the approach
  changed), additionally call out where it diverged from the original plan. Prefer
  a comment over editing the original body, so the history of the decision is
  preserved.
- **A PR that completely addresses an issue must link it with a closing keyword**
  (`Closes #N` / `Fixes #N`, see Pull requests above) so merging auto-closes it
  and records the issue↔PR link. Then add the closing comment above. Don't leave a
  fully-resolved issue open or close it by hand without the linked PR.
- **Re-scope related issues.** If closing one changes a sibling's scope — work
  pulled forward into this one, or an approach here that supersedes another's plan
  — edit that sibling's body/title to match, and note why. An open issue must
  describe the work that's *actually left*, not the original carve-up.
- **Update the milestone description** when a milestone's framing no longer holds
  (e.g. a "foundational refactor" it attributed to one issue shipped in another).
- **Ensure the issue↔PR links exist** (see the closing keywords above); if an
  issue was closed without a linked PR, add a comment pointing at the PR/commit.

### Code standards
The reasoning behind these rules is in the
[design spec](./docs/superpowers/specs/2026-10-15-code-standards-design.md).
Tools check what they can; the rest is checked in review (see the PR template).

1. **Readable by default.** Use descriptive names. Single letters are for loop
   indices and coordinates (`i`, `j`, `k`, `x`, `y`, `z`) and ignored values
   (`_`). One statement per line. Formatting is the formatter's job: Prettier
   for JS/TS, `.editorconfig` for C#, `.clang-format` (Unreal style) for C++.
2. **Comments explain why.** Every non-test source file opens with a header of
   one to three sentences: what the file is responsible for and, where useful,
   what it leaves to other files. Comment anything a reader couldn't see from
   the code: a protocol rule, a game or engine workaround, an ordering or
   concurrency guarantee, a unit convention. Exported functions, classes and
   types whose behaviour isn't evident from their name and types get a doc
   comment stating the contract (inputs, units, errors, side effects). A comment
   that restates the code is removed, not kept.
3. **No god files.** One responsibility per file. Over 300 lines is a prompt to
   check the file still does one thing; over 500 lines fails CI. If the header
   can only be honest by joining unrelated jobs with "and", split the file.
4. **Small, flat functions.** At most 60 lines (blank lines and comments not
   counted), nesting depth 3, complexity 12 and 4 parameters. Pass an options
   object instead of a fifth parameter.
5. **Extend with data, not branches.** Add a new kind of thing (building
   category, event type, tool definition) as an entry in a registry or table,
   not as another arm of a growing `if`/`switch` chain.
6. **Existing rules stay.**
   - Always use curly braces, even for single-line `if`/`else`/loops.
   - Explicit return types on all exported functions.
   - No `any`: use `unknown` and narrow it.
   - Errors are logged with context, never silently swallowed.
   - Parser warnings are collected into `parseWarnings[]`, not thrown.
   - **British English** in all comments and documentation.
7. **Enforced in CI; the rest in review.** See below.

#### How it's enforced

**Source check** (`npm run check:source`) covers tracked and untracked (but not git-ignored) `.ts`, `.tsx`, `.js`,
`.mjs`, `.cs`, `.cpp` and `.h` files, tests included (a test file is one under a `test`/`tests`/`Tests` folder or a
folder ending `-tests`, or named `.test.` or `.spec.`). It counts physical
lines (as `wc -l` does). Between 301 and 500 lines is a warning; over 500 fails. Every
non-test file must open with a comment (`//`, `///`, `/*` or `/**`), after any
shebang or `#pragma once`. Example messages:

```text
packages/ff-server/src/x.ts: 512 lines (limit 500). Split it by responsibility — see CONTRIBUTING.md › Code standards.
packages/ff-server/src/y.ts: no file header. Start the file with a comment saying what it is responsible for.
```

**ESLint** (shared rules in `eslint.config.base.js`; each package's
`eslint.config.js` re-exports them) reports these as errors, alongside the
existing curly, `no-explicit-any` and unused-variable rules:

| Rule | Limit |
|---|---|
| `max-lines-per-function` | 60 (blank lines and comments skipped) |
| `max-depth` | 3 |
| `complexity` | 12 |
| `max-params` | 4 |
| `id-length` | at least 2, except `i j k x y z _`; property names are ignored because game data and wire formats dictate them |

Test files (`**/test/**`, `**/tests/**`, `**/Tests/**`, `**/*-tests/**`, `**/*.test.*`, `**/*.spec.*`) are exempt from the first
three. Example: `Function 'build' has too many parameters (5). Maximum allowed is 4`

**Prettier** (one root `.prettierrc.json`) checks TS formatting (plus each package's
`eslint.config.js`) in every package, the root config files, `scripts/` and `.github/scripts/` as part of
`npm run lint`. `npm run format` rewrites files to match. `.editorconfig` covers
C#, and `tools/sf-map-renderer/` has its own. C++ has a `.clang-format`
(`integrations/foreman-bridge/mod/`), not enforced until bridge v2
([#10](https://github.com/max-is-loud/ficsit-foreman/issues/10)). C# formatting
enforcement is tracked in [#30](https://github.com/max-is-loud/ficsit-foreman/issues/30).

**The ratchet.** Code that predates the standard is recorded, not excused:
nothing new may be added to the record, and the record can only shrink. There are
two record files.

- `source-limits.json` (root) lists files over 500 lines with their line counts
  and refactor issues, plus `integrations/foreman-bridge/` (exempt until bridge
  v2, #10). An exempt file may not grow. If it shrinks, or drops under 500 lines,
  the check fails until you run `npm run check:source -- --update`, which only
  lowers counts and removes entries.
- `eslint-suppressions.json` (root and in each package) records existing ESLint
  violations. A new violation fails. A recorded violation you have fixed also
  fails until you run `npm run lint:prune` in the package you changed (or
  `npm run lint:prune -w <package>` from the root). The root `lint:prune` covers
  only the root tooling: `scripts/`, `.github/scripts/` and the root ESLint configs.

**Never add an exemption or suppression by hand, never re-run `--suppress-all`,
and never raise a recorded count.** If a change needs more room, split the code.
Reviewers will reject a record file that grew.

### Contributing upstream
Gaffer is derived from [FICSIT Foreman](https://github.com/StuartMeeks/ficsit-foreman)
and stays on good terms with it. To keep offering fixes back possible:
- Keep generally useful changes — especially in the `sf-*` libraries — in
  **self-contained commits**, not mixed with Gaffer-only work.
- The `upstream` remote is **read-only**: fetch from it and cherry-pick useful
  upstream changes; never push to it or file anything on its tracker from here.
- To offer a change back, fork upstream on GitHub, cherry-pick the commit onto a
  branch from `upstream/main` in that fork, and open the PR there, following
  upstream's own conventions.

## Development

```bash
npm install
npm run build      # type-check / build the workspaces
npm run lint       # ESLint + Prettier
npm run check:source  # file size and header rules
npm run format     # apply Prettier
npm test           # Vitest + source-check tests
```

CI (`build` + `lint` + `check:source` + `test`) runs on every PR and must pass before merge.
Docker image builds run only when image-relevant files change.

## Supplying game data (the channel bundle)

The MCP server ships **bundled game data per release channel** so it works out of
the box. At most two channels are kept — the latest **stable** and the latest
**experimental** build. Each channel is now a **single file**:

```
packages/sf-game-data/data/
  stable/        sf-game-data.json
  experimental/  sf-game-data.json
```

`sf-game-data.json` is the merged dataset for one game build: the extracted
collectible/resource-node world data, the `gameData` (items/recipes/buildings/
schematics) parsed from `en-US.json`, and `gameVersion`/`build` stamped at the top
level. It is produced offline by the extractor — see
[`packages/sf-game-data/extract`](./packages/sf-game-data/extract/README.md). The
raw `en-US.json` is read from the game install at extract time and is **never
committed**; the old `meta.json` sidecar is retired (its fields live in the dataset).

When you update a channel, follow these rules — they are enforced by the
**Validate game data** CI check:

> **One channel per PR.** A data PR must contain **only** that channel's
> `packages/sf-game-data/data/<channel>/sf-game-data.json` (no code, no docs, no
> other channel).

> **Regenerate, never hand-edit.** Produce `sf-game-data.json` with the extractor
> (which stamps the `gameVersion`/`build` you pass). The check re-verifies the
> world dataset against fixed, known world totals and requires a non-empty
> `gameData`, so a hand-edited or stale dataset will fail.

The check also requires `gameVersion` to be a non-empty string and `build` a
positive integer that does **not regress** below that channel's current value (a
same-build re-extraction is allowed). Channels are independent.

How to update one (for channel `<channel>` = `stable` or `experimental`):

1. **Regenerate** `sf-game-data.json` by running the extractor against that build
   — see [`packages/sf-game-data/extract/README.md`](./packages/sf-game-data/extract/README.md) —
   passing `--version`/`--build` for the build you're capturing. The extractor reads
   `en-US.json` from the game install; you never copy it into the repo.
2. Install it and commit **only** that one file:

   ```bash
   git checkout -b feature/update-stable-game-data
   cp sf-game-data.json packages/sf-game-data/data/stable/sf-game-data.json
   git add packages/sf-game-data/data/stable/sf-game-data.json
   git commit -m "chore(sf-game-data): update stable dataset to 1.2.3.1 (build 495413)"
   ```

3. Open a PR containing only that commit.

> **Note:** the dataset is derived from Satisfactory game data © Coffee Stain
> Studios — only factual values (coordinates, names, recipe amounts) are stored, no
> game assets. The raw `en-US.json` is never committed (`game-data/` and any
> `data/*/en-US.json` are gitignored).
