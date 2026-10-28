# Gaffer for Satisfactory — intake report

<!-- Written by the repo-intake worker for user approval. The intake read the repository
     and changed no existing file. Never copy an access key, a sensitive value, or
     `.env` content into this report. -->

- Base commit: e8a76b73c1b4099a6a542ff1b51164863357dba6
- Date: 2026-10-28

## Verification command results

Each command ran once at the base commit, with a limit of 15 minutes. The result is
"verified" only for exit code 0. Otherwise it is "failed", or "timed out" after the limit.

`mainspring verify` ran twice, each time in a new clean clone of the base commit. Run 1 had the five commands of the `verification` list (exit 0). Run 2 had the commands of `.github/workflows/foreman-bridge.yml` (exit 3, `verification_failed`). The local toolchain is Node.js 24.21.0 and npm 11.17.0.

| Command | Exit code | Duration | Result |
| --- | --- | --- | --- |
| `npm ci --prefer-offline --no-audit --no-fund` (run 1) | 0 | 15.8 s | verified |
| `npm run build` | 0 | 5.1 s | verified |
| `npm run lint` | 0 | 16.9 s | verified |
| `npm run check:source` | 0 | 0.2 s | verified |
| `npm test` | 0 | 15.9 s | verified |
| `cd integrations/foreman-bridge/receiver && npm test` | 0 | 60.6 s | verified |
| `cd integrations/foreman-bridge/receiver && node ../scripts/update-source-manifest.mjs --check` | 1 | 0.1 s | failed |
| `npm ci --prefer-offline --no-audit --no-fund` (run 2) | 0 | 15.8 s | verified |
| `npm test -w @foreman/ff-server -- test/bridge-integration.test.ts` | 0 | 1.0 s | verified |

