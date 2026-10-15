# Advanced Game Settings — parse & overlay ([upstream #172](https://github.com/StuartMeeks/ficsit-foreman/issues/172))

> Status: **largely shipped** — slices A/B/C/E merged and D's numeric/state surfaces landed
> (build-cost/unlock overlays deliberately deferred as flags — see Scope D). Every persistence
> location, property type and enum value below is verified against real 1.2 saves on the VM
> (see _Test fixtures_). Design of record for [upstream #172](https://github.com/StuartMeeks/ficsit-foreman/issues/172).

## Problem

Satisfactory 1.2's per-world **Advanced Game Settings** change effective gameplay numbers
without moving anything in the world. In the in-game UI they split into two groups, **both in
scope here**:

- **Game Modes** — cost/power multipliers, a world seed, and resource-node randomisation.
- **Creative Mode** — cheats (no power/fuel/build cost, god/flight), progression grants
  (starting tier, set game phase, unlock-all), and the arachnid toggle.

The two groups are persisted in **disjoint** locations and do not interfere, but both move the
effective numbers our tools report away from canonical `gameData` / bundled `resourceNodes`.
We need to **parse** each group into `SaveState` (pure save facts) and **overlay** the
behaviourally-relevant ones so tools report *effective* costs/rates, *actual* node
types/purities, and the *effective* unlocked/progression state.

## Persistence map (verified)

| Group | Setting (UI) | Actor | Property | Type |
|---|---|---|---|---|
| Game Modes | Space Elevator Deliverable Cost × | `BP_GameState_C` | `mSpacePartsCostMultiplier` | Float |
| Game Modes | Recipe Parts Cost × | `BP_GameState_C` | `mPartsCostMultiplier` | Float |
| Game Modes | Power Consumption × | `BP_GameState_C` | `mEnergyCostMultiplier` | Float |
| Game Modes | World seed | `BP_GameState_C` | `mNodeRandomizationSeed` | Int |
| Game Modes | Resource Node Randomization | `BP_GameState_C` | `mNodeRandomization` | Enum `ENodeRandomizationMode` |
| Game Modes | Resource Node Purity | `BP_GameState_C` | `mNodePuritySettings` | Enum `ENodePuritySettings` |
| Creative | (master) Creative enabled | `BP_GameState_C` | `mIsCreativeModeEnabled` | Bool |
| Creative | No Power | `BP_GameState_C` | `mCheatNoPower` | Bool |
| Creative | No Fuel | `BP_GameState_C` | `mCheatNoFuel` | Bool |
| Creative | No Build Cost | `BP_PlayerState_C.mPlayerRules` | `NoBuildCost` | Bool |
| Creative | Flight Mode | `BP_PlayerState_C.mPlayerRules` | `FlightMode` | Bool |
| Creative | God Mode | `BP_PlayerState_C.mPlayerRules` | `GodMode` | Bool |
| Creative | No Unlock Cost | `FGGameRulesSubsystem` | `mNoUnlockCost` | Bool |
| Creative | Unlock Alt Recipes Instantly | `FGGameRulesSubsystem` | `mUnlockInstantAltRecipes` | Bool |
| Creative | Unlock All MAM Research | `FGGameRulesSubsystem` | `mUnlockAllResearchSchematics` | Bool |
| Creative | Unlock All AWESOME Shop | `FGGameRulesSubsystem` | `mUnlockAllResourceSinkSchematics` | Bool |
| Creative | Starting Tier | `FGGameRulesSubsystem` | `mStartingTier` | Int |
| Creative | Arachnid Creatures | `FGGameRulesSubsystem` | `mDisableArachnidCreatures` | Bool |
| Creative | Set Game Phase | `BP_GamePhaseManager_C` | `mCurrentGamePhase` / `mTargetGamePhase` | ObjRef → `GP_Project_Assembly_Phase_*` |

Notes:

- The Game Modes settings are **not** in the save header, **not** in `mapOptions`
  (client-identity/onboarding only), and **not** in `FGGameRulesSubsystem`.
- `FGGameRulesSubsystem` is **empty (`mHasInitialized` only) until Creative Mode is on** —
  the Creative rules only populate then. The header bool `creativeModeEnabled` mirrors
  `mIsCreativeModeEnabled`.
- `mPlayerRules` is **per-player** (a struct on each `BP_PlayerState_C`); for our
  single-player focus, take the local/first player and note the limitation.
- **Every property is individually omitted when default** (both groups), so defaulting is
  **per-property**: a save sets only what was changed. Pre-1.2 and all-default saves carry
  none → parse to defaults → every overlay is a no-op.

### Game Modes — value details

The three multipliers are **free `Float`s, not enums** — the UI dropdown only constrains what
is offered; the save stores the chosen value verbatim. Defaults: multipliers `1`, seed `0`,
`mNodeRandomization` `NRM_None`, `mNodePuritySettings` `NPS_NoChange`.

#### `ENodeRandomizationMode` → UI label
| Literal | UI label |
|---|---|
| `NRM_None` | Default (off) |
| `NRM_Strict` | Random |
| `NRM_BasicReach` | Basic Resource Rich |
| `NRM_AdvancedRich` | Advanced Resource Rich |
| `NRM_FossilFuelRich` | Fossil Fuel Rich |

#### `ENodePuritySettings` → UI label
| Literal | UI label |
|---|---|
| `NPS_NoChange` | Default (off) |
| `NPS_AllPure` | All Pure |
| `NPS_Increase` | Mostly Pure |
| `NPS_AllNormal` | Average |
| `NPS_Decrease` | Mostly Impure |
| `NPS_AllImpure` | All Impure |
| `NPS_AllRandom` | Random |

(`*_MAX` are UE sentinels — not selectable. Labels confirmed in-game; membership/order read
from the shipped `FactoryGame.usmap`. Per-node `EResourcePurity` = `RP_Inpure` / `RP_Normal`
/ `RP_Pure` — note the game's own misspelling of *impure*.)

### The resource-node question — resolved

**The save records each node's resolved state directly, so no seed-RNG reproduction is
needed.** Every `BP_ResourceNode_C` (and fracking satellite/core) under randomisation carries
`mResourceClassOverride` (ObjectProperty → `Desc_*_C`) and `mPurityOverride` (`EResourcePurity`).
Verified 459/459 standard nodes in both randomisation fixtures. The seed is **informational
only**; join key to the bundled world dataset is the node's **`transform.translation`** (the
runtime `instanceName` is not stable against static extraction), matched by nearest position.

## Scope A — parse Game Modes (`sf-save-data`, pure)

- `state.advancedGameSettings: AdvancedGameSettings`:
  ```ts
  interface AdvancedGameSettings {
    worldSeed: number;                        // mNodeRandomizationSeed; default 0
    spaceElevatorCostMultiplier: number;      // default 1
    recipeCostMultiplier: number;             // default 1
    powerConsumptionMultiplier: number;       // default 1
    nodeRandomization: NodeRandomizationMode; // 'None'|'Strict'|'BasicReach'|'AdvancedRich'|'FossilFuelRich'; default 'None'
    nodePuritySettings: NodePuritySetting;    // 'NoChange'|'AllPure'|'Increase'|'AllNormal'|'Decrease'|'AllImpure'|'AllRandom'; default 'NoChange'
  }
  ```
  Store the enum **literal with prefix stripped** (no `off`/`random` flattening — that loses
  modes). Label lookup lives in the consumer / `sf-present`.
- `state.resourceNodeOverrides: ResourceNodeOverride[]` — `{ position, resourceClass, purity }`,
  purity normalised to `'impure' | 'normal' | 'pure'`. Empty when randomisation is off.

## Scope B — overlay Game Modes (`sf-mcp`)

Behind the existing **`getEffectiveGameData(state, game)`** seam
(`sf-mcp/src/query/effectiveGameData.ts`, introduced by [upstream #148](https://github.com/StuartMeeks/ficsit-foreman/issues/148)):

- **Recipe parts ×** — multiply `requiredInputs` (ingredient rates) by `recipeCostMultiplier`;
  outputs unchanged. *(shipped — in the seam)*
- **Power ×** — consumer draw × `powerConsumptionMultiplier` (threaded through
  `estimatePower`/`consumerDrawMW`); **consumers only**, generators unaffected. *(shipped)*
- **Node type/purity** — `resourceNodeOverrides` matched to an extractor by nearest position
  in `resolveExtraction` take precedence over the canonical (bundled) node. *(shipped)*
- **Space Elevator deliverable ×** — shipped in **slice E**. The project-assembly phase
  deliverable costs were cooked-asset-only (not in `en-US.json`), so the extractor now reads
  them from the `FGGamePhase` (`GP_Project_Assembly_Phase_N`) assets' `mCosts` into
  `gameData.projectAssemblyPhases`; `get_milestones` surfaces them with effective costs
  (base × `spaceElevatorCostMultiplier`), marking the current phase. Base (default) costs:

  | Phase | Name | Deliverable cost |
  |---|---|---|
  | 1 | Distribution Platform | 50 Smart Plating |
  | 2 | Construction Dock | 1,000 Smart Plating · 1,000 Versatile Framework · 100 Automated Wiring |
  | 3 | Main Body | 2,500 Versatile Framework · 500 Modular Engine · 100 Adaptive Control Unit |
  | 4 | Propulsion | 500 Assembly Director System · 500 Magnetic Field Generator · 250 Thermal Propulsion Rocket · 100 Nuclear Pasta |
  | 5 | Assembly | 1,000 Nuclear Pasta · 1,000 Biochemical Sculptor · 256 AI Expansion Server · 200 Ballistic Warp Drive |

## Scope C — parse Creative Mode (`sf-save-data`, pure)

- `state.creativeMode: CreativeModeSettings`:
  ```ts
  interface CreativeModeSettings {
    enabled: boolean;                       // mIsCreativeModeEnabled (mirrors header creativeModeEnabled)
    noPower: boolean;                       // mCheatNoPower
    noFuel: boolean;                        // mCheatNoFuel
    noBuildCost: boolean;                   // mPlayerRules.NoBuildCost (local player)
    flightMode: boolean;                    // mPlayerRules.FlightMode
    godMode: boolean;                       // mPlayerRules.GodMode
    noUnlockCost: boolean;                  // mNoUnlockCost
    unlockInstantAltRecipes: boolean;       // mUnlockInstantAltRecipes
    unlockAllResearch: boolean;             // mUnlockAllResearchSchematics
    unlockAllShop: boolean;                 // mUnlockAllResourceSinkSchematics
    disableArachnids: boolean;              // mDisableArachnidCreatures
    startingTier: number;                   // mStartingTier; default 0
  }
  ```
  All bools default `false`, `startingTier` `0`, per-property (the actor is absent / fields
  omitted when off). "Set Game Phase" is **not** a new field — it manifests as the normal
  `assemblyPhase`/phase progression already parsed; record only that we read the same source.

## Scope D — overlay Creative Mode (`sf-mcp`, full)

An overlay only bites where a tool reports the affected number. Mapping the settings to the
actual sf-mcp surfaces:

**Shipped (real numeric / state surface):**

- **No Power** (`noPower`) — effective consumer power draw → 0 (folded into the power path via
  `effectivePowerMultiplier`): `get_power` and `find_bottlenecks` report 0 consumption / every
  circuit `ok`, generators untouched.
- **Progression awareness** (`startingTier`, `unlockAllResearch`, `unlockAllShop`,
  `unlockInstantAltRecipes`, `noUnlockCost`) — surfaced on `get_milestones` as a `creative`
  block (present only when creative is on), so the foreman knows the effective unlocked state
  is broader and unlocks are free. `creativeModeEnabled` is also added to `describe_save`.

**No sf-mcp surface yet (parsed, documented, not overlaid):**

- **No Build Cost** (`noBuildCost`) — no save tool reports build costs (that's an `ff-server`
  work-order concern); apply there when work-order costing reads game data.
- **No Unlock Cost** (`noUnlockCost`) — milestone/MAM/shop *unlock costs* aren't surfaced by a
  save tool (only the hard-drive drop-pod open-cost is, which is a different thing). The flag is
  surfaced for awareness via the `get_milestones` `creative` block.
- **No Fuel** (`noFuel`) — generator fuel isn't modelled as flow demand (`find_bottlenecks`
  reconciles material flow between producers/extractors), so there is no constraint to drop.
- **god/flight/arachnid** — parsed for completeness; no tool relevance.

The "effective unlocked set" expansion (treating every recipe/research as unlocked under
unlock-all) is deliberately *surfaced as flags* rather than fabricated into the unlocked lists —
the foreman reads the flags and reasons, avoiding a misleading "you have unlocked X" for things
the pioneer never actually researched. A non-creative save leaves every overlay a no-op.

## Test fixtures (under `~/saves/` on the VM)

| Save | Covers |
|---|---|
| `Test Save - Randomization_270626-200340.sav` | Game Modes only; `space×10 parts×1.5 power×2`, seed `2025976192`, `NRM_Strict` / `NPS_AllRandom`; 459/459 node overrides. |
| `Test - Creative and Game Mode_290626-204150.sav` | Creative *on* (Starting Tier 6, Game Phase set) **and** all six Game Modes non-default; `space×25 parts×1.75 power×5`, seed `2020733184`, `NRM_AdvancedRich` / `NPS_Increase`. Strongest fixture. |
| `star-date-batteries.sav` (vanilla), `splitter-pipes.sav` / `splitter-index.sav` (creative) | All-default → no-op overlays. |

> A dedicated fixture with the Creative **cheat toggles** (No Power / No Build Cost / God /
> Flight) set to `true` would strengthen Scope D tests — the combo save has them `false`. Ask
> for one when implementing Scope D.

### Acceptance criteria

- Parsing `Test Save - Randomization…` yields exactly `worldSeed=2025976192`,
  `spaceElevatorCostMultiplier=10`, `recipeCostMultiplier=1.5`, `powerConsumptionMultiplier=2`,
  `nodeRandomization='Strict'`, `nodePuritySettings='AllRandom'`.
- Parsing `Test - Creative and Game Mode…` yields `creativeMode.enabled=true`,
  `startingTier=6`, and the Game Modes values above for that save.
- Overlay on a known recipe/building shows multiplied input rate / power; a creative save
  surfaces its flags (no-build-cost / no-unlock-cost / unlock-all) on `get_milestones` for
  foreman *awareness* — deliberately **not** mutating cost or unlocked-set lists (see Scope D);
  an all-default save is a no-op.

## Out of scope

- Reproducing node randomisation purely from the seed — unnecessary; resolved per-node state
  is persisted.

## Plan (slices)

1. **A** — parse Game Modes → `advancedGameSettings` + `resourceNodeOverrides` (+ all-default
   no-op test). ✅ shipped ([upstream #198](https://github.com/StuartMeeks/ficsit-foreman/issues/198))
2. **C** — parse Creative Mode → `creativeMode` (per-property defaults, local-player rules).
   ✅ shipped ([upstream #199](https://github.com/StuartMeeks/ficsit-foreman/issues/199))
3. **B** — Game Modes overlay in `getEffectiveGameData` (recipe×, power×, node type/purity).
   ✅ shipped — space-elevator× split to E.
4. **D** — Creative overlay. ✅ shipped (numeric/state surfaces): `effectivePowerMultiplier`
   (no-power → 0), the `creative` block on `get_milestones`, and `creativeModeEnabled` on
   `describe_save`. Build-cost / unlock-cost / unlock-set are deliberately surfaced as flags,
   not overlaid (see Scope D above).
5. **E** — Space-elevator deliverable cost ×: extract `GP_Project_Assembly_Phase_*` `mCosts` in the
   game-data extractor → `gameData.projectAssemblyPhases`, surface in `get_milestones`, apply
   `spaceElevatorCostMultiplier`. ✅ shipped — dataset regenerated (v1.2.3.1 / build 495413).

Each slice is its own PR linking [upstream #172](https://github.com/StuartMeeks/ficsit-foreman/issues/172); A and C are independent (parallelisable), B depends on
A, D depends on C; E depends on a game-data extractor change + dataset regen.
