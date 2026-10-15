# Crash-site loot & drop-pod unlock costs ([upstream #107](https://github.com/StuartMeeks/ficsit-foreman/issues/107))

> Status: **shipped** — the datasets and MCP tools below (`list_parts` / `nearest_parts`,
> `get_nearby_parts`, drop-pod `unlockCost`) are live. Retained as the design of record.

Design of record for surfacing two new, **fully static** world datasets to the pioneer:

1. **Loose crash-site parts** — the ~703 `FGItemPickup_Spawnable` actors strewn around crash
   sites (free high-tier parts: Computers, Heavy Modular Frames, Motors, …). Answers *"where can
   I grab a part I can't craft yet?"*.
2. **Drop-pod unlock costs** — what each of the 118 hard-drive crash sites (`BP_DropPod_C`)
   requires to open: an item cost and/or a power cost (or nothing). Answers *"what do I need to
   bring to open that crash site?"*.

Both are deterministic and identical across games (per the wiki and confirmed by extraction), so
they live in the static **world-locations dataset** — no save is needed for coverage. A save is
used only to subtract what the pioneer has already grabbed.

## Investigation summary (why this is possible)

Verified with throwaway CUE4Parse probes against the packaged UE5.6 assets, cross-checked against a
real save. Full detail in the `#107` issue thread; the load-bearing facts:

- **Loose parts.** All 703 are the native class `FGItemPickup_Spawnable`. On the placed instance,
  `mPickupItems.Item` is **null** (the cell references no `Desc_*`), but `NumItems` (the real
  amount), `RootComponent.RelativeLocation`, and `mItemPickupGuid` are present. **The item type is
  recovered from the pickup's static mesh**: each pickup's `mMeshComponent.StaticMesh` equals the
  item descriptor's `mConveyorMesh`. Building a `mConveyorMesh → Desc_*_C` map and reverse-looking
  up resolved **699/703**, matching the save **exactly** (e.g. pickup `…1363267337` → `Desc_Computer_C` ×26
  both statically and in-save). The 4 gaps (Medkit, rifle ammo, Supercomputer) and a few meshes
  shared by multiple descriptors are handled by the disambiguation rules below.
- **Drop-pod costs.** Each `BP_DropPod_C` carries a per-instance `mUnlockCost` struct, statically
  present. Read it by the **presence of its sub-fields** (the `CostType` enum is omitted at its
  default value, so it is unreliable and must be ignored):
  - `ItemCost { ItemClass: Desc_*_C, Amount: int }` — an item requirement, when present.
  - `PowerConsumption: float` (megawatts) — a power requirement, when present.
  - A pod may have an item cost, a power cost, **both** (common — e.g. IronScrew ×10 + 30 MW), or
    neither (18 of 118 have no `mUnlockCost` and are free).

## Dataset changes (`packages/sf-game-data`)

Extend `src/world/types.ts` and the bundled `data/<channel>/sf-game-data.json`.

### New: loose crash-site parts

```ts
/** A loose crash-site part pickup (FGItemPickup_Spawnable). Collected once, then gone. */
export interface LootPickup {
  id: string;                 // stable in-level instance name — the key for collected status
                              // (a save lists collected parts in each sublevel's `collectables`, by name)
  guid: string;               // mItemPickupGuid (32 hex) — actor identity
  itemClass: string;          // Desc_*_C (resolved via the mesh→descriptor map)
  amount: number;             // NumItems
  x: number; y: number; z: number;  // RootComponent.RelativeLocation (cm)
}
```

Add `lootPickups: LootPickup[]` to `WorldLocations`, and `counts.crashSitePart` (= `lootPickups.length`).

### Changed: drop-pod unlock cost on hard-drive collectibles

Add an optional `unlock` to `Collectible` (populated only for `kind: 'hardDrive'`; absent ⇒ free):

```ts
export interface UnlockCost {
  item?: { itemClass: string; amount: number };  // ItemCost
  powerMW?: number;                                // PowerConsumption (MW)
}
// Collectible gains:  unlock?: UnlockCost;
```

This is additive and backward-compatible; the existing `hardDrive` count (118) is unchanged.

## Extractor changes (`packages/sf-game-data/extract/fg-extract/Program.cs`)

The mesh→item map and the two passes fold into the existing C# extractor (run on the Windows host
per `packages/sf-game-data/extract/README.md`).

