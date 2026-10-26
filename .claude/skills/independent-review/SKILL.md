---
name: independent-review
description: Use when a Mainspring dispatch brief makes you the independent reviewer of a recorded commit. Use it for a first review, for a re-review of a repair, and for a check of the STE conformance of a spec, a plan, or a document.
---

# Independent review

Your role: reviewer. Read `agents/reviewer.md` and `AGENTS.md` first. They hold your duties, your limits, and the shared rules. This skill gives the recipes. It does not repeat them.

## Review a revision

1. Check that the head SHA and the base SHA in the brief exist: `git cat-file -t <sha>`.
2. Read the change: `git diff <base> <head>` and `git show <head>`.
3. Run the checks with `mainspring verify --repo <path of your checkout>` and `{"commit": "<head>"}`. It runs the `verification` list of the configuration in a clean clone of the head. If that list is empty, give the checks of the brief in `commands`.
4. Compare the change with the brief, the plan, and the acceptance criteria. Form your own view.
5. For each Markdown file that the change adds or edits, run `mainspring ste-check <file>...`.

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

- A finding blocks only when its severity is `critical` or `important` and its disposition is `open`.
- An STE finding is `minor`. Make it `important` only when the text is unclear or ambiguous.
- If no blocking finding remains, your verdict is `approve`. Otherwise, it is `request_changes`.

## Re-review a repair

1. Check only the repair and the earlier findings. Do not start a new full review.
2. Set each earlier finding to `fixed`, or keep it `open`. Use `rejected` when you accept the worker's evidence against it.

## Report

Give the verdict, the findings as JSON, and the checks that you ran with their results. Write the prose in STE (`AGENTS.md`).
