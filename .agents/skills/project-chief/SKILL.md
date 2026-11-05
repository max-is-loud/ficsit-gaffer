---
name: project-chief
description: Use when you are the Mainspring project orchestrator (the user's chief of staff) for this repository. Use it when the user starts or continues a project, proposes or approves a batch of issues, asks where the project is, or approves a merge. Use it also when a T3 worker or reviewer completes, asks a question, hits a provider limit, or receives guidance from the user.
---

# Project chief

Your role: project orchestrator. Read `agents/orchestrator.md` and `AGENTS.md` first. They hold your duties and the shared rules. This skill gives the recipes that put them into operation. It does not repeat them.

## Toolkit commands

- Run each command as `mainspring <command>`. Give `--repo <path of this repository>`.
- A command reads one JSON object on stdin and writes one JSON object on stdout. To give the JSON in a file, add `--input <path>`. Use a file for JSON with non-ASCII text.
- Exit codes: 0 success, 2 invalid input, 3 policy blocked, 4 reconcile first. On exit 4, stop and reconcile before you dispatch.
- If `.mainspring/config.json` names `github.account`, the toolkit uses that account for its own GitHub calls. For your own `gh` and `git` network calls, use the token of the same account. The runbooks give examples.
- Never switch the active `gh` account: `gh auth switch` changes it for every session on the machine. Never store a token.
- Use only the T3 tools and fields that this skill names or that the T3 tool schemas show. Do not invent a tool or a field. For reference only, the T3 capabilities record of the toolkit repository gives the checked tool shapes.

## Start or replace a session

Use these steps when you start, when you resume after a pause, and when you replace a coordinator.

1. Run `status`. Read the active, queued, parked, stale, and unresolved intents. If `version_mismatch` is `true`, report it under "Needs you". Use "Update the installed workflow".
2. Read the session ID of your own session with the shell: `echo "$CLAUDE_CODE_SESSION_ID"`. A subagent has the value of its parent. Then run `coordinator-claim` with `{"coordinator": "<your T3 thread id>", "provider_session": "<CLAUDE_CODE_SESSION_ID>"}`. Exit 3 means that another coordinator owns the journal.
   - The session log then marks your session as the orchestrator, so that the briefing does not count it as a plain session. The output field `provider_session_marked` tells whether the mark worked.
   - If the value is empty, or if your session is not a Claude Code session, give `coordinator` only. The claim works as before, and the briefing counts your session as plain.
3. To replace a coordinator, read each bound worker with `t3_thread_read`. `task_status` reads only the tasks of the calling thread. Then run `coordinator-takeover` with `{"coordinator", "observations"}`. Give each observation the `thread_read` fields (see "Wait and handle a completion").

   A queued run keeps the slot. After `task_cancel`, a user turn can stay in a held queue, and `t3_thread_read` does not show the hold. If an observation records `running` only because of a `queued` status, and `activeRunId` is null, do these steps:
   1. Read the queue of that thread with `t3_queue_list`.
   2. Report each queued turn to the user under "Needs you". Ask the user to run it or to cancel it. Do not cancel a turn without the user's decision.
   3. To cancel a turn, run `t3_queue_cancel` with its `queuedRunId`. Then read the thread again with `t3_thread_read`, and record the observation. T3 sets the cancelled run to `cancelled`, and it stays the latest run. When no queued turn stays, the observation releases the slot.
   4. If the user chooses to run the turn, the run becomes active and keeps the slot. When it ends, the normal rule releases the slot.
4. After a change to `.mainspring/config.json`, run `config-apply` with `{}`. A file has no effect before this step.

## Brownfield intake

Use this recipe to adopt the workflow in an existing repository. Items 2 and 4 come before any dispatch.

If the user ran `mainspring init`, the user approved the install, and `init` wrote it. If the user did not commit the files, ask the user to commit them first. Then ask only for the adoption issue and the batch. Skip items 1 and 3.

1. Run `doctor`. If `ok` is `false`, use "Install a missing tool". Then run `install --dry-run`. Show the change list to the user.
2. Get one user approval that covers three things:
   - the install
   - the creation of one adoption issue, "Adopt Mainspring"
   - an adoption batch with that issue only

   Record the message provenance: the T3 message ID and `createdBy: user`. The batch record pins this scope with its digest.
3. Apply the install on a new branch in an isolated worktree. Commit the installed files.
4. Prepare the journal before any dispatch, in this order:
   1. `config-apply` with `{}`
   2. `coordinator-claim`
   3. `issue-ensure` for the adoption issue
   4. `batch-record` with the adoption batch and the user approval from item 2
5. Dispatch one intake worker through `dispatch-prepare` and `dispatch-bind`. The brief names the `repo-intake` skill. It gives the base SHA, the open issues as JSON, and the board fields. Read the issues and the fields yourself with `gh`. The worker makes no GitHub call.
6. When the worker completes, run each verification command again yourself with `verify`. Give `{"commit": "<base sha>", "commands": [...]}` with the commands of the intake report. Compare the results with the intake report. Run `secret-scan` on the drafts.
7. Dispatch a Codex review that checks each claim of the drafts against its source.
8. Present one adoption PR (the install and the intake) for user approval. If the board lacks the workflow fields, present the field proposal from `project-sync` for user authorization.
9. After the merge, propose the first real batch from the intake report.

## Install a missing tool

Use this recipe when `doctor` gives `ok: false`, or `install` gives `tools_missing`. The CLI never installs a tool, and it never asks the user.

1. Show the user each tool whose `state` is not `present`: its `tool`, `need`, `reason`, `state`, `version`, and `minimum`.
2. Show the `install` argv of each tool. If `install` is `null`, show the `note`.
3. Ask the user to approve the install commands. Wait for the user's own message.
4. After the approval only, run each approved command.
5. Run `doctor` again. Continue only when `ok` is `true`. A missing `optional` tool does not stop the install.

## Update the installed workflow

Use this recipe when `status` gives `version_mismatch: true`. The repository then has files from a different toolkit version. Each repository takes a toolkit update through its own PR.

1. Compare `installed_version` (the repository) with `toolkit_version` (the command).
   - If the repository has the later version, do not install. Ask the user to update the command on this machine. The runbooks give the command.
   - Otherwise, report the two versions under "Needs you", and offer an update batch.
2. Propose the batch with one issue, "Update Mainspring to <toolkit_version>". Wait for the user's approval in the user's own message.
3. Run `issue-ensure` for the update issue. Then run `batch-record` with the batch and the user approval.
4. Run `install --dry-run` with `{}`. The installer keeps the existing configuration file. Show the change list to the user. Resolve each `conflict` first.
5. Run `install --apply` with `{}` on a new branch in an isolated worktree. Commit the changed files.
6. Fetch the base branch. Run `verify` with `{"head": "<new commit sha>", "base": "<live tip of the base branch>", "record": true}`. It runs the `verification` list of the configuration in the merged tree. Keep the `verification_id` for the review brief and the merge.
7. Open the PR. Dispatch a review (see "Dispatch a worker or a reviewer").
8. Ask the user to approve the merge. Follow "Merge".

### Upgrade from t3-workflow 0.3.x

Use these steps for a repository with an install of `t3-workflow` 0.3.x or earlier. `status` then gives `legacy.state_dir: true`, because the repository has the directory `.t3-workflow/`. Use them also when the user asks for the upgrade.

1. Ask the user to do the "Upgrade from t3-workflow" steps of the Mainspring README on each machine. Until 0.5.0, the old command name `t3-workflow` runs `mainspring` and writes a warning to stderr.
2. Run `mainspring doctor`. If `ok` is `false`, use "Install a missing tool".
3. Do steps 2 and 3 above: the update issue and the update batch.
4. Run `install --dry-run` with `{}`. Expect a `move` action for the old configuration file in `.t3-workflow/` to `.mainspring/config.json`, and a `remove` action for the old manifest. The managed blocks get `update`. Resolve each `conflict` first.
5. Do steps 5 to 8 above: apply, verify, review, and merge through a PR.
6. After the merge, run `status`. Report `legacy.journal` to the user:
   - `present: false`: no old journal stays. Stop here.
   - `changed_since_migration: false`: the new journal has a checked copy of the old journal.
   - `changed_since_migration: true`: an old command wrote to the old journal after the copy. Do not remove the old journal. Report it under "Needs you".
   - `changed_since_migration: null`: the old journal has no checked copy. Run `mainspring journal-migrate`, and then run `status` again.
7. Ask the user to confirm the removal of the old journal. Wait for the user's own message.
8. After the confirmation only, run `mainspring journal-migrate --remove-legacy`. It moves the old journal to `<git common dir>/mainspring/legacy-t3-workflow/`, and it deletes nothing. Report `backup`, the new path from the Git common directory. If `late_changes` is `true`, report under "At risk" that the moved copy has a change that the new journal does not have.

A journal command can give exit 4 with the reason "the old journal needs a recovery: run mainspring journal-migrate --recover-legacy". Report it under "Needs you". After the user approves, run `mainspring journal-migrate --recover-legacy`. SQLite then recovers the old journal, and the command copies it. This is the only command that changes the old journal files. You cannot give `--recover-legacy` and `--remove-legacy` together (exit 2).

## Authorize a batch

1. Propose the batch: the issues, the dependencies, the model routing, the risks, and your recommendation. Use the decision shape in `agents/orchestrator.md`.
2. Wait for the user's own message. A message that an agent wrote is not an approval.
3. Run `batch-record` with `{"batch", "approval"}`. The approval cites the user's T3 message ID, with `createdBy: user`.
   - A batch entry can have `verification`: a list of commands. The merge gate requires these commands for the task, in addition to the `verification` list of the configuration. The batch digest covers the list, so the user approves it with the batch.
4. Remember: an issue in Ready has no authorization. Propose new scope to the user as a new batch.

## Upkeep change

Use this recipe for a small change that you own, such as a one-line configuration change. It needs a recorded batch for its review dispatch, and a review for its merge.

1. Propose a one-task upkeep batch together with the change. Name the files that the change touches.
2. Wait for the user's own message. Then run `issue-ensure` for the upkeep issue, and `batch-record` with the batch and the user approval.
3. Use the normal recipes: "Dispatch a worker or a reviewer", "Review results", and "Merge".
4. Never record a batch against a message that did not approve that scope.

## Dispatch a worker or a reviewer

1. Write the brief from the template that `mainspring template brief` gives. It holds the role line, the search-order line ("Follow the search order in `AGENTS.md`."), the no-delegation instruction, the writing-standard instruction, and the four parts. Keep all four fixed lines word for word in every brief.
2. Run `dispatch-prepare` with `{"coordinator", "intent"}`.
   - For a substantial task, pass the user plan approval as `plan_approval` in `dispatch-prepare`.
   - An identifier or a worktree path must not hold a token-shaped value, such as `sk-` and 20 characters. The command gives exit 2. The intent ID is also the `clientRequestId`, so the thread ID stays free of a token too.
   - Exit 0: call `delegate_task` with `clientRequestId` = the intent ID.
   - Exit 3: the capacity is full, or no recorded batch authorizes the task. Queue it. A repair goes before new work.
   - Exit 4: an earlier dispatch has an unknown outcome. Find the thread by `clientRequestId` and bind it. Do not dispatch again.
3. Check that the `delegate_task` response echoes the provider, the model, and the options that you sent.
4. Read `thread.worktreePath` with `t3_thread_read`. Run `dispatch-bind` with `{"intent_id", "session_id": "<childThreadId>", "worktree", "commit_sha"}`. Never use the branch name.
5. Give the user a link to the worker: `[<title>](t3-thread://v1/<childThreadId>)`.
6. If `delegate_task` failed and T3 shows no thread for that `clientRequestId`, run `dispatch-abort` with `{"coordinator", "intent_id"}`.

A reviewer is a Codex model in `runtimeMode: "auto"`. Start each review round with a new `delegate_task` and a new `clientRequestId`.

The reviewer has no network. Before you dispatch a review, run the full verification yourself:

1. Fetch the PR head and the base branch.
2. Run `verify` with `{"head": "<PR head SHA>", "base": "<live tip of the base branch>", "record": true}`.
3. Put the `verification_id` and its results in the review brief. Give the head, the base, each command, its exit code, and its result.
4. Run `docs check --head <PR head SHA>`. Put the `docs.coverage-link` findings in the review brief: each document and its changed paths.

The reviewer then runs targeted probes only. At the merge, use the same `verification_id` if the base did not move. If the base moved, run `verify` again, and use the new ID.

## Wait and handle a completion

1. To wait, end your turn. T3 wakes you when a child completes, asks a question, or finishes a turn that the user started. Do not poll and do not sleep.
2. A read of a terminal result acknowledges it. Act on the result in the same turn.
3. Read the worker with `t3_thread_read`. Run `reconcile` with `{"observations": [{"intent_id", "session_id", "thread_read": {...}}]}`. Give one source in each observation:
   - From `t3_thread_read`: `"thread_read": {"thread": {"status", "activeRunId"}, "recentRuns": [{"status"}, ...]}`. Copy `thread.status`, `thread.activeRunId`, and the `status` of each `recentRuns` entry without change. Only this source can end an intent.
   - From `task_status`, only for a running task: `"task_status": {"status", "hasPendingChildRuns", "workState"}`. A terminal status gives exit 2, because `task_status` does not show a user turn in a held queue.
   - Use `"status"` only for a status that you record yourself: `limited`, `parked`, `unknown`, or `running` after a resume.

   The toolkit translates the native values. A terminal thread status ends the intent only when no run is active or queued. All other native values record `running`. A value outside the native contract gives exit 2. If the observation records `running` only because of a queued turn, use the release path in "Start or replace a session", step 3.
4. Run the worker's checks again yourself. Then dispatch the review, or report to the user.
5. Answer a blocking question with `t3_pending_request_read` and `t3_pending_request_respond`.

## Review results

- A finding blocks only when its severity is `critical` or `important` and its disposition is `open`.
- Stop at the first approval. Defer a non-blocking finding to the issue of the task that owns the code.
- After two failed repair rounds, escalate to the user with the evidence and a recommendation.

## Dispatch a repair to the worker thread

Use this recipe to send a repair to the thread of the worker that did the task. The repair needs no new thread.

1. Run `dispatch-prepare` with `{"coordinator", "intent"}` for the repair. Handle the exit codes as in "Dispatch a worker or a reviewer".
2. Send the repair brief with `t3_thread_send` to the thread of the worker.
3. Run `dispatch-bind` with `{"intent_id", "session_id": "<the thread ID of the worker>", "worktree", "commit_sha"}`. Give the existing thread, its worktree, and its head.
4. If the send fails on a provider limit, record `limited`, then `parked`, with `reconcile` and the thread ID of the worker. A bind is not necessary. Then follow "Park and resume at a provider limit".

## Park and resume at a provider limit

1. Record `limited`, then `parked`, with `reconcile`. Give the thread ID of the dispatch that hit the limit: the worker or the reviewer. If the intent has no bound session, the first observation records the session, so a bind is not necessary. The slot becomes free.
2. When the limit resets, run `dispatch-resume` with `{"coordinator", "intent_id"}`. Exit 3 means that the intent stays parked: the capacity is full or the batch changed.
3. On exit 0, read `attempt` from the output. Send the follow-up with `t3_thread_send` to the same thread.
4. Record `running` with `"attempt": <n>` from the resume output.
5. Put `"attempt": <n>` in every later observation of that intent. An observation without `attempt` names attempt 1 and gives exit 4.

## User guidance to a worker

1. Read the worker timeline with `t3_thread_read`. Find the `createdBy: user` messages.
2. Run `guidance-record` with `{"task", "source", "text"}`. A different `scope_digest` marks the guidance as scope-changing. Bring that change to the user.
3. After you relay guidance to a stale worker, run `guidance-ack` with `{"intent_id", "revision"}` for each relayed revision.

## Merge

### Record each review round

1. After each review round, run `review-record` with `{"task", "head_sha", "findings"}`. Give the findings in the `Finding` format of the `independent-review` skill. Each finding names the reviewed `head_sha`.
2. A finding blocks if and only if its severity is `critical` or `important` and its disposition is `open`.
3. Give a finding without a concrete failure or evidence the disposition `rejected` or `deferred`. Only a non-open finding can have placeholder text, such as "none" or "n/a". Otherwise the command gives exit 2.
4. Read `review` in the output. A record for the same head replaces the findings of that round, and a new head starts a new round. A different record for an older head gives exit 4 and changes nothing. On `escalate: true`, escalate to the user.

### Check readiness

1. Get a `verification_id` for the pull request head on the live tip of the base branch:
   - Use the ID of the review brief if the head and the base did not move.
   - Otherwise, fetch, and run `verify` with `{"head": "<PR head SHA>", "base": "<live tip of the base branch>", "record": true}`.
2. Run `merge-check` with `{"task", "pr", "approval", "verification_id", "required_checks"}`:
   - `verification_id` is the ID that `verify` gave. The gate reads the record from the journal.
   - `required_checks` is optional. It holds the GitHub check names that must pass, in addition to the checks that GitHub marks required.
   - `approval` is the user's merge approval, or `null` before the user approves.
   - An unknown `verification_id` gives exit 2. The `verification` object of 0.4.36 and earlier also gives exit 2.
3. Read the result. Exit 3 with `state: "blocked"` lists every blocker in `reason`. Exit 0 with `state: "approved"` means ready, and it needs a user approval for this head. Exit 0 with `queued` or `merged` reports an earlier merge.
   - `merge-check` evaluates the same gates as `merge-execute`, and it sends nothing. If a gate refuses, `error` names it: `merge_bypass_possible`, `merge_policy_blocked`, or `merge_not_open`. Its reason follows the other blockers.
   - Exit 4 with `reconciliation_required` means that user guidance changed the scope of the task. Record the user-approved scope before the merge, as for `dispatch-prepare`.
4. Before the user approves, the reason always has "no user merge approval". Present the pull request only when that is the one blocker.
5. Present the head SHA, the base SHA, the checks, and the review result to the user. Use `brief --view completion` with a `decision`.

### Merge after the user approves

1. If the pull request is a draft, mark it ready first: `gh pr ready <number>`. GitHub refuses to merge a draft. The revision does not change.
2. Read the user's approval message with `t3_thread_read`. Write the approval record:

   ```json
   {"kind": "merge", "source_session": "<your orchestrator thread UUID>",
    "source_message": "<T3 message ID of the user's approval>", "scope_digest": "<scope digest of the batch>",
    "head_sha": "<approved head>", "base_sha": "<presented base>", "source_author": "user"}
   ```

   Copy `source_author` from the `createdBy` value of that message. Never write `"user"` for a message that an agent wrote.
3. Run `merge-execute` with `{"task", "pr", "approval", "verification_id", "required_checks", "method"}`. This is the `merge-check` input plus `"method"`: `merge`, `squash`, or `rebase`. Use `merge.method` from `.mainspring/config.json`. The final decision reads the verification record from the journal again.
4. Act on the result:

| Exit | Result | Next action |
| --- | --- | --- |
| 0 | `merged`, `closeout_allowed: true` | Close out the issue and the Project item. Only this result allows closeout. |
| 0 | `queued` | The pull request is in the merge queue. It is not merged. Do not close out. Run `merge-check` later. |
| 2 | `invalid_input` | Correct the input. Nothing was sent. |
| 3 | `merge_not_ready`, `merge_changed`, `merge_bypass_possible`, `merge_policy_blocked`, `merge_head_changed`, `merge_not_open`, or `state: "blocked"` | Nothing was sent. Run `merge-check` again, and present the current state to the user. |
| 4 | `reconciliation_required` | User guidance changed the scope of the task. Nothing was sent. Record the user-approved scope, and then run `merge-check` again. |
| 4 | `github_head_changed` | The head changed during a page read. Nothing was sent. Read again. A new commit needs a new approval. |
| 4 | `merge_unconfirmed` | The result is not known. Do not close out. Run `merge-execute` again: it reads back before it sends. |
| 4 | `merge_rejected` | GitHub rejected the merge, and a readback shows no merge. Read the pull request before you decide. |
| 4 | another `github_*` error | Read the pull request again before any retry. |

### Merge rules

- The gate compares the `base` of the verification record with the live tip of the base branch (`baseRef.target.oid`). It does not use `baseRefOid`, because GitHub does not update it when the base branch moves. `snapshot.base_sha` in the output is that tip.
- A base change needs a new `verify` run with `"record": true`, and a new `verification_id`. The approval stays valid while the head stays the same.
- Only a record of `verify` in integration mode (`head` and `base`) can pass. A commit-mode record has no base, and it blocks.
- The required commands are the `configured` list of the record and the `verification` list of the batch entry of the task. The `configured` list is the `verification` list of `.mainspring/config.json` in the merged tree. Each required command must have the result `verified` in the record. The match is exact, also for spaces.
- If the required set is empty, the gate blocks. A new install has an empty `verification` list. Set the list in `.mainspring/config.json` before the first merge.
- Known limit: `mergePullRequest` has no expected base OID. If the base branch moves after the final read, GitHub merges onto the new tip, and no verification covers it.
- A new commit always needs a new review round and a new user approval.
- The code never uses an administrative bypass. With a merge queue, it enqueues the pull request.
- A direct merge needs proof that the actor cannot bypass the rules of the base branch. Without that proof, the result is `merge_bypass_possible`.
  - An `ADMIN` actor merges on a branch with no rules.
  - A viewer without `ADMIN` that sees no rule gets `merge_bypass_possible`, because it cannot prove that no rule applies.
  - To continue, merge through the merge queue, or with an actor that cannot bypass the rules.

## Audit the GitHub drift

The command `audit github` compares the issues, the pull requests, and the Project board. It fixes a board status or adds a missing issue to the board when the fix has one correct answer. It only proposes every other change. It reads no stdin. Give `--repo`.

### When to run it

Run `audit github`:

1. before each briefing (`reentry` and `completion`)
2. after each step change of a task: a dispatch, an opened pull request, a review result, and a merge
3. when the user asks

Keep your own `project-sync` calls at step changes. The audit catches what they miss. To show the user what a real run would do, run `audit github --dry-run`. A dry run fixes and records nothing.

### Read the result

- Exit 0: read `state`. It is `clean`, `fixed`, or `needs_you`.
- Exit 2: the configuration is invalid (`error: "config_invalid"`). Show `reason` to the user.
- Exit 4: the audit is `unavailable`. Read `error` and `reason`. The causes are an unreadable journal, drift log, or GitHub read. The audit applied no fix, with one exception below.
- The lists are `fixed`, `proposed`, and `failed`. Each entry has `rule`, `subject` (the issue or PR number), `text`, and `action`.
- If `limit_reached` is `true`, the audit found more than 20 automatic fixes. It applied none and listed them under `proposed`. Tell the user. A sudden mass of fixes is more likely a fault than real drift.
- A real audit holds the write lock of the drift log during its fixes. A second audit or an `--accept` waits up to 2 seconds, then gives exit 4. Run it again.
- If exit 4 gives `error: "drift_log_unavailable"` and a non-empty `fixed` list, the fixes are on GitHub, but the drift log has no record of them. The briefing does not show them. Report each fix of the `fixed` list in your reply. This is a known limit (issue #129).

### The reply rule

When an audit fixed or proposed something, your reply to the user says three things about each item or group of items. It says what drifted, why it is drift, and what the module did or proposes. Do not hide a fix. Bring all open proposals of one audit to the user as one decision under "Needs you".

### Apply an approved proposal

The module never applies a proposal. After the user approves one, apply it with an existing tool. The next audit confirms the result.

| Rule | Approved action |
| --- | --- |
| `github.board.done-but-open` | To close the issue, run `gh issue close <number>`. To move it back, run `project-sync` with the stage `In progress`. |
| `github.issue.merged-but-open` | Run `gh issue close <number>`. |
| `github.pr.no-issue` | Link the issue that the PR does. Add a closing keyword and the issue number to the PR text with `gh pr edit <number>`. A `#N` reference alone also ends the drift. |
| `github.issue.no-parent` | Set the parent that the proposal names, or the parent that the user chooses, with the GraphQL mutation `addSubIssue`. See "Set a parent issue" below. |
| `github.board.stalled` | To move the task, run `project-sync` with the stage `Ready`. |

For `project-sync`, give the current value of the "Blocked" field as `blocked`. Never change it by chance. Use `gh` with the token of the account in `github.account`.

#### Set a parent issue

The mutation needs the GraphQL node IDs of both issues, not their numbers.

1. Get the node ID of the parent issue. Do the same for the child issue (the issue of the proposal):

   ```bash
   gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){ repository(owner:$o, name:$r) { issue(number:$n) { id } } }' \
     -f o=<owner> -f r=<repo> -F n=<issue number> --jq .data.repository.issue.id
   ```

2. Add the child to the parent:

   ```bash
   gh api graphql -f query='mutation($p:ID!,$c:ID!){ addSubIssue(input:{issueId:$p, subIssueId:$c}) { subIssue { number } } }' \
     -f p=<parent node ID> -f c=<child node ID> --jq .data.addSubIssue.subIssue.number
   ```

   The output is the number of the child issue.

### Record an answer that keeps the state

Sometimes the user decides that the state is right. Examples: "this PR needs no issue", "keep this issue open", "it waits for #N". Record the answer:

`mainspring audit github --accept <rule ID> <number> --source <message ID>`

- Use the T3 message ID of the user's answer as `--source`.
- If the audit does not find the drift now, the command gives exit 2 and records nothing.
- An acceptance ends when a later complete audit does not find the same rule, number, and state again. The rule then applies again. Each rule compares only its own state fields:

  | Rule | State fields |
  | --- | --- |
  | `github.board.done-but-open` | The issue state, the status, and the linked PRs with their states |
  | `github.issue.merged-but-open` | The issue state, and the linked PRs with their states |
  | `github.pr.no-issue` | None: a link, a `#N` reference, or a close of the PR ends the drift |
  | `github.issue.no-parent` | The issue state and the batch. A new linked PR does not end it. A parent or a close ends the drift. |
  | `github.board.stalled` | The issue state, the status, and the time of the last journal change of the task |

- The briefing does not count an accepted item.

### Limits to know

- `github.issue.no-parent` proposes a specific parent only when each other task of the same batch is on the board and has that same parent. Otherwise it asks which parent.
- It does not see an open batch task that is not on the board (issue #128). With `auto_fix` on, the same audit adds the issue to the board, and the next audit proposes the parent.
- With `"github_drift": {"auto_fix": false}` in the configuration, every fix becomes a proposal.

## Take the metric snapshots

The command `metrics snapshot [--backfill DAYS]` records the size, the complexity, the hotspots, and the code graph of a commit of `main`. The briefings read these records for the health section, the architecture section, and the Graph row. The command reads no stdin. Give `--repo`. It never changes the repository, the journal, or GitHub.

### When to run it

Run `metrics snapshot`:

1. after each merge to `main`
2. before each briefing (`reentry` and `completion`), when the tip of `main` has no snapshot
3. once with `--backfill 30`, after an upgrade of the command

With `--backfill DAYS` (1 to 90), the command also takes the snapshot of each first-parent commit of `main` in the last DAYS days. A commit that has a complete snapshot runs no tool again. One exception: when `graph/` is absent or holds the graph output of another commit, the tip runs both tools again to publish it. One snapshot takes about 3 seconds on this repository, and `--backfill 2` (25 snapshots) took 56 seconds. A snapshot hook does not exist. A hook is too slow for the 10-second limit of the `SessionStart` hook.

### Read the result

- Exit 0: read `snapshots`, one entry for each commit, oldest first. The tip of `main` is the last entry.
  - `result` is `recorded`, `completed`, `already recorded`, or `not recorded`.
  - `size` and `graph` are `ok`, or the reason that the part is unavailable.
  - Only the entry of the tip has `graph_output`: `published`, `unchanged`, `not the tip of main`, `the graph part is unavailable`, or `the graph output cannot be saved`.
- Exit 2: an argument is invalid, for example `--backfill` is not a number from 1 to 90.
- Exit 4: read `error` and `reason`. `metrics_unavailable` means that Git cannot read the commits, or that both parts of the snapshot of the tip are unavailable. Then the command records nothing for the tip. `metrics_log_unavailable` means that the metrics log is busy or has an unknown version. Run the command again. If the log has an unknown version, upgrade the command.

### Know the limits

- The tools `scc` and `graphify` are optional (`doctor` reports them). Without a tool, its part is unavailable with a reason, and the command records the other part. A later run completes the part after the install. The tested versions are `scc` 4.1.0 and graphify 0.9.94.
- Only the tip of `main` keeps the graph output in `<git common dir>/mainspring/graph/`. An older run that is no longer the tip does not replace the graph output of the new tip.
- If the command cannot save the graph output, the snapshot keeps both parts. The entry of the tip says `the graph output cannot be saved`, and the exit code stays 0.
- A process kill during the publication of the graph output can leave `graph/` absent, or newer than the latest snapshot. This is a known limit (issue #145). The next snapshot with the tools repairs it. The metrics log stays correct.
- The briefing uses only the snapshots of commits in the first-parent history of `main`. After `main` moves back to an older commit, it uses the latest snapshot in that history. With no snapshot in that history, each part says "No metric snapshot is in the history of main. Run mainspring metrics snapshot."
- If the Graph row is "Stale", run `metrics snapshot`, then make the briefing again.

## Check the agent tools

The agent tools module gives each Claude Code session the setup of the benchmark arm H. It has the Serena and graphify servers, a graph summary at the start, and a redirect of a symbol search. The benchmark had 60 runs: 15 runs for each arm, with 150 possible points for each arm. It scored H 141.75, G (instructions and servers, no hooks) 135.75, S (instructions only) 127.25, and C (control) 128.0. H costs about 2.1 times the input tokens of C. The round 2 report of the code-graph benchmark is in the Mainspring repository.

### The parts

| Part | Where | What it does |
| --- | --- | --- |
| The search order | The shared rules in `AGENTS.md`, and the brief line | Tells the agent which tool to use for each kind of question |
| The servers | `.mcp.json` (`serena`, `graphify`) and `.claude/settings.json` (`enabledMcpjsonServers`, `permissions.allow`, and `permissions.deny` for the three Serena edit tools) | Connect the tools with no prompt in a folder that the user trusts. Serena stays read-only. |
| The graph summary | `SessionStart` of `mainspring hook` | Adds at most 8 KB of the graph report to the context. It adds nothing when no graph exists. |
| The symbol redirect | `PreToolUse` with the matcher `Grep` (a session hooks entry) | Refuses the first Grep call of a session for each symbol-like pattern. The reason names the Serena tools. The hook never reads Bash commands. |
| `mainspring tools graphify-mcp` | The `graphify` server command | Starts graphify on the published graph. With no graph, it ends with exit 1 and `no_graph`. |
| The tool Serena | `doctor` | Reports `serena` as optional. Install: `uv tool install serena-agent`. |

The graph comes from `metrics snapshot`, in `<git common dir>/mainspring/graph/`. Each worktree shares it. After each merge, `metrics snapshot` keeps it current.

### Check a session

1. In a new Claude Code session, run `/mcp`. Expected: `serena` and `graphify` show the state connected, with no approval prompt.
2. Read the start of the context. Expected: a heading with the short commit and the time of the graph, then the graph sections.
3. Search for a symbol with Grep. Expected: one refusal with the reason "For a symbol, use mcp__serena__find_symbol or mcp__serena__find_referencing_symbols. Use Grep for text." A second Grep for the same pattern passes. On macOS, Linux, and WSL, Claude Code 2.1.311 gives the session no Grep tool. There, the check expects no refusal (issue #186).
4. If the servers do not connect in a new worktree, the folder can be untrusted. Ask the user to open the folder once in Claude Code and accept the trust prompt.
5. If `graphify` fails and no summary appears, the repository has no graph. Run `metrics snapshot`.

### Turn a part off

Set the section in `.mainspring/config.json`, then run `config-apply` and `install --apply`:

```json
"agent_tools": {"enabled": true, "session_summary": true, "symbol_redirect": true}
```

- `enabled: false` makes the installer remove the members of `.mcp.json` and `.claude/settings.json`. The hook then gives no summary and no refusal. The search order stays in `AGENTS.md`. `init --no-agent-tools` writes this value.
- `session_summary: false` or `symbol_redirect: false` makes the hook skip that part.
- The `PreToolUse` entry belongs to `session_hooks`. `session_hooks.enabled: false` removes it.
- Do not edit the managed members by hand. The installer restores a member that a user deleted. A changed member is a conflict, and the installer writes nothing in that file.

### Know the limits

- Codex gets the search order only. It gets no servers and no hooks (issue #154).
- A member that a later version of the module drops stays in the file (issue #166).
- A `uv` launcher of the `#!/bin/sh` form gives `no_python` for `tools graphify-mcp`.
- `mainspring hook` gives exit 1 for stdin that is not JSON. Claude Code treats this as non-blocking.
- A new worktree can be untrusted until the user opens it in Claude Code.

## Close a batch or a step

Use this recipe at the end of each batch and each step. The docs freshness module raises a flag when a document may be out of date. A flag only warns. You clear it.

1. Run `docs check --repo <path>`. Read each finding. Start with the `docs.coverage-link` findings, and with the `minor` findings of reviews that reported a wrong document.
2. Decide who clears the flags:
   - If the plan has a documents task, give its worker the list. In a stack, get the list with `docs check --head <top of the stack>`.
   - Otherwise, clear the flags in a PR of the documents. The PR can be the records PR of the batch.
3. Read each flagged document against the code. Then do one of these:
   - Fix the document. A fix in the same PR as the document clears the flag.
   - If the document is still right, record a re-check. Set `checked_at` of the document in `.mainspring/docs.json` to the full SHA of the commit that you read. Give a one-line reason in the PR text.
4. A fix to a document under `toolkit/` changes an installed file. Send it through an upkeep batch and the full gate.
5. Run `docs check` again. Expected: no `docs.coverage-link` finding.
6. Record in the decision record how many flags were fixes and how many were re-checks.

## Set up the document map

Use this recipe for a repository with no `.mainspring/docs.json`. Without the map, `docs check` gives `not_set_up`. This is not a fault.

1. List the Markdown files of the repository with `git ls-files '*.md'`.
2. Write `.mainspring/docs.json`. Read each document that agents follow. Give it the paths of the code that it describes, as `covers`.
   - Use file paths. Use a directory, with a final `/`, only when the document describes the whole directory.
   - Give a dated evidence record an empty `covers`.
   - Put historical records in `ignore`.
   - Put the paths that exist only in an adopting repository in `external_paths`.
   - Do not write a `checked_at` value.
3. For each document, count how many of the last 60 first-parent commits of `main` changed a path of its `covers`. If the count is above 15, narrow `covers`, or write why the document keeps its paths.
4. Run `docs check`. Fix each `docs.map.*` finding. Read the other findings.
5. Put the map in a PR. The rules of that repository say how to review the PR.

## Briefs for the user

| Moment | Command | Output |
| --- | --- | --- |
| The user returns, or asks where the project is | `brief --view reentry` (C) | HTML for `html_render` |
| A task completes, or a pull request is ready | `brief --view completion` (B) | HTML for `html_render` |
| Other updates | `brief --view text` (A), or short text | Text in chat |

1. For `reentry`, find the time of the last message of the user. The time away starts there. It ends when you make the briefing.
   - Read the threads with `t3_thread_list` and `includeSubagents: true`. T3 lists them by `updatedAt`, newest first.
   - For each thread, read the end of the timeline with `t3_thread_read`, `view: "messages"`, and `afterPosition` near `itemCount`. Read an earlier window if the end has no user message.
   - A user message has `createdBy: "user"` and `type: "user_message"`. Its time is `updatedAt`.
   - Ignore the message that started your current run.
   - Stop at the first thread whose `updatedAt` is earlier than the best time so far.
2. Read the other T3 state: the pending questions, and the sessions from `t3_thread_list`. For each active session, read `startedAt` of its active run in `recentRuns`. Give it as `started_at`. A pending request has no time.
3. If the tip of `main` has no snapshot, run `metrics snapshot` first (see "Take the metric snapshots"). Then give the command this stdin. All keys are optional: `{"t3": {"sessions": [{"thread_id", "title", "status", "provider", "model", "started_at"}], "pending_questions": [{"thread_id", "title", "text"}], "last_user_message": {"thread_id", "at"}}, "open_questions": [...], "decision": {...}}`.
   - `started_at` and `at` are UTC times, for example `2026-10-26T12:04:11.790Z`. `at` must not be later than the current time. If it is, the command gives exit 2.
   - Without `last_user_message`, the `reentry` view still gives exit 0. "While you were away" shows "unavailable".
   - Add `decision` only for a merge decision.
4. Read the page for "unavailable" items. A section of a later step names its module. This is not a fault. A live source that failed (journal, Git, GitHub, or T3) adds an item under "At risk". Report it to the user.
   - If the "Docs" row shows new flags, say so in your reply. Say what you will do about them: see "Close a batch or a step".
5. If the Git chip shows "behind", a merged pull request is not on your local `main`. Update local `main`, then run the briefing again.
6. Check the page with `html_preview` to get `contentHeight`. Then give the `rendered` value to `html_render`. Never write brief HTML by hand. Never render B or C on every update.

## Common mistakes

| Mistake | Correction |
| --- | --- |
| Dispatch because an issue is in Ready | Dispatch only an issue in a recorded batch. |
| Dispatch again after exit 4 | Find the thread by `clientRequestId`, then bind it. |
| A brief without the fixed lines | Write every brief from the template that `mainspring template brief` gives. |
| Copy only `status` from a native read, or end an intent from `task_status` | Copy the `thread_read` fields from `t3_thread_read`. A terminal `task_status` gives exit 2, because it does not show a user turn in a held queue. |
| A resume observation without `attempt` | Copy `attempt` from the `dispatch-resume` output into each observation. |
| A new review round for a non-blocking finding | Defer the finding to its issue. |
| Merge after a new commit | A new commit cancels the approval. Ask the user again. |
| Close out a `queued` pull request | Only `merged` with a merge commit allows closeout. |
| Merge on `merge-check` exit 0 without the user's approval | Run `merge-execute` only after the user approves the presented head. |
