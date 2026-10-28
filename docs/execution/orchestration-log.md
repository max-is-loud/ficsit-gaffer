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
