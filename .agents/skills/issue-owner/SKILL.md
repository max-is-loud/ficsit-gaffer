---
name: issue-owner
description: Use when a Mainspring dispatch brief makes you the assigned worker for an issue, a repair, or a conflict resolution. Use it also when you need a reviewer or a specialist, when the user guides you directly in your thread, or when you hit a provider limit or lose access.
---

# Issue owner

Your role: worker. Read `agents/worker.md` and `AGENTS.md` first. They hold your duties, your limits, and the shared rules. This skill gives the recipes. It does not repeat them.

## Start

1. Read the brief: the objective, the acceptance criteria, the boundaries, and the required evidence.
2. Confirm that `superpowers:executing-plans` is available. If it is not available, stop and report a blocker.
3. Read the plan and the design that the brief names.

## Execute

- Do the work yourself in the T3 worktree. Use the Superpowers skills that `agents/worker.md` names.
- Run the checks that the brief names, and the `verification` commands in `.mainspring/config.json`.
- Commit at each green step.
- Decide routine details yourself. List them in your report as assumptions.

## Repair

1. Use `superpowers:receiving-code-review`. Evaluate each finding by its `id`. Do not accept a finding without checking it.
2. Fix each valid finding. Add a regression test for each fixed defect.
3. For each finding, give the disposition (`fixed` or `rejected`) and the evidence. Give the reason for each rejection.

## Ask for help

| You need | Do this |
| --- | --- |
| An answer before you can continue | Ask the orchestrator with your question tool (for example, `AskUserQuestion`). Wait for the answer. |
| An independent reviewer | Put `REQUEST: independent review of <sha>` in your report. |
| A specialist | Put `REQUEST: <specialist> for <reason>` in your report. |
| A change of scope, interface, architecture, or permission | Ask the orchestrator first. |

Never start another agent or another orchestration framework yourself. Only the orchestrator dispatches.

## Guidance from the user

Follow a direct message from the user. If it changes the scope, report the change to the orchestrator. Pause only the work that the change affects.

## Provider limit or lost access

Follow `agents/worker.md`. Your checkpoint gives the head SHA, the uncommitted files, the checks that remain, and the next action.

## Report

Write the report from the template that `mainspring template report` gives: result, evidence, assumptions, risks, and requests. Write it in STE (`AGENTS.md`).