The source-manifest check fails at the base commit. A separate clean clone gave the cause: `stale: mod/.clang-format`. Commit `67099d2` (#32) added `integrations/foreman-bridge/mod/.clang-format` and did not update `integrations/foreman-bridge/source-manifest.json`. The check is not a required status check, because the ruleset requires only `build-test`. The next PR that touches `integrations/foreman-bridge/**` gets a red `receiver` job.

The new `verification` list in `.mainspring/config.json` has the five original commands and the receiver test. It does not have the failed manifest check. It does not have the separate bridge end-to-end test, because `npm test` runs that test on Node.js 24 or later (`packages/ff-server/test/bridge-integration.test.ts:56`).

## Toolchains and coverage

| Toolchain | Parts | What the intake examined | Verified here |
| --- | --- | --- | --- |
| TypeScript, Node.js 22+ and npm 11+ (npm workspaces, Vitest, ESLint, Prettier, Prisma) | `packages/*` (10 packages), `scripts/`, `.github/scripts/` | Root `package.json`; the scripts and dependencies of each package `package.json`; `eslint` and `source-limits.json` setup; `ci.yml` | Yes: build, lint, source check and tests (run 1) |
| Node.js 24.21+ (`node:test`, `node:sqlite`, OpenSSL) | `integrations/foreman-bridge/receiver/`, `integrations/foreman-bridge/scripts/` | `package.json`, `README.md`, `foreman-bridge.yml`, the manifest script | Receiver tests: yes. Manifest check: failed |
| C# .NET 10 | `packages/sf-game-data/extract/` (3 projects), `tools/sf-map-renderer/` (tool and tests) | The `.csproj` and `Directory.Build.props` target frameworks; the prerequisite sections of the two READMEs | No. `dotnet` is not installed, and the extractor and the renderer need the Windows host and a game install |
| C++ Unreal Engine 5 (SML plugin) | `integrations/foreman-bridge/mod/` | The directory list, `ForemanBridge.uplugin` name, `integrations/foreman-bridge/README.md` | No. It needs the custom Unreal engine and a native Windows toolchain |
| Docker and Docker Compose | `compose.yaml`, three `Dockerfile`s, three image workflows | `compose.yaml` (lines 1-80, 136-137); `docker-publish-ff-client.yml` | No. `docker` is not installed. CI builds the images on a path filter |
| GitHub Actions | `.github/workflows/` (9 files) | `ci.yml`, `codeql.yml`, `dependabot-auto-merge.yml`, `docker-publish-ff-client.yml`, `foreman-bridge.yml`, `pr-title.yml`, `validate-game-data.yml` | Not applicable |

The intake did not examine these parts. The project record names them in "Open questions" where they affect verification.

- The source code of the packages, except short searches in `packages/ff-server/src/config.ts`, `packages/ff-server/src/llm/`, `packages/sf-mcp/src/config.ts` and `packages/ff-server/test/bridge-integration.test.ts`.
- The package READMEs, the `Dockerfile`s, the Prisma schema, and `packages/ff-client/design-reference/`.
- `docker-publish-ff-server.yml` and `docker-publish-sf-mcp.yml`. The intake assumes that they mirror the `ff-client` workflow, as its header says (`docker-publish-ff-client.yml:4-5`).
- The design documents in `docs/` other than `architecture.md`, `product.md` (lines 1-40) and `live-constructor-awareness.md` (lines 1-30), and all of `docs/superpowers/` and `docs/measurements/`.
- `.github/scripts/check-game-data.mjs`, `scripts/source-check/`, and `.agents/skills/`.
- The C# and C++ sources.
- The `.env.example` file exists. The intake did not copy its content. No `.env` file is present in the worktree.

## Existing agent instructions

The existing agent instruction files are `AGENTS.md` (Gaffer part, lines 1-165), `CLAUDE.md` (Mainspring-managed import), `agents/orchestrator.md`, `agents/worker.md`, `agents/reviewer.md`, and the conventions in `CONTRIBUTING.md`. The intake changed none of them. The diff below proposes the seven changes of the brief. It does not touch `CLAUDE.md` or the text between the `mainspring:begin` and `mainspring:end` markers of `AGENTS.md` (line 167 to line 242). `git apply --check` accepts the diff at the base commit.

| Item | File and lines at the base commit | Check against the files | Proposed change |
| --- | --- | --- | --- |
| 1. GitHub writes | `CONTRIBUTING.md:26-38`, `CONTRIBUTING.md:61-84` | Correct. Both sections address the reader as the one who opens PRs, closes and comments on issues, re-scopes siblings and edits milestones. `agents/orchestrator.md:10` gives all GitHub writes to the orchestrator; `agents/worker.md:22` forbids them for a worker. | A short paragraph at the start of each section. The rules stay for human contributors. `CONTRIBUTING.md:40-56` (Issues) also addresses the reader as the one who opens issues; the intake left it unchanged, because line 51-56 already names the orchestrator for the board. |
| 2. Rebase | `CONTRIBUTING.md:30` | Correct. `.claude/skills/project-chief/SKILL.md:212` says that a new commit needs a new review round and a new user approval. The ruleset does not require an up-to-date branch. | Rebase only to resolve a conflict, or when the orchestrator asks. |
| 3. Issue recipe | `AGENTS.md:109-117` | Correct. The recipe uses `gh issue create` and `gh project item-add`. In the installed Mainspring 0.4.22, `issue-ensure` takes `repository`, `operation_id`, `title`, `body`, `issue` and `artifact`, and no labels or milestone. `project-sync` adds a missing issue to the board. | Three steps: `issue-ensure`, `gh issue edit`, `project-sync` with stage `Backlog`. `project-sync` needs `project.id`, which PR #64 sets. |
| 4. Status by hand | `AGENTS.md:58-74` | Correct. `docs/architecture.md:143-149` already has the phase history and the links to the tracker and the board. `AGENTS.md:60-71` lists the shipped capabilities with their upstream links. Design documents also record the shipped status of the pipeline, ingest-time verification, the flow solver and the Kùzu removal. The intake found the shipped status of Work Orders v2 and explore orders only in `AGENTS.md`. | A pointer to the board, to `docs/workflow/project.md` and to `docs/architecture.md` › Status / history. The project record (Architecture) now keeps the list, the upstream links, and the other documents that record each item. |
| 5. PR description | `CONTRIBUTING.md:31-32` | Correct. | Allow an edit when a later commit changes what the PR does. |
| 6. Ruleset | `CONTRIBUTING.md:24` | Correct: the text says only "also enforced by a ruleset". | Describe the `main protection` ruleset with the facts of the brief. |
| 7. Dev environment | `AGENTS.md:157-165` | Correct. The note names a Proxmox VM over SSH. | WSL2 on the Windows host. The statement "game files are not accessible" was about the VM, and nobody checked it for WSL2. The diff changes it to "do not assume that the game files are accessible from WSL2". The other facts stay. |

The intake found these other stale statements. It gives no diff for them, because they are outside the seven items:

- `.github/workflows/dependabot-auto-merge.yml:15-26` says that the repository has no `main protection` ruleset, and that the ruleset requires a code-owner approval. Both statements are now wrong.
- `docs/advanced-game-settings.md:5`, `docs/advanced-game-settings.md:197`, `tools/sf-map-renderer/README.md:14` and `packages/sf-game-data/extract/sf-game-data-parse/sf-game-data-parse.csproj:5-6` still name the dev VM.
- `README.md:113-114` and `docs/architecture.md:139` say npm 10 or later. `package.json:14` requires npm 11 or later.
- `AGENTS.md:21-35` and `docs/architecture.md:62` do not list `sf-flow` and `sf-save-data-graph`.

```diff
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -57,21 +57,11 @@
 
 ## Status
 
-Phases 1 (game-data MCP) and 2 (backend & foreman chat) are complete and merged;
-Work Orders v2 shipped. The web client (Phase 3) is in progress. The save-game MCP
-shipped v1. The **single-producer game-data pipeline** shipped (epic [upstream #164](https://github.com/StuartMeeks/ficsit-foreman/issues/164)): an
-offline C# extractor parses `en-US.json` and extracts the cooked assets into one
-merged `sf-game-data.json` per channel, which the runtime loads directly — the raw
-`en-US.json` is no longer committed. Since then: **explore orders** (a second
-work-order type — collection routes with save-reupload reconciliation, [upstream #207](https://github.com/StuartMeeks/ficsit-foreman/issues/207)/[upstream #209](https://github.com/StuartMeeks/ficsit-foreman/issues/209)),
-**ingest-time verification** (every plan reference resolved-or-rejected + power/
-recipe quantity checks, [upstream #222](https://github.com/StuartMeeks/ficsit-foreman/issues/222)/[upstream #223](https://github.com/StuartMeeks/ficsit-foreman/issues/223)), and a **flow solver** (`sf-flow` +
-`find_bottlenecks`, [upstream #148](https://github.com/StuartMeeks/ficsit-foreman/issues/148)/[upstream #126](https://github.com/StuartMeeks/ficsit-foreman/issues/126)) shipped, and the game-data graph **dropped Kùzu**
-for an in-memory adjacency projection ([upstream #243](https://github.com/StuartMeeks/ficsit-foreman/issues/243)) — no `sf-*` package carries a native
-dependency now. Gaffer's own work — starting with live-world awareness via the
-SML bridge (`integrations/foreman-bridge`) — is tracked in Gaffer's
-[issue tracker](https://github.com/max-is-loud/ficsit-gaffer/issues) and on the
-[Gaffer roadmap](https://github.com/users/max-is-loud/projects/4) board.
+The [Gaffer roadmap](https://github.com/users/max-is-loud/projects/4) board is the
+authority for the status of each issue. The project record,
+[`docs/workflow/project.md`](./docs/workflow/project.md), gives the outcome, the
+constraints and the architecture. The history is in
+[`docs/architecture.md` › Status / history](./docs/architecture.md#status--history).
 
 ## Conventions
 
@@ -107,14 +97,14 @@
   fetching and cherry-picking. `gh` defaults to `max-is-loud/ficsit-gaffer`
   (`gh repo set-default`); pass `-R max-is-loud/ficsit-gaffer` if unsure.
 - **Every new issue goes on the Gaffer roadmap board** (user project 4) with a
-  status. The `gh issue create --project` flag fails on this board, so add it
-  separately:
+  status. Only the project orchestrator files issues. It does these steps:
 
-  ```sh
-  url=$(gh issue create -R max-is-loud/ficsit-gaffer --title "…" --body-file body.md \
-    --label "enhancement,area:ff-server" --milestone "Live world")
-  gh project item-add 4 --owner max-is-loud --url "$url"
-  ```
+  1. File the issue with `mainspring issue-ensure` (`repository`, `operation_id`,
+     `title`, `body`).
+  2. Set the type label, the `area:` labels and the milestone with
+     `gh issue edit <number> -R max-is-loud/ficsit-gaffer --add-label "…" --milestone "…"`.
+  3. Put the card in **Backlog** with `mainspring project-sync` (stage `Backlog`,
+     `blocked: false`). The command adds the issue to the board if it is not there.
 
   New items start in **Backlog**. After that, only the project orchestrator
   changes the board. It moves each item through the Mainspring stages (Backlog,
@@ -156,13 +146,14 @@
 
 ## Dev environment note
 
-Development happens on a Proxmox VM over SSH. The Satisfactory game files are **not**
-accessible from the VM. A copy of `en-US.json` may be placed at `game-data/en-US.json`
-(gitignored) for the **offline extractor** to parse (`--enus`); it is **not** read at
-runtime and is never committed. The VM and the running server load the bundled merged
-`sf-game-data.json` (or `SF_GAME_DATA_PATH`). The C# extractor itself only builds/runs
-on the Windows host (CUE4Parse + a game install) — do not assume a game directory is
-mounted at runtime.
+Development happens in WSL2 on the Windows host. There is no Proxmox VM. Do not
+assume that the Satisfactory game files are accessible from WSL2. A copy of
+`en-US.json` may be placed at `game-data/en-US.json` (gitignored) for the
+**offline extractor** to parse (`--enus`); it is **not** read at runtime and is
+never committed. The development environment and the running server load the
+bundled merged `sf-game-data.json` (or `SF_GAME_DATA_PATH`). The C# extractor
+itself only builds/runs on the Windows host (CUE4Parse + a game install) — do not
+assume a game directory is mounted at runtime.
 
 <!-- mainspring:begin (managed by Mainspring; the installer reports edits in this block as conflicts) -->
 # Repository instructions for agents
--- a/CONTRIBUTING.md
+++ b/CONTRIBUTING.md
@@ -21,15 +21,28 @@
   `chore/<slug>` (tooling, configuration, dependencies and other upkeep that
   is neither a feature nor a fix).
 - `<slug>`: lowercase, words joined by `-`, drop filler words.
-- **Never commit directly to `main`** — branch first (also enforced by a ruleset).
+- **Never commit directly to `main`** — branch first. The `main protection`
+  ruleset enforces this. It requires a pull request and the `build-test` status
+  check, allows squash merges only, and blocks force pushes and branch deletion.
+  It has no bypass actors. It requires no approving review, and it does not
+  require the branch to be up to date with `main`. The repository deletes the
+  head branch after a merge.
 
 ### Pull requests
+Under Mainspring, only the project orchestrator does GitHub writes: it pushes,
+opens the PR and merges it (`agents/orchestrator.md`). A worker writes the PR
+title and description in its report, and the orchestrator uses them.
+
 - One logical change per PR; keep it small (aim < ~500 changed lines).
 - **Squash-merge** so `main` stays linear; the squash message follows the commit
   convention above.
-- Update a branch from `main` with **rebase**, not a merge commit.
+- Do not update a branch from `main` only to keep it current: the ruleset does
+  not require it. Update it only to resolve a conflict, or when the orchestrator
+  asks. Then use **rebase**, not a merge commit. A rebase makes a new head, and a
+  new head needs a new review round and a new user approval.
 - Title: the Conventional Commit summary. Write the **complete** description at
-  creation time, not in a later edit.
+  creation time. Edit it when a later commit changes what the PR does, so that
+  the description always matches the change.
 - **Link the PR to the issue(s) it resolves** with a closing keyword in the body
   (`Closes #N` / `Fixes #N`), so the issue auto-closes on merge and the issue
   shows the PR cross-reference. For a PR that advances but doesn't finish an
@@ -59,10 +72,15 @@
 `upstream #N`; a bare `#N` always means a Gaffer issue or PR.
 
 ### Closing issues — keep the roadmap honest
-What actually ships often diverges from what an issue first proposed. When you
-close one (usually by merging its PR), reconcile the surrounding roadmap in the
-same stroke — a closed issue with a stale body, or a sibling that still claims
-work you've absorbed, misleads the next reader.
+What actually ships often diverges from what an issue first proposed. When an
+issue closes (usually when its PR merges), reconcile the surrounding roadmap in
+the same stroke — a closed issue with a stale body, or a sibling that still
+claims absorbed work, misleads the next reader.
+
+Under Mainspring, the project orchestrator does the steps below: it comments on
+and closes issues, re-scopes sibling issues and edits milestones. A worker gives
+the closing comment, and each sibling or milestone change that it proposes, in
+its report.
 
 - **Always add a closing comment** when you close an issue — summarise what
   shipped and link the PR (e.g. `Closed by #NNN`), even when the scope matched the
```

## Candidate first batch

The capacity is two implementation slots and two review slots (`.mainspring/config.json:2-5`). The proposed first batch is #52, #33 and #35: one substantial security fix and two bounded fixes in one area. Run #35 after #33, because both change the output-token path of `ff-server`. "Substantial" selects the `implementation` route (Opus); "bounded" selects `bounded_implementation` (Sonnet).

| Issue | Title | Substantial | Reason |
| --- | --- | --- | --- |
| #52 | fix(server): stop model-supplied save paths reaching other playthroughs' saves | Yes | **Batch 1.** A security bug across `ff-server` and `sf-mcp` (`savePath` in `packages/sf-mcp/src/config.ts` and `packages/ff-server/src/llm/chat.ts`). Use the complex review route. |
| #33 | fix(server): chat turns end silently when the model hits the output-token limit | No | **Batch 1.** A bug in the `ff-server` LLM layer. The provider stop reason already exists (`packages/ff-server/src/llm/types.ts:79`). |
| #35 | fix(server): raise the default LLM_MAX_TOKENS from 4096 | No | **Batch 1, after #33.** One default (`packages/ff-server/src/config.ts:64`) and its documentation. |
| #66 | chore: adopt Mainspring with an intake and a project record | Yes | This intake. |
| #63 | chore: map the roadmap board to the Mainspring stages | No | Orchestrator work: it needs GitHub writes. The board fields in the brief already have the Mainspring stages and `Blocked`. |
| #65 | chore(bridge): make the live dedicated server the bridge test bed | Yes | It changes a live remote server. It needs the user's go-ahead and a plan first. |
| #43 | feat(server): make the model's effort level configurable | No | Later wave. A bounded `ff-server` configuration feature. |
| #48 | feat(server): list what is still locked once most of the game is unlocked | Yes | Later wave. A feature across `ff-server` and `sf-mcp`. |
| #18 | refactor(server): split workOrderTools.ts by responsibility | Yes | Later wave. 1629 and 1113 lines (`source-limits.json:22-30`). |
| #19 | refactor(server): split workOrderService.ts by responsibility | Yes | Later wave. 1420 lines (`source-limits.json:32-34`). Conflicts with #18 are likely; do not run them in parallel. |
| #20 | refactor(mcp): split selectors.ts by responsibility | Yes | Later wave. 1400 lines (`source-limits.json:37-39`). |
| #21 | refactor(client): split useForeman.ts by responsibility | No | Later wave. 870 lines (`source-limits.json:42-43`); mechanical, ratchet-tracked. |
| #22 | refactor(client): split WorkOrderPanel.tsx by responsibility | No | Later wave. 737 lines (`source-limits.json:47-48`); mechanical. |
| #24 | refactor(server): split routes.test.ts by responsibility | No | Later wave. 624 lines (`source-limits.json:57-58`); tests only. |
| #25 | refactor(save-data): split normalise.test.ts by responsibility | No | Later wave. 585 lines (`source-limits.json:62-63`); tests only. |
| #26 | refactor(client): split api/client.ts by responsibility | No | Later wave. 560 lines (`source-limits.json:67-68`); mechanical. |
| #27 | refactor(mcp): split bottlenecks.ts by responsibility | No | Later wave. 550 and 527 lines (`source-limits.json:72-78`); mechanical. |
| #28 | refactor(game-data-graph): split production.ts by responsibility | No | Later wave. 541 lines (`source-limits.json:82-83`); mechanical. |
| #23 | refactor(map-renderer): split WaterModelBuilder.cs by responsibility | No | Blocked here: no .NET SDK, and the renderer needs the Windows host. |
| #29 | refactor(map-renderer): split SceneCollector.cs by responsibility | No | Blocked here, as #23. |
| #30 | ci: enforce C# formatting with dotnet format | No | Needs a .NET SDK to verify locally (open question 2). |
| #15 | chore: rename FICSIT Foreman to Gaffer before public release | Yes | Later. At the base commit, 273 of 584 tracked files contain "foreman" (any case). Commands: `git grep -l -i foreman e8a76b7 -- . \| wc -l` and `git ls-tree -r --name-only e8a76b7 \| wc -l`. The count is an upper limit, because "foreman" is also the name of the companion persona, which can keep that name. Run it when few branches are open. |
| #16 | Choose a publication licence for the bridge plugin | No | A user decision, not agent work. |
| #10 | feat(bridge): live world — building category registry and player position | Yes | Later. The plugin part needs the Windows and Unreal toolchain. |
| #13 | feat(bridge): progression events — milestones, research, collectibles | Yes | Later. The plugin part needs the Windows and Unreal toolchain. |
| #14 | feat(bridge): periodic readings — power, fuses, machine status, rates | Yes | Later. The plugin part needs the Windows and Unreal toolchain. |
| #11 | feat(server): machine-checkable work-order goals and completion watcher | Yes | Later. A design change to work orders (`docs/work-orders.md`). |
| #12 | feat(server): base model — group buildings into named bases | Yes | Later. A new domain model in `ff-server`. |

## Risks

- The bridge source-manifest check fails at the base commit. The next PR that touches the bridge gets a red `receiver` job until somebody runs `--write` and commits the manifest.
- Local verification uses Node.js 24.21.0. The `build-test` CI job uses Node.js 22 and skips the bridge end-to-end test. A change that passes here can still fail on Node.js 22, and the reverse is true for the end-to-end test.
- The receiver test adds about 61 seconds to each `verify` run. It needs Node.js 24.21 or later and OpenSSL on the machine.
- The intake did not verify the C# extractor, the map renderer, the Unreal plugin or the Docker images. A change to them has no local evidence.
- The proposed `project-sync` step needs `project.id`. It is `null` at the base commit; PR #64 sets it. The "Decisions and approvals" link in the project record also points to a file that does not exist until PR #64 merges.
- Two facts in the project record come from the brief and not from the repository: the `main protection` ruleset and the WSL2 decision.
- The intake did not read most package sources and design documents (see "Toolchains and coverage"). The architecture section depends on the top-level documents.

## Assumptions

- `merge.method` stays `squash`, because `CONTRIBUTING.md:28` names squash merges and the ruleset allows squash only.
- The `verification` list keeps the five original commands, with their `--prefer-offline --no-audit --no-fund` flags. The intake added the receiver test, because it passed and CI runs it. The orchestrator can remove it if the extra 61 seconds is not acceptable.
- The intake left out the bridge end-to-end test as a separate command, because `npm test` runs it on Node.js 24.
- The intake left out the failed manifest check, as the skill requires.
- The dev-environment diff says "do not assume that the game files are accessible from WSL2". The intake did not check the Windows file system from WSL2.
- The first batch fits two implementation slots: #52 in one slot, then #33 and #35 in sequence in the other slot.
- The `docker-publish-ff-server.yml` and `docker-publish-sf-mcp.yml` workflows mirror the `ff-client` workflow.
