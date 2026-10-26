---
name: repo-intake
description: Use when a Mainspring dispatch brief makes you the intake worker for an existing repository. You examine the repository read-only, run its verification commands at the base commit, and draft the project record and the intake report for user approval.
---

# Repository intake

Your role: worker. Read `agents/worker.md` and `AGENTS.md` first. They hold your duties, your limits, and the shared rules. This skill gives the intake recipe. It does not repeat them.

## Inputs

The brief gives you:

- the base commit SHA
- the open issues of the repository, as JSON
- the fields of the GitHub Project board

Make no GitHub call. For the issues and the board, use only the data in the brief.

## Examination

Examine the repository read-only. Do not change, move, or delete an existing file.

1. Confirm that the worktree HEAD is the base commit. If it is not, stop and report a blocker.
2. Read the README, the build files, and the CI workflows.
3. Read the existing agent instruction files (for example, `AGENTS.md` and `CLAUDE.md`) and the source layout.
4. Identify each toolchain, for example Python and TypeScript. Record each toolchain and the parts that you examined.
5. Record each part that you did not examine as an open question. Never claim full coverage without evidence.
6. Find the candidate verification commands in the build files, the CI workflows, and the documentation.
7. Run each candidate command once at the base commit, with a limit of 15 minutes. Use `mainspring verify`, as "Command evidence" tells. Record the command, the exit code, and the duration.
8. Give each command one result:

| Result | Condition |
| --- | --- |
| verified | The exit code is 0, inside the limit. |
| failed | The exit code is not 0. A command that needs a credential, an account, or a service that you do not have also fails. |
| timed out | The command did not stop inside the limit. `verify` stops the command and its child processes. |

A failed or timed-out command stays in the report with its result. Never drop it, and never mark it "verified".

### Command evidence

A command counts as "verified" at the base commit only when it runs in a clean clone of the exact base commit, outside the worktree. Your own worktree is never the test location, because an uncommitted edit there can change the result.

1. Run `mainspring verify --repo <worktree>` with `{"commit": "<base_sha>", "commands": ["<command>", ...]}`. Give each candidate command in `commands`, because a new installation has an empty `verification` list.
2. Read the result of each command: the exit code, the duration, and `verified`, `failed`, or `timed out`. Copy them into the report.
3. Read the exit code of `verify`:
   - Exit 0: each command is `verified`.
   - Exit 3 (`verification_failed`): one or more commands are `failed` or `timed out`.
   - Exit 2: the input is not valid, for example an unknown commit.

`verify` makes the clone in a new temporary directory, and removes it at the end. It checks HEAD and the clean state before and after each command. It runs each command with the default shell of the platform. The default limit is 900 seconds (`timeout_seconds`). The output never holds the output of a command.

The clone is a temporary copy, not a worktree, so the "do not create worktrees" rule in `agents/worker.md` allows it.

### Environment

- You can make a project-local environment (for example, a `.venv` directory) only when the documentation of the repository describes it. Make it inside the clone of `verify`: give the setup command first in `commands`. Never make it inside the worktree.
- Never install a package globally. Never change a file outside the worktree and the clone of `verify`.

### Sensitive values

- Never copy a credential, a sensitive value, or the content of a `.env` file into a draft. Record only that the file exists.
- Never put a command output that holds such a value into a draft.

## Outputs

Write only these files, and nothing else:

| Output | Content |
| --- | --- |
| `docs/workflow/project.md` | The project record, from the template that `mainspring template project` gives. Fill `architecture` (prose and one Mermaid diagram), `sources` (the file and line for each claim), and `open_questions`. |
| `docs/workflow/intake-report.md` | The intake report, from the template that `mainspring template intake-report` gives. |
| The `verification` and `merge` sections of `.mainspring/config.json` | `verification`: the "verified" commands only. `merge.method`: the method that the repository documentation names. If it names none, keep the default and record that assumption. |

- Do not change an existing agent instruction file. Give each proposed change as a diff in the intake report.
- For each claim in the project record, give the source file and the line in `sources`.
- Propose the candidate first batch from the open issues in the brief. For each issue, give the title, whether it is substantial, and the reason.

## Checks before commit

1. Run `mainspring secret-scan <file>...` on each output file. Give the absolute path of each file.
   - Exit 0: the files are clean.
   - Exit 3: the output gives the file, the line, and the kind of each finding. Remove the value, and run the scan again.
   - Never commit a file that fails the scan.
2. Run `mainspring ste-check <file>...` on the absolute paths of the two Markdown outputs. Correct each warning if the correction keeps the statement precise.
3. Run `git status`. Confirm that only the output files changed.
4. Commit the outputs on the branch of the worktree.

## Report

Give the five report parts that `agents/worker.md` names. Add these items:

- Evidence: the table of command results (command, exit code, duration, and result), the `secret-scan` exit code, and the `ste-check` warning count.
- Assumptions: each default that you kept, and the reason.
- Risks: each part of the repository that you did not examine.
- Requests: `REQUEST: independent review of <sha>`. The reviewer checks each claim against its source.

## Common mistakes

| Mistake | Correction |
| --- | --- |
| Mark a command "verified" from the documentation only | Run it at the base commit. Record the exit code and the duration. |
| Run a verification command in your own worktree | Run it with `mainspring verify` at the base commit. |
| Drop a command that failed or timed out | Keep it in the report with its result. |
| Claim full coverage of a repository with two toolchains | Record each toolchain. Name each part that you did not examine as an open question. |
| Edit `AGENTS.md` or another existing file | Propose the change as a diff in the intake report. |
| Call `gh` for the issues or the board | Use the data in the brief. |
