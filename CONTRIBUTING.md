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
- Prefix by work type: `feature/<slug>`, `bugfix/<slug>`, `hotfix/<slug>`.
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
  board. New cards start in **Backlog**; move them through **Todo** and
  **In Progress** as work is scheduled and started. Closing the issue moves the
  card to **Done**.

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
- Always use curly braces, even for single-line `if`/`else`/loops.
- Explicit return types on all exported functions.
- No `any` — use `unknown` and narrow it.
- Errors are logged with context, never silently swallowed.
- Parser warnings are collected into `parseWarnings[]`, not thrown.
- **British English** in all comments and documentation.

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
npm test           # Vitest
```

CI (`build` + `lint` + `test`) runs on every PR and must pass before merge.
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
