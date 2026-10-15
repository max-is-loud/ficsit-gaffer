# Explore orders ([upstream #207](https://github.com/StuartMeeks/ficsit-foreman/issues/207)) + collectible re-upload reconciliation ([upstream upstream #209-B](https://github.com/StuartMeeks/ficsit-foreman/issues/209))

> **Status:** Agreed design — the design of record for [upstream #207](https://github.com/StuartMeeks/ficsit-foreman/issues/207) and [upstream upstream #209-B](https://github.com/StuartMeeks/ficsit-foreman/issues/209). Landed before code
> per the spec-doc-per-feature convention. Where this conflicts with older notes, this wins.

## Problem

A work order is a **build contract** (steps → buildables → cost). Directing *exploration* —
"go grab those 8 power slugs / sweep the northern forest for hard drives" — is a fundamentally
different shape: a **collection route** of waypoints, each with collectibles to pick up, no
build cost, done when the chosen collectibles are collected. Forcing that into `buildSteps` is a
poor fit, so [upstream #207](https://github.com/StuartMeeks/ficsit-foreman/issues/207) introduces a second order type, the **explore order**.

[upstream #209-B](https://github.com/StuartMeeks/ficsit-foreman/issues/209) then closes the loop: when the pioneer **re-uploads a save**, an active explore order's
collectibles are **auto-reconciled** to what the save shows collected — progress tracks the game
without manual ticking. ([upstream #209-A](https://github.com/StuartMeeks/ficsit-foreman/issues/209), the same for *buildables*, is **cancelled**: matching an
abstract buildable line to concrete save instances is heuristic; collectibles are identity-keyed,
so their match is exact — the deterministic case is the one worth automating.)

## Decisions

| Question | Decision | Why |
|---|---|---|
| Entity model | **Variant of `WorkOrder`** (`orderType` discriminator + `waypoints`), not a separate entity | Reuses the state machine, revisions, audit, sequence counter, single-active invariant, and — critically — **cross-type parent/child auto-unblock** (a build order can be `blocked` on an explore child). A separate table breaks auto-unblock + single-active and duplicates the lifecycle machinery. |
| Numbering | **Shared per-playthrough counter, `EO-NNN` display label** by type | One monotonic counter (one table); the pioneer still tells a route from a build at a glance. |
| Reconciliation | **Auto-apply + `System` audit + "Save synced" banner**, monotonic | Collectible matching is exact (guid/schematic identity) and one-way (un-collected→collected), so there's no false-positive risk that would justify a confirm step. |
| Mark-collected | **REST execution mutation** (mirrors `setBuildableBuiltCount`), not a chat tool | Execution truth is Pioneer/REST-owned today; the foreman proposes, the pioneer records. |

## Model

`WorkOrder` gains a discriminator and an explore-only field; all existing fields stay (explore
orders simply leave `buildSteps`/`recipes`/`expectedOutputs` empty).

```ts
orderType: 'build' | 'explore';   // discriminator, defaults to 'build'
waypoints?: ExploreWaypoint[];    // explore only (JSON column)

type ExploreWaypoint = {
  id: string;
  order: number;                  // suggested visit order along the route
  label?: string;
  coordinates: Coordinates;       // Unreal units (cm)
  relativeToPlayer?: string;
  collectibles: ExploreCollectible[];
  notes?: string;
};

type ExploreCollectible = {
  id: string;                     // stable world instance id — the reference the foreman supplies
  kind: CollectibleKind;          // mercerSphere | somersloop | powerSlug* | hardDrive | helmet | mtape
  guid?: string;                  // GUID-keyed kinds — the identity the save records on collection
  schematic?: string;             // customizer helmet/mtape (upstream #67) — no pickup GUID; keyed by unlocked schematic
  collected: boolean;             // execution state (Pioneer-owned; upstream #209-B may raise false→true)
  coordinates?: Coordinates;
  reason?: string;
  unlockCost?: UnlockCost;        // { item?: {itemClass, amount}, powerMW? } — what a pod/site needs to OPEN
};
```

Reuses `CollectibleKind` / `Coordinates` / `UnlockCost` from the existing model — **no parallel
enum**. Every collectible carries the identity key (`guid` else `schematic`) so [upstream #209-B](https://github.com/StuartMeeks/ficsit-foreman/issues/209) matches
exactly.

**Accurate-by-construction (same standard as work orders).** `kind`, `coordinates`, `guid` /
`schematic`, and `unlockCost` are **not trusted from the model** — the foreman supplies each
collectible's `id`, and the server **derives** those facts from the world dataset at ingest via
`resolve_collectibles`, **rejecting** any `id` that isn't a real collectible (mirrors [upstream #220](https://github.com/StuartMeeks/ficsit-foreman/issues/220)/[upstream upstream #222](https://github.com/StuartMeeks/ficsit-foreman/issues/222)
name resolution and [upstream #228](https://github.com/StuartMeeks/ficsit-foreman/issues/228) rate derivation). Consequence: a hard-drive pod waypoint can **never**
ship with a missing or wrong unlock cost — if the dataset says it costs power/items to open, the
order carries that cost.

## Lifecycle & reuse

Explore orders reuse, unchanged: the full **state machine** (`workOrderTransitions.ts`),
**revisions/snapshots**, **audit trail**, the per-playthrough **sequence counter**, the
**single-active** invariant, **parent/child** linkage, and **auto-unblock** (`onChildCompleted`
keys only on `parentWorkOrderId` + state). `WorkOrderRelationshipType` already has `exploration`
/ `hard_drive_hunt`, so a build order may sit `blocked` on an explore child that resolves its
blocker. Completion is Pioneer-driven (foreman may propose); force-complete leaves some
uncollected with a summary. Progress metric: "5 / 8 collected".

New audit event: **`collectible_collected`** (actor `Pioneer` on a manual tick, `System` on
re-upload reconciliation).

## Data sourcing (cross-MCP, mirrors work-order opportunities)

The foreman populates waypoints at issue time by joining MCP facts:
- **Where collectibles are** → `nearest_collectibles` / `list_collectibles` (game-data world
  tools) — extended to emit each collectible's stable **identity** (`guid` / `schematic` / `id`)
  and its `unlock` cost, so it can be picked for a waypoint.
- **Which remain** → save-game reconciliation subtracts already-collected items, so the route
  never sends the pioneer to a collectible they already grabbed. Degrade gracefully with no save.
- **Accuracy at ingest** → the foreman supplies each waypoint collectible's `id`; the server
  calls **`resolve_collectibles`** to derive `kind` / `coordinates` / identity / `unlockCost`
  from the dataset and rejects unknown ids — so the stored facts (crucially, a pod's open cost)
  are canonical, not transcribed.

## [upstream #209-B](https://github.com/StuartMeeks/ficsit-foreman/issues/209) — reconciliation on re-upload

Predicate (already implemented): `isCollected(c, collectedGuidSet(state),
unlockedSchematicSet(state))` — GUID-keyed match against destroyed-pickups ∪ looted-pods, else
schematic-keyed match against unlocked schematics.

Flow: on `SaveService.addVersion` (after the new save becomes current), fetch the save's
collected-identity set via a savePath-gated MCP tool (**`get_collected_identities`** →
`{ guids, schematics }`); for each active/non-terminal **explore** order, flip
`ExploreCollectible.collected` **false→true** where its `guid`/`schematic` is in the set
(monotonic — never auto-uncollect, since a collectible can't return); write a `System`
`collectible_collected` audit per change; return a reconcile summary that surfaces as a
"Save synced: N collectibles collected" banner.

## Out of scope
- Buildables reconciliation ([upstream #209-A](https://github.com/StuartMeeks/ficsit-foreman/issues/209)) — cancelled (heuristic matching).
- Map / route-geometry view — a plain ordered waypoint list for now.
- Loose crash-site parts collection; explore-specific revision semantics beyond the reuse above.

## Implementation slices
1. **MCP identity plumbing** — `nearest_collectibles`/`list_collectibles` emit guid/schematic +
   unlock cost; new `resolve_collectibles` (canonical facts by id) and `get_collected_identities`;
   add `helmet`/`mtape` to the kind enums.
2. **Explore-order variant ([upstream #207](https://github.com/StuartMeeks/ficsit-foreman/issues/207))** — model + migration, `create_explore_order` tool, REST
   mark-collected, `WaypointsSection` client view, `EO-` label, prompt.
3. **Reconciliation ([upstream #209-B](https://github.com/StuartMeeks/ficsit-foreman/issues/209))** — hook `addVersion`, monotonic apply + audit + banner.