1. **Build `mConveyorMesh → Desc_*_C` map.** Scan item + equipment descriptor assets; read
   `mConveyorMesh` (with a small fallback set for the items whose pickup uses a non-conveyor mesh —
   Medkit, rifle ammo, Supercomputer). **Disambiguation** for meshes shared by >1 descriptor:
   - Prefer **solid-form** item descriptors (skip fluids/gases via `mForm`) and skip buildable
     descriptors — this removes nearly all collisions (fluids/buildables share generic meshes).
   - For any residual ambiguous mesh, a small **curated override** map (auditable, fixed per build).
   - **Acceptance gate:** the resolved item for every pickup that also appears in the test save
     (`~/saves/*.sav`, ~66 pickups) must equal the save's resolved item. All 703 must resolve.
2. **Loose-parts pass.** For each `FGItemPickup_Spawnable`: resolve item via the mesh map; read
   `NumItems`, location, `mItemPickupGuid`; emit a `LootPickup`. Reuse existing `Loc`/`GuidFor`.
3. **Drop-pod pass.** While emitting each `hardDrive` collectible, read `mUnlockCost` → set
   `unlock.item` / `unlock.powerMW` by presence (ignore `CostType`).
4. **Sanity counts** printed alongside the existing ones: `crashSitePart` 703, and a breakdown of
   pod unlock costs (item-only / power-only / both / free).

### Validator (`.github/scripts/check-game-data.mjs`)

- Tally `lootPickups` (kind `crashSitePart`) alongside `collectibles`/`resourceNodes` so
  `counts.crashSitePart` must equal the array length.
- Add `crashSitePart: 703` to `KNOWN_COLLECTIBLE_TOTALS` (the completeness oracle).
- `unlock` needs no count check (it's a field on existing hard-drive entries).

## MCP tools

### Game-data tools (static world data; now served by `sf-mcp`)

- **`nearest_parts(coord, itemClass?, n?)`** — mirrors `nearest_collectibles`/`nearest_resource_nodes`
  in `src/world/queries.ts` + `src/tools/index.ts`. Returns the `n` nearest loose parts (optionally
  filtered by item, matched on class or display name) with item display name, amount, distance, and
  bearing. Add `listParts(itemClass?)` for totals + per-item breakdown.
- Surface `unlock` on the existing collectible queries so a hard-drive result can show its cost.

### Save-game tools (save-aware: subtract what's grabbed; now served by `sf-mcp`)

- **`get_nearby_parts(location, item?, radius?, limit?, savePath?)`** — **un-grabbed** loose parts
  near the pioneer (item, amount, distance (m), bearing). **How collected parts are excluded
  (verified):** loose-part pickups are NOT in `FGScannableSubsystem.mDestroyedPickups` (that tracks
  collectibles only) — instead a save records collected parts in each sublevel's **`collectables`**
  list, by path/instance name. The normaliser collects those into `SaveState.collectedLootIds`; the
  tool drops any `lootPickups[].id` in that set. This is **map-wide and complete** (verified on a
  near-complete save: 637 collected + 66 present = 703, zero gaps/overlap), not just explored cells.
- Surface each nearby hard drive's `unlock` cost (item and/or MW) on the existing `get_nearby`
  output (item class resolved to a display name), so the foreman can say *"that crash site needs 5
  Modular Frames"*. (Collectible exclusion still uses `mDestroyedPickups` — that part is unchanged.)

A thin `packages/ff-server` passthrough is added only if the client cannot reach these tools directly.

## Out of scope / non-goals

- No client UI here — that is the collectibles/explore work ([upstream #118](https://github.com/StuartMeeks/ficsit-foreman/issues/118)) consuming these tools.
- `CostType` is deliberately not stored (unreliable; presence of sub-fields is the source of truth).
- Coordinates stay in centimetres in the dataset (the MCP layer converts to metres, as today).

## Verification

- **Extractor:** regenerated `sf-game-data.json` passes `check-game-data.mjs`; all 703 loose
  parts resolve an item; the save cross-check (≈66 explored pickups) matches item + amount exactly;
  pod unlock breakdown looks sane (≈18 free, the rest item/power/both).
- **Game-data tools:** `nearest_parts` returns item + amount + distance + bearing; hard-drive
  queries include `unlock`.
- **Save-game tools:** `get_nearby_parts` against a real save excludes already-grabbed parts via the
  `collectables` record (verified: heavily-played save → 66 of 703 remaining; lightly-played →
  698); nearby hard drives show their unlock cost with the item name resolved.
