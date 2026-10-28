# Gaffer — decisions

<!-- Append one dated entry per decision. An approval cites the user's own message;
     a record written by an agent is not itself proof of permission. -->

## 2026-10-28 — Close the issues that PR #51 resolved

- Kind: issue closure
- Source: message `c1f48cfa-8c1a-4b1d-8678-7184c8a05a3d` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: none. No batch applies.
- Consequences: The orchestrator checked each issue against its acceptance criteria, the code, the tests and `docs/measurements/chat-tool-economy.md`. It closed #34, #36, #37, #38, #39, #45, #46 and #47 as completed, each with an evidence comment. The comment on #38 records that the plan target of 4 or fewer rounds for an iron turn is not met (median 5).

## 2026-10-28 — Map the roadmap board to the Mainspring stages

- Kind: board setup
- Source: message `c1f48cfa-8c1a-4b1d-8678-7184c8a05a3d` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: none. No batch applies.
- Consequences:
  - The Status field has the six stages: Backlog, Ready, In progress, In review, Awaiting approval and Done. "Todo" became "Ready" with the same option ID, so #43 stayed in its column. The other existing options also kept their IDs.
  - A new single-select field, Blocked, has the options No and Yes.
  - `project-sync` added the 12 issues that were not on the board: #33, #35, #48 and #52 in Backlog, and the eight closed issues in Done.
  - `.mainspring/config.json` names the Project node ID, so `audit github` can read the board.

## 2026-10-28 — Use the live dedicated server as the bridge test bed

- Kind: access and scope
- Source: message `8c936ce7-e659-4ffb-9271-93e3a464d580` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: none. No batch applies.
- Consequences:
  - An agent may SSH to `openclaw` for read-only checks. Each change on the server still needs the user's approval for that step.
  - Tests use the real save. Back it up before each bridge install.
  - The orchestrator filed #65 in the Live world milestone, with the facts of the first read-only check.

## 2026-10-28 — Settle the game-update and deployment choices of #65

- Kind: design
- Source: message `f2c18a8e-2fdd-4d2e-bf1c-6f706ee29b4c` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: none. No batch applies.
- Consequences:
  - The server keeps the automatic game updates at restart. After a game update, it starts without mods until SML supports the new build.
  - For the first bridge tests, Gaffer runs on the dev machine and connects to the bridge over Tailscale. The Foreman deployment on the VPS stays unchanged until the bridge works.
  - Tasks 2, 5 and 6 of #65 now state these decisions.

## 2026-10-28 — Run the Mainspring intake as the batch `adopt-mainspring`

- Kind: batch
- Source: message `ec24ff76-2699-4ed7-868a-f5362768e259` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:ef4310d43fc6c708e76d1788fd256e4be07948aadb061c313cdb52cfb3d318a3`
- Consequences:
  - The batch has one task: #66, the brownfield intake. The `repo-intake` skill is its plan.
  - An intake worker (`claude-opus-5-5`, effort high) writes `docs/workflow/project.md` and `docs/workflow/intake-report.md`. A Codex reviewer checks each claim against its source.
  - The intake report proposes diffs for seven conflicts and out-of-date statements in `AGENTS.md` and `CONTRIBUTING.md`. A worker applies them after the user approves them.
  - The user confirmed that development happens on WSL2, not on a Proxmox VM. Item 7 of #66 corrects `AGENTS.md`.

## 2026-10-28 — Protect `main` with a ruleset

- Kind: repository settings
- Source: message `ec24ff76-2699-4ed7-868a-f5362768e259` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: none. No batch applies.
- Consequences:
  - The ruleset `main protection` (ID 26058057) is active on the default branch. It requires a pull request and the status check `build-test`, allows squash merges only, and blocks force pushes and branch deletion.
  - It has no bypass actors, so Mainspring can prove that no merge bypasses the rules. It requires no approving review, because the user approves merges in T3. "Require branches to be up to date" is off, because each rebase needs a new review.
  - The repository allows squash merges only, and deletes head branches after a merge.

## 2026-10-28 — Fix the `measureChatTurn` timeout before #68 merges

- Kind: batch
- Source: message `8dbc29f7-ac84-430a-b4f7-c866ae91289b` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:b69d0730ef21fa64e12c7da0c67ac915d6c2b42204334cc3a1582b774d961a5f`
- Consequences:
  - The batch `fix-measure-test` has one task: #69. The user did not approve the optional addition of #52.
  - A worker (`claude-sonnet-5-5`, effort high) moved the scratch database of `measureChatTurn.test.ts` into `beforeAll`. A Codex reviewer checks the change.
  - #68 waits for this fix. After the merge, the orchestrator verifies #68 against the new base. The head of #68 stays the same, so it needs no new review.

