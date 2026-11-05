---
name: independent-review
description: Use when a Mainspring dispatch brief makes you the independent reviewer of a recorded commit. Use it for a first review, for a re-review of a repair, and for a check of the writing standard of a spec, a plan, or a document.
---

# Independent review

Your role: reviewer. Read `agents/reviewer.md` and `AGENTS.md` first. They hold your duties, your limits, and the shared rules. This skill gives the recipes. It does not repeat them.

## Review a revision

1. Check that the head SHA and the base SHA in the brief exist: `git cat-file -t <sha>`.
2. Read the change: `git diff <base> <head>` and `git show <head>`.
3. Read the `verify` result of the orchestrator in the brief. Do not run the full verification again: your sandbox has no network, and a dependency install fails. Run targeted probes only. To run a probe on the head, use `mainspring verify --repo <path of your checkout>` with `{"commit": "<head>", "commands": [...]}`, and only when the probe needs no installed dependency. Report a check failure that comes from the environment as "environment". It is not a defect of the commit.
4. Compare the change with the brief, the plan, and the acceptance criteria. Form your own view.
5. For each instruction file that the change adds or edits, run `mainspring ste-check <file>...`. "Writing standard" in `AGENTS.md` says which text is an instruction.
6. If the brief lists documents from `docs check`, read each document against the change. Report a wrong document as a `minor` finding that says what is wrong. Review a document that the acceptance criteria name like any other part of the task.

## Write a finding

Give each finding the fields of the `Finding` record:

```json
{
  "id": "R1-01",
  "head_sha": "<the 40-digit head SHA>",
  "severity": "important",
  "location": "mainspring/orchestration/brief.py:120",
  "failure": "An issue title with <script> appears unescaped in the HTML.",
  "evidence": "A probe with the title <script>x</script> gives a script element in the HTML.",
  "disposition": "open"
}
```

| Severity | Use it for |
| --- | --- |
| `critical` | A defect that loses data, breaks security, or merges the wrong revision |
| `important` | A correctness, safety, or plan-acceptance defect |
| `minor` | All other findings, which include style and most STE findings |

- If a probe found the defect, put the probe command and its short source in `evidence`. The worker bases the regression test on it.
- A finding blocks only when its severity is `critical` or `important` and its disposition is `open`.
- An STE finding is `minor`. Make it `important` only when the text is unclear or ambiguous.
- If no blocking finding remains, your verdict is `approve`. Otherwise, it is `request_changes`.

## Re-review a repair

1. Check only the repair and the earlier findings. Do not start a new full review.
2. Set each earlier finding to `fixed`, or keep it `open`. Use `rejected` when you accept the worker's evidence against it.

## Report

Give the verdict, the findings as JSON, and the checks that you ran with their results. Write the prose in plain, clear English (`AGENTS.md`).
