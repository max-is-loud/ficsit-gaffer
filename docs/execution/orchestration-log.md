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