## 2026-10-28 — Record the board setup as the batch `board-setup`

- Kind: batch
- Source: message `c1f48cfa-8c1a-4b1d-8678-7184c8a05a3d` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:127053f3b51f57433df6dd3ea87410144a30d71856bc7e8947c59b09cb382e44`
- Consequences:
  - The batch has one task: #63. The user approved this scope in the cited message. The orchestrator recorded the batch after the work, because Mainspring dispatches a review only for a task in a recorded batch.
  - A Codex review approved PR #64 at `650502b` with no findings.

## 2026-10-28 — Approve the seven instruction changes as they are

- Kind: scope
- Source: message `3d2784bd-a167-42e8-8a5c-d5927a802d42` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:ef4310d43fc6c708e76d1788fd256e4be07948aadb061c313cdb52cfb3d318a3` (batch `adopt-mainspring`)
- Consequences:
  - A worker applied the proposed diffs of `docs/workflow/intake-report.md` to `AGENTS.md` and `CONTRIBUTING.md` without a change. All 81 changed lines match the approved block.
  - The managed block of `AGENTS.md` and `CLAUDE.md` did not change.

## 2026-10-28 — Give #66 no parent issue

- Kind: drift exception
- Source: message `3d2784bd-a167-42e8-8a5c-d5927a802d42` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: none. No batch applies.
- Consequences: the batch `adopt-mainspring` has only one task. `mainspring audit github --accept github.issue.no-parent 66` records the exception.

## 2026-10-28 — Keep the bridge receiver test in `verification`

- Kind: configuration
- Source: message `3d2784bd-a167-42e8-8a5c-d5927a802d42` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: none. No batch applies.
- Consequences: `cd integrations/foreman-bridge/receiver && npm test` stays in the `verification` list of `.mainspring/config.json`. It adds about 61 s to each verification run. CI already runs it.

## 2026-10-28 — Merge PR #64

- Kind: merge
- Source: message `3d2784bd-a167-42e8-8a5c-d5927a802d42` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:127053f3b51f57433df6dd3ea87410144a30d71856bc7e8947c59b09cb382e44` (batch `board-setup`)
- Consequences: `mainspring merge-execute` squash-merged head `650502b` onto base `e8a76b7` as `8a6b9a5`. #63 closed.

## 2026-10-28 — Merge PR #70

- Kind: merge
- Source: message `17153050-e98d-43fd-98fa-e86830257680` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:b69d0730ef21fa64e12c7da0c67ac915d6c2b42204334cc3a1582b774d961a5f` (batch `fix-measure-test`)
- Consequences:
  - `mainspring merge-execute` squash-merged head `464cbb4` onto base `8a6b9a5` as `a3e5f8c`. #69 closed.
  - #70 and #68 both appended entries to this record, so #68 had a conflict. The orchestrator rebased #68 onto `a3e5f8c` and kept the entries of `main` unchanged before those of #68. The new head of #68 needs a new review round, contrary to the expectation in the `fix-measure-test` entry.

## 2026-10-28 — Give #69 no parent issue

- Kind: drift exception
- Source: message `17153050-e98d-43fd-98fa-e86830257680` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: none. No batch applies.
- Consequences: the batch `fix-measure-test` has only one task. #69 closed when #70 merged, so the audit no longer reports the drift, and no exception was necessary.

