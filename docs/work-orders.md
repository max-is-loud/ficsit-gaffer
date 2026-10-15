# Work Order Specification (v2)

> **Status:** Canonical reference for the Work Orders v2 feature set. This is the
> agreed design — an original draft was reviewed and corrected; this document is
> the source of truth for all implementation sessions. Where this conflicts with
> older notes, this wins.

> **Related:** ingest-time resolution of the plan's game-data **names** ([upstream #220](https://github.com/StuartMeeks/ficsit-foreman/issues/220), [upstream upstream #222](https://github.com/StuartMeeks/ficsit-foreman/issues/222))
> and verification of its **quantities** ([upstream #223](https://github.com/StuartMeeks/ficsit-foreman/issues/223) — power reject + manufacturing advisory)
> are specified in [`work-order-quantity-verification.md`](./work-order-quantity-verification.md).

## Purpose

FICSIT Foreman uses work orders to direct Satisfactory gameplay.

A work order is a structured execution contract between the Foreman and the
Pioneer. Its purpose is to reduce cognitive load by giving the player one clear,
actionable piece of work at a time.

A work order should answer:

* What am I doing?
* Why am I doing it?
* Where should I do it?
* What resources, recipes, buildings, and machines are involved?
* What exactly do I build or collect?
* How do I know when I am done?
* What optional opportunities are nearby?
* What changed while I was working?

Work orders are not just chat responses. They are durable, stateful, auditable
application records.

## Ownership model

Work orders have three ownership boundaries:

* The Foreman owns the **plan**.
* The Pioneer owns **execution progress**.
* The system owns **history**.

This separation is load-bearing for the whole design (see *Plan vs execution*,
below). It means:

* The Foreman may create and revise the plan.
* The Pioneer records what has actually been done.
* The system records all meaningful changes in an append-only audit trail, and
  preserves every plan revision as a snapshot.

## Architectural boundary

Do **not** create a separate MCP server for work orders. Work orders are
application state owned by `packages/ff-server`.

MCP servers remain responsible for external facts:

```text
Game-data MCP      = What is true about Satisfactory (recipes, buildings, world)
Save-game MCP      = What is true about this save/player (inventory, progression,
                     player location, which collectibles remain)
Server Work Orders = What the Foreman has instructed and what the Pioneer has done
Client UI          = How the Pioneer executes the current instruction
```

The Foreman populates plan and opportunity data by calling the MCP tools at
issue time — it joins game-data facts with save-game state. The server stores the
result; it does not itself query the game world.

## Design principles

### Reduce cognitive load

The active work-order UI prioritises the next useful thing the Pioneer needs to
know or do. It is not a generic project-management interface.

### One active direction

The Foreman keeps the Pioneer focused on the active work order (or its currently
relevant child). At most one work order is `active` per playthrough at a time — but
multiple **non-terminal** work orders may coexist (e.g. a `blocked` parent while
its child is `active`). See *Single-active invariant*.

### Plan vs execution are separate

This is the core correction to the original draft and governs revisions, revert,
and acknowledgement:

* A **plan revision** is a change the Foreman makes to the contract (goal,
  steps, materials, machines, recipes, etc.). Plan revisions are snapshotted and
  are subject to Pioneer acknowledgement. They are relatively rare.
* **Execution progress** is what the Pioneer does: ticking steps, entering
  per-buildable built counts, logging hours. This lives on the live work-order
  record. Its history is the **audit trail** — it is *not* snapshotted, and it
  does *not* bump the plan revision number.

Consequences:

* Revision snapshots store **plan fields only** (see *Snapshot scope*).
* Reverting restores a previous **plan**; it never un-ticks the Pioneer's boxes,
  resets buildable built counts, or undoes logged hours.
* `currentRevision` moves only on plan changes, so "the plan changed since you
  acknowledged revision N" stays meaningful.

### Execution truth belongs to the Pioneer

The system does not pretend to know what the player has built unless the player
records it. Machine built counts are manual. The Foreman may **propose**
completion but may never mark a work order complete itself (see *Completion*).

### History is append-only

The audit trail and plan revisions are never deleted or rewritten. Reverting
creates a *new* revision; it does not remove previous ones.

### Actors are guardrails, not a security boundary

The actor rules below are validated, but `actor` is **asserted by call site**,
not authenticated: the Foreman acts via LLM tool calls; the Pioneer acts via the
REST API / UI; both share the same session. Treat the allowed-actor matrix as a
correctness guardrail, not access control. Do not build authentication to
enforce it.

## Actors

```ts
type WorkOrderActor = 'Pioneer' | 'Foreman' | 'System';
```

### Pioneer (the human player)

May: start, pause, resume, complete, force-complete, cancel work; check/uncheck
steps; enter per-buildable built counts; log hours; acknowledge Foreman
revisions; revert a non-terminal work order to a previous plan revision.

### Foreman (the AI Factory Director)

May: create work orders; revise work-order plans; pause, resume, block, unblock,
cancel, supersede work; create child work orders; **propose** completion; revert
a non-terminal work order to a previous plan revision.

The Foreman may **not** mark work completed. Completion means the Pioneer says
the work has been done in the game.

### System (the application/server)

May: create migration audit events; supersede a previous work order as a *direct
consequence* of an explicit operation; maintain revision snapshots and audit
events. The System performs no gameplay state transitions of its own accord.

## Work-order states

```ts
type WorkOrderState =
  | 'new'        // issued, not started
  | 'active'     // currently being executed
  | 'paused'     // intentionally paused for supporting/discretionary activity
  | 'blocked'    // cannot continue until a prerequisite is resolved
  | 'completed'  // terminal — success
  | 'cancelled'  // terminal — explicitly abandoned
  | 'superseded' // terminal — replaced by a newer strategic instruction
;

type TerminalWorkOrderState = 'completed' | 'cancelled' | 'superseded';
```

`blocked` must always carry a `blockedReason` and `blockedResolutionHint`.

No actor may transition a terminal work order. Terminal orders are locked unless
a future explicit reopen/clone feature is added.

## Single-active invariant

* At most **one** `active` work order per playthrough at any time.
* Multiple **non-terminal** orders may coexist (`new`, `paused`, `blocked`).
* Creating a new work order does **not** automatically abandon/supersede the
  current one (a correction to today's behaviour). Supersession is an explicit
  Foreman/System action, used when a new order genuinely replaces an old one —
  not a side effect of every create. This is required so a parent can sit
  `blocked` while its child runs.

## State transition policy

Transitions are validated against **both** the current state and the requesting
actor.

```yaml
transitions:
  - action: Start
    allowed_actors: [Pioneer]
    from: [new]
    to: active

  - action: Pause
    allowed_actors: [Pioneer, Foreman]
    from: [active]
    to: paused

  - action: Resume
    allowed_actors: [Pioneer, Foreman]
    from: [paused]
    to: active

  - action: Block
    allowed_actors: [Foreman]
    from: [active, paused]
    to: blocked
    requires: [blockedReason, blockedResolutionHint]

  - action: Unblock
    allowed_actors: [Foreman]
    from: [blocked]
    to: active
    requires: [resolutionNote]

  - action: Complete
    allowed_actors: [Pioneer]          # Foreman may only PROPOSE completion
    from: [active]
    to: completed

  - action: ForceComplete
    allowed_actors: [Pioneer]
    from: [active, paused, blocked]
    to: completed
    requires: [forceCompletionReason, incompleteItemSummary]

  - action: Cancel
    allowed_actors: [Pioneer, Foreman]
    from: [new, active, paused, blocked]
    to: cancelled
    requires: [cancellationReason]

  - action: Supersede
    allowed_actors: [Foreman, System]
    from: [new, active, paused, blocked]
    to: superseded
    requires: [supersededByWorkOrderId, supersededReason]
```

`Complete` is only allowed from `active`. `ForceComplete` is allowed from
`active`, `paused`, or `blocked` — preserving the clean normal path while letting
the Pioneer override.

## Completion (Option A)

The Pioneer alone completes a work order. The Foreman may surface a *suggestion*
("this looks finished — close it out?"), but the act of completing is a
Pioneer-driven REST/UI action. The foreman's tool surface exposes a
**propose-completion** capability, not a completion one.

### Completion capture

Completion optionally captures a short `completionSummary` and `pioneerFeedback`
(what the pioneer enjoyed / did not enjoy, plus freeform notes). Both are
optional execution fields stored on the live record, retained from Phase 2 so the
foreman can learn from how an order went. Mid-order adaptations are not a
separate field — they are recorded as `build_plan_adapted` audit events.

### Force completion

The Pioneer may complete even with incomplete steps or unbuilt buildables.
The UI warns first, summarising what is incomplete; completion is still
allowed. The audit trail records the force completion and the incomplete-item
summary.

## Revert policy (plan-only)

Reverting is not a normal state transition. Either the Foreman or the Pioneer may
revert a **non-terminal** work order to a previous **plan** revision.

Reverting must:

* Require explicit confirmation.
* Create a new revision whose plan snapshot is copied from the selected revision.
* Create an audit event (`reverted_to_revision`).
* Delete no history.

Reverting restores the **plan only**. It does **not** touch execution progress —
checked steps, per-buildable built counts, and logged hours are preserved. If
the restored plan changes the checklist, the merge-forward rule applies (see
*Checklists & stable IDs*). If the restored snapshot implies a different state,
that state change is recorded as part of the revert audit event.

Terminal work orders cannot be reverted in place; create a new work order
instead.

## Plan revision & acknowledgement

Plan revisions are Foreman-driven (or Pioneer-driven via revert). Each plan
change writes a full plan snapshot and bumps `currentRevision`.

When the Foreman revises a `new`/`active`/`paused`/`blocked` work order, the
Pioneer sees a persistent "plan changed" notification until acknowledged.

```ts
type WorkOrder = {
  currentRevision: number;
  lastAcknowledgedRevision?: number;
  // hasUnacknowledgedRevision is DERIVED: currentRevision > (lastAcknowledgedRevision ?? 0)
};
```

`hasUnacknowledgedRevision` is **not stored** — derive it to avoid drift.
Acknowledging writes a `revision_acknowledged` audit event.

The banner shows previous → current revision number, a change summary, the
timestamp, and who changed it. A **field-level diff** (before/after per changed
plan field) is computed from the stored snapshots and exposed via the revisions
diff endpoint, so the UI can render a "FIELD / BEFORE / AFTER" table.

## Revision snapshots

```ts
type WorkOrderRevision = {
  id: string;
  workOrderId: string;
  revisionNumber: number;
  createdAt: string;
  createdBy: WorkOrderActor;
  reason?: string;
  changeSummary?: string;
  planSnapshot: WorkOrderPlanSnapshot;
};
```

### Snapshot scope — PLAN fields only

A snapshot contains the complete **plan** after the change:

* Plan text (title, goal, objective, strategic significance, success condition)
* Location recommendation, resource nodes
* Build steps (with stable ids and order — *not* checked state), each carrying the
  **buildables** it requires (machines + logistics, with `requiredCount`, stable ids,
  and server-resolved per-unit `buildCost` — *not* built counts)
* Recipes, expected outputs
* Opportunity guidance
* Blocked reason and resolution hint
* Parent/child relationship fields

Snapshots do **not** contain execution state (checked flags, built counts,
logged hours) or audit events. Execution state lives on the live record; audit
events are stored separately.

## Checklists & stable IDs

Every step and every per-step buildable carries a permanent `id`. When a plan
revision changes a checklist, apply **merge-forward** (by step id *and* buildable id):

* Steps/buildables whose `id` still exists keep their checked state / built count.
* New items appear unchecked / with `builtCount` 0.
* Removed items drop.

This is what lets a plan change leave the Pioneer's progress intact.

## Core data model

The exact persistence may differ (JSON-as-TEXT columns are fine, per the existing
schema), but the domain supports:

```ts
type WorkOrder = {
  id: string;
  playthroughId: string;
  orderType: 'build' | 'explore';  // upstream #207 — default 'build'
  sequenceNumber: number;        // rendered WO-001 (build) / EO-001 (explore)
  version: string;               // game-data version this order was built for

  // Plan
  title: string;
  goal: string;
  objective?: string;
  strategicSignificance?: string;
  successCondition?: string;
  tier?: number;                 // Satisfactory milestone tier (0–9)
  notes?: string[];              // freeform foreman build notes
  locationRecommendation?: LocationRecommendation;
  resourceNodes?: ResourceNodeReference[];
  recipes: RecipeAssignment[];   // server-derived from per-buildable recipe × count (upstream #228)
  expectedOutputs: ExpectedOutput[];
  buildSteps: WorkOrderStep[];   // build orders — each step nests the buildables it requires
  waypoints?: ExploreWaypoint[]; // explore orders — the ordered collection route (upstream #207)
  opportunities?: WorkOrderOpportunities;
  blockedReason?: string;
  blockedResolutionHint?: string;

  // Execution
  state: WorkOrderState;
  startedAt?: string;
  pausedAt?: string;
  blockedAt?: string;
  completedAt?: string;
  hoursLogged?: number;

  // Revision / acknowledgement
  currentRevision: number;
  lastAcknowledgedRevision?: number;

  // Relationships
  parentWorkOrderId?: string;
  relationshipToParent?: WorkOrderRelationshipType;

  createdAt: string;
  updatedAt: string;
};
```

> Note on timestamps: `startedAt`/`pausedAt`/`blockedAt`/`completedAt` are
> "latest marker" operational timestamps only. They cannot represent multiple
> pause/resume cycles — that history lives in the audit trail. Do **not** infer
> logged hours from timestamps; `hoursLogged` is explicitly player-entered, and
> paused/exploration time does not count.

### Expected outputs (discriminated)

Output is more than item throughput. A power plant's headline output is MW.

```ts
type ExpectedOutput =
  | { kind: 'item'; item: string; perMinute: number; unit?: string }
  | { kind: 'power'; megawatts: number }
  | { kind: 'unlock'; schematic: string }
  | { kind: 'infrastructure'; description: string };
```

### Steps, buildables & cost

A build step holds the **buildables** it physically places — every machine *and*
logistics piece (belts, splitters, mergers, pipes, poles), with a `requiredCount`.
Each buildable's per-unit `buildCost` is resolved **server-side at author time** from
game data (via the `get_building` MCP tool), so the foreman supplies only the name +
count. Per-step and total build cost (and the *remaining* cost as the Pioneer builds)
are derived from this hierarchy — there is no separately-authored materials list.

```ts
type BuildCostLine = {
  itemName: string;
  itemClass?: string;        // resolved game-data class, when known
  amount: number;
};

type Buildable = {
  id: string;
  name: string;              // foreman-authored display name, e.g. "Conveyor Splitter"
  buildingClass?: string;    // server-resolved; undefined when unresolved
  requiredCount: number;
  builtCount: number;        // manual; execution state (per buildable)
  recipeName?: string;
  notes?: string;
  buildCost: BuildCostLine[];  // PER-UNIT, server-resolved; [] when unresolved
};

type WorkOrderStep = {
  id: string;
  title: string;
  description?: string;
  checked: boolean;          // execution state
  order: number;
  buildables: Buildable[];
};
```

Changing a built count or a checked flag writes an **audit event only** — not a
new revision snapshot.

### Recipes, location, resource nodes

Alternate recipe choices are resolved *before* a production/build work order is
issued; an issued order contains selected recipes, not unresolved options. Recipe
is a first-class property of each production buildable block; the foreman annotates
recipe + count, and the server **derives** the `recipes[]` array and its per-minute
rates from recipe × count ([upstream #228](https://github.com/StuartMeeks/ficsit-foreman/issues/228)) — the model no longer authors rates. A
building↔recipe mismatch is hard-rejected at ingest. See
[`work-order-quantity-verification.md`](./work-order-quantity-verification.md).

```ts
// Server-derived projection (not model-authored):
type RecipeAssignment = {
  id: string;
  machineName: string;
  recipeName: string;
  inputItems?: RecipeItemRate[];
  outputItems?: RecipeItemRate[];
  notes?: string;
};
type RecipeItemRate = { itemName: string; perMinute: number };

type LocationRecommendation = {
  summary: string;
  coordinates?: { x: number; y: number; z?: number };  // Unreal units (cm)
  relativeToPlayer?: string;
  rationale?: string;
};

type ResourceNodeReference = {
  id?: string;
  resourceName: string;
  purity?: Purity;                       // reuse Purity from @foreman/sf-game-data
  coordinates?: { x: number; y: number; z?: number };  // Unreal units (cm)
  distanceFromPlayer?: number;           // cm; convert to metres for display
  distanceFromWorkOrderLocation?: number;
  notes?: string;
};
```

> Names (`itemName`, `machineName`, `recipeName`, `resourceName`) are resolved
> against the game-data MCP's `displayName`/`className` lookups **at ingest, and
> the order is rejected if any reference is unresolvable** ([upstream #222](https://github.com/StuartMeeks/ficsit-foreman/issues/222)) — the foreman
> gets one message grouping the misses by kind, with best-match suggestions.
> Quantities are verified too (power over-provision is hard-rejected; recipes and
> per-minute rates are server-derived — see
> [`work-order-quantity-verification.md`](./work-order-quantity-verification.md)).

## Opportunities (cross-MCP join)

Opportunities are optional Foreman guidance, not required for completion (unless
the work order is *specifically* about an opportunity, e.g. an exploration order).

```ts
type WorkOrderOpportunities = {
  nearbyCollectiblesFromPlayer?: CollectibleOpportunity[];
  nearbyCollectiblesFromWorkOrderLocation?: CollectibleOpportunity[];
  overclockingOptions?: OverclockingOption[];
  awesomeShopSuggestions?: AwesomeShopSuggestion[];
  notes?: string[];
};

// REUSE CollectibleKind from @foreman/sf-game-data — do not invent a parallel
// enum. It is: mercerSphere | somersloop | powerSlugBlue | powerSlugYellow |
// powerSlugPurple | hardDrive | helmet | mtape (the last two are customizer
// pickups, schematic-keyed — upstream #67).
type CollectibleOpportunity = {
  id?: string;
  kind: CollectibleKind;
  coordinates?: { x: number; y: number; z?: number };  // Unreal units (cm)
  distance?: number;                                    // cm; show in metres
  reason?: string;
  optional: boolean;
};

type OverclockingOption = {
  target: string;
  recommendation: string;
  powerShardCount?: number;
  expectedEffect?: string;
  notes?: string;
};

type AwesomeShopSuggestion = {
  itemName: string;
  reason: string;
  priority?: 'low' | 'medium' | 'high';
};
```

How the Foreman populates these (the boundary paying off):

* **Near the work-order location** → pure game-data world query
  (`nearest_collectibles` / `nearest_resource_nodes` around the chosen coords).
  Works with no save loaded.
* **Near the Pioneer** → needs the player's position from the save-game MCP.
  Degrade gracefully (omit this group) when no current save is loaded.
* **Already-collected reconciliation** → static world data says where a
  collectible *can* be; the save says which remain. The Foreman must subtract
  collected items before surfacing them, so it never suggests a Somersloop the
  player already grabbed.

Collectibles are non-blocking unless the work order is specifically a collection/
exploration order.

## Parent & child work orders

```ts
type WorkOrderRelationshipType =
  | 'prerequisite'
  | 'exploration'
  | 'hard_drive_hunt'
  | 'mam_research'
  | 'resource_gathering'
  | 'infrastructure_support'
  | 'corrective_action';
```

* A child has its own state, audit trail, revisions, checklists, and completion
  flow.
* Completing a child does **not** auto-complete the parent.
* If a child resolves the parent's blocker, the Foreman may unblock the parent —
  this writes an audit event explaining why. (Auto-unblock on child resolution is
  in scope.)
* The UI shows parent ⇄ child navigation and the child states on the parent.

### Alternate recipe decision flow

Alternate recipe choices are resolved before issue. The Foreman inspects unlocked
recipes and suggests the best available plan; the Pioneer may accept, ask for
alternatives, or pursue a locked alternate. If the desired alternate is locked,
the Foreman may create a child work order (collect hard drives, MAM research,
etc.) and mark the parent `blocked` while the child runs.

## Audit trail

Append-only. Records meaningful changes; understated in the execution UI but
available for review.

```ts
type WorkOrderAuditEvent = {
  id: string;
  workOrderId: string;
  timestamp: string;
  actor: WorkOrderActor;
  eventType: WorkOrderAuditEventType;
  revisionNumber?: number;
  previousRevisionNumber?: number;
  note?: string;
  details?: unknown;
};

type WorkOrderAuditEventType =
  | 'work_order_created'
  | 'work_order_revised'
  | 'revision_acknowledged'
  | 'reverted_to_revision'
  | 'state_transitioned'
  | 'started' | 'paused' | 'resumed'
  | 'blocked' | 'unblocked'
  | 'completed' | 'force_completed' | 'cancelled' | 'superseded'
  | 'completion_proposed'           // Foreman suggested completion (Option A)
  | 'child_work_order_created'
  | 'child_work_order_completed'
  | 'step_checked' | 'step_unchecked'
  | 'buildable_built_count_changed'
  | 'collectible_collected'         // explore orders — Pioneer or System (upstream #207/#209)
  | 'hours_logged'
  | 'recipe_choice_changed'
  | 'build_plan_adapted'
  | 'migration_event';
```

Every mutating operation appends an audit event. Every operation that changes the
**plan** also writes a new revision snapshot; execution mutations write audit
events only.

## Status migration

The existing `abandoned` status is removed. In today's code, `abandoned` is only
ever set as a consequence of supersession, so:

* Migrate all existing `abandoned` rows → `superseded`, writing a
  `migration_event` audit row noting the prior status.

(The existing dataset is dev-only SQLite; keep the migration simple.)

## API requirements

Extend the existing work-order REST API. Required operations:

* Create work order
* Fetch active work order / history / single work order
* Fetch parent / children
* Start; transition state; block; unblock
* Update work-order plan (writes revision + audit)
* Update per-buildable built count; check/uncheck step; mark an explore-order
  collectible collected; log hours (audit only). Collapse these behind a small
  number of endpoints rather than one per verb.
* Acknowledge current revision
* Complete (Pioneer); force-complete (Pioneer)
* Cancel; supersede
* Create child work order
* Revert to revision
* Fetch audit trail / revisions / single revision
* Diff two revisions (field-level before/after; defaults to current vs previous)

Every mutating operation appends an audit event; every plan change creates a new
plan-snapshot revision.

The Foreman's tool surface (Anthropic tools, not REST) exposes: create (build) —
`create_work_order`, create explore — `create_explore_order`, revise plan, block,
unblock, supersede, create child, and **propose completion** — never complete.

## UI requirements

The active work-order panel prioritises low cognitive load.

**Default visible:** goal/objective; current state; location recommendation; build
steps with their buildables (required/built); derived build cost (total + remaining);
expected output (power as the hero metric when present); start/pause/complete controls.

**Collapsible:** recipes; resource nodes; nearby collectibles (two groups — near
Pioneer / near work-order location); overclocking options; alternate recipe
choices; AWESOME Shop suggestions; child work orders; revision history; audit
trail.

* **Plan-changed notification** — persistent until acknowledged: "Plan revised by
  Foreman. Review changes before continuing." Must not visually wipe existing
  progress.
* **Complete button** — large and prominent, as momentous as a HUB milestone.
* **Force-complete warning** — summarise what's incomplete, then allow continue.

### Full-schema client views (Phase 3 direction)

The Phase 3 client splits the full schema across **three dedicated views** rather
than the single panel that ships today. The goal is that the entire `WorkOrder`,
`WorkOrderRevision`, and `WorkOrderAuditEvent` shape is surfaced somewhere — the
active panel stays low-cognitive-load, while the richer detail lives in views the
Pioneer opens deliberately. Tracked as a field-by-field checklist in
[upstream [upstream #206](https://github.com/StuartMeeks/ficsit-foreman/issues/206)](https://github.com/StuartMeeks/ficsit-foreman/issues/206).

**Layout principle — briefing first.** Every view leads with the goal/summary/
action material: header + state, attention banners, the narrative (objective,
goal, strategic significance, success condition), **expected output** (it *is*
the goal), FM notes, and the lifecycle controls. The work content follows —
build steps → buildables → cost, then location, resource nodes, recipes,
opportunities, relationships, and history. Actions and outcomes must never sit
below the fold under the step ledger.

* **Normal view** — the live work order (plan + execution). The active panel
  above, extended to surface the plan fields currently hidden in the client:
  strategic significance, success condition, recipe input/output rates,
  location/resource coordinates + rationale, overclocking and AWESOME-shop
  opportunities, pioneer feedback, operational timestamps, and parent navigation.
* **Previous-snapshot view** — renders a `WorkOrderRevision`'s `planSnapshot` as a
  full, laid-out plan (plan-only, no execution state), not merely the field-level
  diff table that exists today.
* **Audit-trail view** — a first-class chronological view of the
  `WorkOrderAuditEvent[]` log (actor, event type, note, `details`, and the
  revision it references), beyond today's single completion-proposed banner.

## Non-goals for this implementation

* No separate MCP server for work orders.
* No automatic **buildable-count** detection / save-game reconciliation — built
  counts are manual (buildable→save-instance matching is heuristic; [upstream #209-A](https://github.com/StuartMeeks/ficsit-foreman/issues/209) was
  cancelled). Note: this non-goal is **narrowed** by [upstream #209-B](https://github.com/StuartMeeks/ficsit-foreman/issues/209), which *does* auto-
  reconcile **explore-order collectibles** on re-upload — those are identity-keyed
  (GUID/schematic), so the match is exact. See
  [`explore-orders.md`](./explore-orders.md).
* No inferring logged hours from timestamps.
* No requiring optional opportunities for completion.
* No editing/reverting terminal work orders in place.
* No prominent audit trail in the main execution UI.
* No generic project-management interface.
* No authentication to enforce the actor matrix (it is a guardrail, not access
  control).

## Suggested implementation order (slices)

1. **State model & migration** — new states, terminal enforcement, actor-aware
   transition validation, relaxed single-active invariant, `abandoned` → migrate.
2. **Audit events** — persistence, append on every mutating op, retrieval endpoint.
3. **Plan revisions** — plan-only snapshot persistence, snapshot on plan change,
   acknowledgement fields/derivation, retrieval endpoints.
4. **Revert** — plan-only revert-to-revision (new revision, audit event, progress
   preserved), confirmation, UI warning.
5. **Expanded model** — plan + execution fields, discriminated expected outputs,
   step → buildables (with server-derived build cost) models with stable ids +
   merge-forward (by step + buildable id), blocked fields.
6. **Foreman tools + REST API** — create (no auto-supersede), propose-completion,
   revise/block/unblock/supersede/create-child; full Pioneer REST surface.
7. **Opportunities** — cross-MCP population (game-data world tools + save player
   location + collected-state reconciliation), two collectible groups, distances
   in cm stored / metres shown.
8. **Parent/child** — relationship fields, child creation, parent navigation,
   auto-unblock on child resolution.
9. **UI execution panel** — built against this API in Phase 3 (designed
   separately).
