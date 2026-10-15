# Work-order quantity verification ([upstream #223](https://github.com/StuartMeeks/ficsit-foreman/issues/223))

> **Status:** **Shipped** — the design of record for issues [upstream #223](https://github.com/StuartMeeks/ficsit-foreman/issues/223) and [upstream #228](https://github.com/StuartMeeks/ficsit-foreman/issues/228). Both slices
> merged: slice 1 (power output verification, [upstream #227](https://github.com/StuartMeeks/ficsit-foreman/issues/227)) and slice 2 (recipe-per-block model +
> server-derived rates + output advisory + merged-order revise validation, [upstream #228](https://github.com/StuartMeeks/ficsit-foreman/issues/228)/[upstream #229](https://github.com/StuartMeeks/ficsit-foreman/issues/229)). Where
> this conflicts with older notes, this wins.

## Problem

[`docs/work-orders.md`](./work-orders.md) is the contract a work order fulfils; [upstream #220](https://github.com/StuartMeeks/ficsit-foreman/issues/220)
and [upstream #222](https://github.com/StuartMeeks/ficsit-foreman/issues/222) made every game-data **name** in a plan accurate-by-construction (resolve or
reject at ingest — see [`SYSTEM_PROMPT.md`](../packages/ff-server/SYSTEM_PROMPT.md) for
the soft guidance those issues hardened). Neither touched the **quantitative** content:

- `buildSteps[].buildables[].requiredCount` — machine/buildable counts
- `recipes[].inputItems[]/outputItems[].perMinute` — per-minute rates
- `expectedOutputs[].megawatts` (kind=power) / `.perMinute` (kind=item)

These are computed by the model (ideally from `ingredient_tree` / `full_production_line` /
`list_power_generators`) and transcribed into `create_work_order`. The server never
recomputes or checks them, so a plan can name every building correctly and still be
quantitatively wrong.

**The bug that filed this issue.** A live *"1200 MW coal plant"* order shipped with **12
Coal-Powered Generators**: 12 × 75 MW = **900 MW**, not the claimed 1200 (16 are needed).
The foreman's chat reply then repeated the false 1200 MW figure. The system prompt only
*requests* tool-verified figures; nothing enforces it.

## Design decision: hybrid, confidence-scoped

Verification is split by how *certain* the ground truth is, because the two halves have
very different false-positive risk:

| Class | Ground truth | Certainty | Action |
|---|---|---|---|
| **Power output** (`megawatts` vs generators) | `Σ(requiredCount × powerProduction)` | **Deterministic** — generators can't be overclocked; `powerProduction` is fixed | **Hard reject** on under-provision |
| **Manufacturing** (machine counts, rates) | `ingredient_tree` / `full_production_line` | **Uncertain** — graph maths are 100% clock, no somersloop/modifiers; plans carry no clock info | **Advisory only** (non-blocking note) |

This is the "hybrid" of the options [upstream #223](https://github.com/StuartMeeks/ficsit-foreman/issues/223) raised: reject where we're certain, advise where
we're not. We explicitly reject **option 3 (server-computed fill)** — it fights legitimate
overclock/alt-recipe intent and is the largest change for the least clear benefit.

### Why manufacturing can't be hard-checked

`ingredientTree` / `fullProductionLine`
(`packages/sf-game-data-graph/src/graph/queries/production.ts`) compute every machine count
and rate at **100% clock speed with no somersloop and no save modifiers**. A work-order plan
carries no clock-speed field, and a pioneer legitimately overclocks (or somersloops) to
change counts. So a strict count/rate comparison would raise **false rejects** for any
non-100% plan. Alt-recipe choice *is* representable (via `recipeChoices`), but clock/
somersloop variance is not — so manufacturing figures can only ever be an advisory hint.

### Why the flow solver isn't the engine

`packages/sf-flow` (`find_bottlenecks`) reconciles steady-state flow over an **already-built
save topology** (belts, splitters, elevations; requires a `savePath`). It answers "is each
machine actually being fed", not "does this plan's stated count follow from the recipe". It
is the right tool for a *built factory*, wrong for *ingest-time plan* checking.

## Architecture

Verification is a sibling pass to `resolvePlanReferences`
(`packages/ff-server/src/tools/workOrderTools.ts`), called from `handleCreate`,
`handleRevise`, and `handleCreateChild` immediately **after** name resolution (buildables
already carry their resolved `buildingClass` by then) and **before** persist. ff-server
holds no in-process game data — all lookups go through `mcp.callTool`, exactly as [upstream #222](https://github.com/StuartMeeks/ficsit-foreman/issues/222) does.

The only channel back to the model is the tool-result `text` string (`chat.ts` pushes
`{ role: 'tool', content: outcome.text, isError }`); `WorkOrder` / `WorkOrderToolOutcome`
have no structured warnings field. Therefore:

- **Reject** = return `{ text: message, isError: true }` and do **not** persist (as
  `resolvePlanReferences` does).
- **Advisory** = persist normally, then append the discrepancy to the success `text`.

## Slice 1 — power output verification (hard reject)

`verifyPlanPower(plan, mcp)` returning `{ ok: true } | { ok: false; message }`:

1. `declaredMW` = Σ `megawatts` over `expectedOutputs` with `kind === 'power'`. None → skip.
2. One `list_power_generators` call → `className → powerProduction`, keeping only
   **fixed-output** generators (`powerProduction` set and not `variablePowerProduction`;
   Geothermal is variable and can't be count-verified).
3. `actualMW` = Σ over buildables whose resolved `buildingClass` is a fixed generator of
   `requiredCount × powerProduction`. No such buildables → **skip** (can't verify from the
   plan alone).
4. **Reject iff `actualMW + ε < declaredMW`** — the plant can't produce what it claims.
   Over-provisioning (headroom) passes. Deterministic, so `ε` is only a float guard.
5. Message is actionable (mirrors [upstream #222](https://github.com/StuartMeeks/ficsit-foreman/issues/222) rejections), e.g.:
   > Work order not created: it claims **1200 MW** but its **12× Coal-Powered Generator**
   > produce **900 MW** (75 MW each). For 1200 MW you need **16× Coal-Powered Generator**.
   > Adjust the count or the target and retry.

   For a single generator type, give the exact `ceil(declaredMW / powerProduction)`; for
   mixed types, report the gap and let the model rebalance.

**Partial-revise safety:** the check derives both sides from whatever the (patch) plan
contains; if it can't see *both* a power output and generator buildables it skips — so a
revise touching only the target, or only the buildables, is never falsely rejected.

## Slice 2 — recipe-per-block model + server-derived rates + output advisory ([upstream #228](https://github.com/StuartMeeks/ficsit-foreman/issues/228))

A design review found the plan model couldn't support a clean manufacturing check as-is:
recipes lived both as an optional, unvalidated `buildables[].recipeName` string *and* as a
top-level `recipes[]` array (rates, no counts, unlinked, not even in the `create_work_order`
tool schema — so the model never authored it). Rates that appeared were foreman-transcribed —
the same error class this doc exists to close. So slice 2 **reshapes** the model rather than
just checking it:

1. **Recipe is a first-class property of each production buildable block.** A buildable is
   *N identical machines running one recipe* (e.g. `4 Constructors → Iron Plate`); mixed
   machines are split into one-recipe blocks. `buildables[].recipeName` is **resolved-or-
   rejected at ingest** (extends [upstream #222](https://github.com/StuartMeeks/ficsit-foreman/issues/222); suggestions from `list_recipes`). Logistics buildables
   carry no recipe.
2. **The server derives rates — the foreman never transcribes them.** `deriveRecipes(plan, mcp)`
   (`workOrderTools.ts`, a sibling to `resolvePlanReferences`, run in all three handlers) reads
   each block's recipe via `get_recipe`, and sets each block's input/output per-minute =
   `count × per-machine rate` (100% clock; **all** products, so byproducts are included).
3. **`recipes[]` is a server-derived projection, not model input.** `deriveRecipes` overwrites
   `plan.recipes` with one `RecipeAssignment` per recipe (`machineName = producedIn[0]`, summed
   input/output rates). The client renders it unchanged (same shape). No DB/migration/client
   change.
4. **Building↔recipe compatibility is a hard reject** (deterministic): a block whose building
   isn't a machine the recipe runs in (`recipe.producedIn`) is rejected with an actionable
   message. Skipped when `producedIn` is empty (non-factory recipes).
5. **Output advisory (non-blocking).** For each `expectedOutputs[kind=item]` target, compare
   derived total output; if short beyond a rounding tolerance, append an advisory to the
   success `text` — surfaced to the **foreman** in the tool-use loop (self-correct before
   replying), **never** rejected and **never** shown to the pioneer as a decision. A missing
   recipe on a production block surfaces here naturally (derived output falls short).

Net effect: the pioneer receives labelled blocks with server-computed rates and never
adjudicates a recipe; machine **count** is the only model-authored quantity, which the advisory
nudges.

**Revises validate the merged order, not just the patch.** A revise patch omits fields it
isn't changing, so the cross-field checks (power, output advisory) run against the *effective*
plan — the current order overlaid with the patch (a present field replaces; an absent one keeps
the existing value, matching `updatePlan`'s merge). Without this, a target-only revise
("2400 MW") is never compared to the existing generators and an under-provisioned plant ships on
a revision — the exact bug observed live (WO-001 rev4: `megawatts` bumped to 2400 while 16
generators = 1200 MW stayed). Name resolution and recipe derivation still operate on the patch
(what changed); only the cross-field checks use the merged view.

## Out of scope

- Hard-rejecting manufacturing **counts** (clock/somersloop variance is legitimate) — advisory only.
- A clock-speed/somersloop plan field; rates are derived at 100% clock.
- Classifying "which buildings require a recipe" — a missing recipe is caught via the output
  advisory, not a category-based reject.
- Server-computed fill of counts (option 3); flow-solver / built-topology verification.