## 2026-10-28 — Merge PR #68

- Kind: merge
- Source: message `24f5bd4a-438a-4f66-8df1-3dbe42b70d37` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:ef4310d43fc6c708e76d1788fd256e4be07948aadb061c313cdb52cfb3d318a3` (batch `adopt-mainspring`)
- Consequences: `mainspring merge-execute` squash-merged head `d69e801` onto base `a3e5f8c` as `70908d3`. #66 closed. The Mainspring adoption is complete.

## 2026-10-28 — Run the batch `first-work`

- Kind: batch
- Source: message `c95e6a90-06e2-4895-98a6-942ca7d66554` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:aecda1615e5e0b3bc48472cd1777279e2856498ef4f707caafb13d2db7144ef6`
- Consequences:
  - The batch has four tasks: #52 (the planning step only), #33, #35, and task 1 of #65 (the save backup).
  - Mainspring blocks a substantial task until its batch names a user-approved plan. So the batch records #52 as a planning task. After the user approves the plan, the orchestrator records #52 again as substantial, with the plan digest.
  - Nothing runs on the test server for #65 until the user approves that step.

## 2026-10-28 — Merge PR #71 and PR #72

- Kind: merge
- Source: message `02b993e9-12b2-4c02-9a0b-5a414d9dcbda` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:aecda1615e5e0b3bc48472cd1777279e2856498ef4f707caafb13d2db7144ef6` (batch `first-work`)
- Consequences:
  - `mainspring merge-execute` squash-merged #71 (head `ba39f9e`, base `70908d3`) as `c59c10c`. #33 closed.
  - Then it squash-merged #72 (head `966a211`) as `519527e`. #35 closed. A clean-clone verification passed at `966a211` on `70908d3`, and again with `966a211` merged onto `c59c10c`. The merge gate compared against the PR base that GitHub reported (`70908d3`).
  - The minor review finding on #72 (a README sentence over the STE limit) is deferred to #35.

## 2026-10-28 — Approve the #52 plan

- Kind: plan
- Source: message `02b993e9-12b2-4c02-9a0b-5a414d9dcbda` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:f97b31a3edb99dbbee609ffb0c1d835aba13d4afddef5826802f3b074f8a7f8b` (batch `first-work-52-impl`); plan digest `sha256:b704429874068cfd2dfa7d73678125b42d32f05a1aef72ce234753015db1146b`
- Consequences:
  - The plan `docs/superpowers/plans/2026-10-28-save-path-isolation.md` at `8e86df9` is approved with decision 1(a): with no save attached, ff-server drops the model's `savePath`, and sf-mcp serves its default store.
  - Decision 2(a): #52 does not make sf-mcp serve only host-vouched paths. The orchestrator filed #74 about the unauthenticated sf-mcp port in the Compose setup.
  - The batch `first-work-52-impl` records #52 as substantial with the plan digest, so the implementation could start.

## 2026-10-28 — Repair the #73 save backup with method A

- Kind: design
- Source: message `02b993e9-12b2-4c02-9a0b-5a414d9dcbda` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: `sha256:aecda1615e5e0b3bc48472cd1777279e2856498ef4f707caafb13d2db7144ef6` (batch `first-work`)
- Consequences:
  - The backup validates each save with `@etothepii/satisfactory-file-parser` 4.1.2, pinned under `/opt/gaffer-testbed/`, before it accepts a copy. A save that does not parse completely makes no archive.
  - The worker may copy one save from the test server to a temporary directory for tests. The copy is never committed.

## 2026-10-28 — Give #33, #35, #52 and #65 no parent issue

- Kind: drift exception
- Source: message `02b993e9-12b2-4c02-9a0b-5a414d9dcbda` in T3 thread `a5abedc2-2239-4eb7-8304-2dbe3aed5f02`
- Message author (T3 `createdBy`): user
- Scope digest: none. No batch applies.
- Consequences: `mainspring audit github --accept github.issue.no-parent` records the exception for #35, #52 and #65. #33 closed before the exception was necessary.
