/**
 * The clean, serialisable model the MCP tools answer over. Nothing downstream of
 * `normaliseSave` sees a raw `typePath`, tagged-property wrapper, or Unreal class
 * path — only these records. The model carries **raw class names only**; resolving
 * them to display names (authored game-data names, or a humanised fallback) is the
 * consumer's job at the edge (`sf-mcp`), keeping this library game-data-agnostic.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface InventoryStack {
  /** Item class name, e.g. `Desc_IronPlate_C`. */
  itemClass: string;
  quantity: number;
}

export type Inventory = InventoryStack[];

export interface PlayerState {
  location?: Vec3;
  hubLocation?: Vec3;
  inventory: Inventory;
}

export interface StorageContainer {
  /** Stable per-save actor instance name — the join key to `topology` and the graph. */
  instanceName: string;
  buildingClass: string;
  location?: Vec3;
  inventory: Inventory;
}

export interface UnlockedRecipe {
  recipeClass: string;
  isAlternate: boolean;
}

export type MilestoneKind = 'milestone' | 'tutorial' | 'other';

export interface Milestone {
  schematicClass: string;
  /** Milestone tier (1–9) where derivable from the class name. */
  tier?: number;
  kind: MilestoneKind;
}

export interface AssemblyPhase {
  /** Current Project Assembly / Space Elevator phase number, if derivable. */
  phase?: number;
  current?: string;
  target?: string;
}

/**
 * A recipe-running factory machine, as read from the save (no game-data join yet).
 * This is the machine's *configuration* — recipe, clock and somersloop boost — from
 * which the query layer derives theoretical throughput and estimated power. What the
 * machine is actually fed/producing (belts, pipes, power) is out of scope here — see
 * the actual-production graph issue.
 */
export interface ProducerLine {
  /** Stable per-save actor instance name — the join key to `topology` and the graph. */
  instanceName: string;
  /** Building class, e.g. `Build_ConstructorMk1_C`. */
  buildingClass: string;
  /** Recipe class the machine is set to, e.g. `Recipe_IronPlate_C`. Undefined = unconfigured. */
  recipeClass?: string;
  /** Clock speed as a fraction (1 = 100%); defaults to 1 when the save omits it. */
  clockSpeed: number;
  /** Somersloop output multiplier (1 = none); defaults to 1 when omitted. */
  productionBoost: number;
  location?: Vec3;
}

/** A resource extractor (miner / pump / fracking). Output is the node's resource. */
export interface ExtractorLine {
  /** Stable per-save actor instance name — the join key to `topology` and the graph. */
  instanceName: string;
  buildingClass: string;
  clockSpeed: number;
  productionBoost: number;
  location?: Vec3;
}

/**
 * A power generator (biomass / coal / fuel / nuclear / geothermal), as read from the
 * save. It burns fuel rather than running a recipe (no somersloop), so this captures
 * only its configuration; MW output is a game-data join (`powerProduction × clock`,
 * linear in clock) made at the query layer. Geothermal has no `fuelClass` and a
 * variable, purity-dependent output.
 */
export interface GeneratorLine {
  /** Stable per-save actor instance name — the join key to `topology` and the graph. */
  instanceName: string;
  /** Building class, e.g. `Build_GeneratorFuel_C`. */
  buildingClass: string;
  /** Clock speed as a fraction (1 = 100%); defaults to 1 when the save omits it. */
  clockSpeed: number;
  /** Item class currently being burned, e.g. `Desc_Coal_C`. Undefined for geothermal / unfuelled. */
  fuelClass?: string;
  location?: Vec3;
}

/**
 * A Power Storage (battery), as read from the save. It charges on circuit surplus and
 * discharges on deficit, buffering the grid — so a circuit with charged batteries can
 * survive a momentary over-draw. `chargeMWh` is the raw `mPowerStore`; full capacity
 * (MWh) is a game-data join made at the query layer (a full Mk1 reads 100).
 */
export interface BatteryLine {
  /** Stable per-save actor instance name — the join key to `topology` and the graph. */
  instanceName: string;
  /** Building class, e.g. `Build_PowerStorageMk1_C`. */
  buildingClass: string;
  /** Stored energy — the raw `mPowerStore` (a full Power Storage Mk1 reads 100 ≈ 100 MWh). */
  chargeMWh: number;
  location?: Vec3;
}

export interface ProductionState {
  producers: ProducerLine[];
  extractors: ExtractorLine[];
  generators: GeneratorLine[];
  /** Power Storage (batteries) buffering the grid. */
  batteries: BatteryLine[];
}

/**
 * A buildable actor (machine, belt, splitter, pipe, power pole, …) as a graph node.
 * This is the **complete** node set — every `Build_*` actor, including the
 * intermediate belts/splitters/poles that carry no domain record — so the
 * connection graph stays traversable end-to-end. Raw class-name keys only.
 */
export interface BuildableActor {
  /** Unique per-save instance name. */
  instanceName: string;
  /** Raw class-name key (the type-path tail), e.g. `Build_ConstructorMk1_C`. */
  classKey: string;
  /** World position in centimetres, if the actor carries a transform. */
  location?: Vec3;
}

/** The kinds of physical link recorded in the topology. Power is grouped separately (see `PowerCircuit`). */
export type EdgeKind = 'conveyor' | 'pipe';

/**
 * One physical connection between two actors, resolved from the connection
 * components that declare it. The link is **undirected** as stored — `from`/`to`
 * are canonically ordered (by component path), not a flow direction. The
 * connector-name tails (`Output0`/`Input0`/`ConveyorAny0`) are retained so
 * consumers can infer flow direction; belt connectors are deliberately ambiguous
 * in the save.
 */
export interface ConnectionEdge {
  kind: EdgeKind;
  /** Owner actor instance name of one endpoint (canonically the smaller component path). */
  from: string;
  /** Owner actor instance name of the other endpoint. */
  to: string;
  /** The `from` connection component's name tail (e.g. `Output0`). */
  fromConnector: string;
  /** The `to` connection component's name tail. */
  toConnector: string;
  /** Pipe network id (`mPipeNetworkID`); present on pipe edges only. */
  networkId?: number;
}

/**
 * A power circuit, pre-grouped by the game (`FGPowerCircuit.mCircuitID` +
 * `mComponents`). Members are the actor instance names whose power connections
 * belong to the circuit — no traversal needed.
 */
export interface PowerCircuit {
  circuitId: number;
  members: string[];
}

/**
 * The filter category of a smart/programmable splitter output rule. `item` routes a
 * specific item (see `itemClass`); the rest are the special `FilteringRules` classes:
 * `any` (Wildcard — anything), `anyUndefined` (anything not matched by another rule),
 * `overflow` (only when other outputs back up), `none` (nothing).
 */
export type SplitterRuleKind = 'item' | 'any' | 'anyUndefined' | 'overflow' | 'none';

/** One output-routing rule on a smart/programmable splitter (raw class names only). */
export interface SplitterRule {
  /** The output this rule routes to (0-based; left/centre/right are 0/1/2). */
  outputIndex: number;
  /** The item descriptor class routed, present only when `rule === 'item'` (e.g. `Desc_Wire_C`). */
  itemClass?: string;
  /** The filter category. */
  rule: SplitterRuleKind;
}

/**
 * A smart or programmable splitter's conditional output routing (`mSortRules`). Plain
 * splitters/mergers carry none and never appear here. Kept as a separate
 * `topology.splitters` list keyed by `instanceName` so `BuildableActor` stays minimal.
 */
export interface SplitterConfig {
  /** Owner splitter actor instance name (joins to a `BuildableActor`). */
  instanceName: string;
  /** Raw class-name key — distinguishes smart from programmable. */
  classKey: string;
  /** The routing rules, in save order. */
  rules: SplitterRule[];
}

/**
 * The factory's connectivity, exactly as the save stores it: the complete set of
 * buildable actors (nodes), the conveyor/pipe links between them (edges), the
 * pre-grouped power circuits, and the smart/programmable splitter routing rules.
 * This is the relational fact layer; the in-memory adjacency/BFS index over it lives
 * in `@foreman/sf-save-data-graph`, which is a pure projection of this data.
 */
export interface TopologyState {
  buildables: BuildableActor[];
  edges: ConnectionEdge[];
  powerCircuits: PowerCircuit[];
  /** Smart/programmable splitter output-routing rules; empty for saves with none. */
  splitters: SplitterConfig[];
}

/**
 * Resource-node randomisation mode (1.2 Advanced Game Settings → Game Modes), as the
 * raw enum literal with its `NRM_` prefix stripped. `'None'` is the default (off).
 * UI labels (e.g. `Strict` → "Random") are resolved at the edge, not here.
 */
export type NodeRandomizationMode =
  'None' | 'Strict' | 'BasicReach' | 'AdvancedRich' | 'FossilFuelRich';

/**
 * Resource-node purity setting (Game Modes), raw enum literal with its `NPS_` prefix
 * stripped. `'NoChange'` is the default (off). `Increase`/`Decrease` are the UI's
 * "Mostly Pure"/"Mostly Impure".
 */
export type NodePuritySetting =
  'NoChange' | 'AllPure' | 'Increase' | 'AllNormal' | 'Decrease' | 'AllImpure' | 'AllRandom';

/**
 * The six per-world **Game Modes** settings (1.2 Advanced Game Settings), read raw
 * from `BP_GameState_C`. Pure save facts — no game-data join (the overlay onto
 * canonical recipe/power/node data happens at the edge, `sf-mcp`). Each field
 * defaults independently when its property is absent (the game omits defaults), so
 * a pre-1.2 or all-default save yields {@link DEFAULT_ADVANCED_GAME_SETTINGS} and
 * the overlay is a no-op. See `docs/advanced-game-settings.md`.
 */
export interface AdvancedGameSettings {
  /** World seed driving node randomisation; default 0. */
  worldSeed: number;
  /** Space-elevator deliverable cost multiplier; default 1. */
  spaceElevatorCostMultiplier: number;
  /** Recipe parts cost multiplier; default 1. */
  recipeCostMultiplier: number;
  /** Power consumption multiplier; default 1. */
  powerConsumptionMultiplier: number;
  /** Resource-node randomisation mode; default `'None'` (off). */
  nodeRandomization: NodeRandomizationMode;
  /** Resource-node purity setting; default `'NoChange'` (off). */
  nodePuritySettings: NodePuritySetting;
}

/** Canonical (off) Game Modes settings — the no-op overlay state for pre-1.2/default saves. */
export const DEFAULT_ADVANCED_GAME_SETTINGS: AdvancedGameSettings = {
  worldSeed: 0,
  spaceElevatorCostMultiplier: 1,
  recipeCostMultiplier: 1,
  powerConsumptionMultiplier: 1,
  nodeRandomization: 'None',
  nodePuritySettings: 'NoChange',
};

/** Resolved resource-node purity (the game's `EResourcePurity`, normalised). */
export type ResourcePurity = 'impure' | 'normal' | 'pure';

/**
 * A resource node's **resolved** type/purity under node randomisation, read directly
 * from the save (`mResourceClassOverride` + `mPurityOverride`) — so no seed-RNG
 * reproduction is needed. Empty list when randomisation is off. `position` is the
 * join key to the bundled world `resourceNodes` (the runtime instance name is not
 * stable against static extraction); matched by nearest position at the edge.
 */
export interface ResourceNodeOverride {
  /** World position from the actor transform — the join key to the world dataset. */
  position?: Vec3;
  /** Resolved resource descriptor class, e.g. `Desc_Coal_C` (undefined if unreadable). */
  resourceClass?: string;
  /** Resolved purity (undefined if unreadable). */
  purity?: ResourcePurity;
}

/**
 * The **Creative Mode** Advanced Game Settings, read raw from across `BP_GameState_C`,
 * the local player's `mPlayerRules`, and `FGGameRulesSubsystem`. Pure save facts —
 * the effective-state overlay (no-power circuits, zero build cost, expanded unlocked
 * set, granted tier/phase) happens at the edge (`sf-mcp`). Every field defaults
 * independently when absent (the rules only persist when creative is on), so a
 * non-creative save yields {@link DEFAULT_CREATIVE_MODE_SETTINGS} and every overlay is
 * a no-op. `enabled` mirrors the header's `creativeModeEnabled` — the authoritative
 * flag (the body `mIsCreativeModeEnabled` reads false even on creative saves). The
 * cheats are per-player; the local/first player's rules are used. `startingTier` and
 * the set game phase manifest in the normal milestone / `assemblyPhase` state.
 * See `docs/advanced-game-settings.md`.
 */
export interface CreativeModeSettings {
  /** Creative Mode active for this save (header `creativeModeEnabled`). */
  enabled: boolean;
  /** No Power — machines run without power. */
  noPower: boolean;
  /** No Fuel — generators/vehicles run without fuel. */
  noFuel: boolean;
  /** No Build Cost — building consumes no materials. */
  noBuildCost: boolean;
  /** Flight Mode. */
  flightMode: boolean;
  /** God Mode. */
  godMode: boolean;
  /** No Unlock Cost — milestones/MAM/shop cost nothing. */
  noUnlockCost: boolean;
  /** Alternate recipes unlock instantly. */
  unlockInstantAltRecipes: boolean;
  /** All MAM research unlocked. */
  unlockAllResearch: boolean;
  /** All AWESOME-shop schematics unlocked. */
  unlockAllShop: boolean;
  /** Arachnid creatures disabled (arachnophobia mode). */
  disableArachnids: boolean;
  /** Starting tier granted (0 = none / default). */
  startingTier: number;
}

/** Canonical (off) Creative Mode settings — the no-op overlay state for non-creative saves. */
export const DEFAULT_CREATIVE_MODE_SETTINGS: CreativeModeSettings = {
  enabled: false,
  noPower: false,
  noFuel: false,
  noBuildCost: false,
  flightMode: false,
  godMode: false,
  noUnlockCost: false,
  unlockInstantAltRecipes: false,
  unlockAllResearch: false,
  unlockAllShop: false,
  disableArachnids: false,
  startingTier: 0,
};

export interface SaveState {
  /** Detected game version (build number, with save version), or 'unknown'. */
  version: string;
  /** Save session name, or the file base name. */
  saveName: string;
  /** Raw in-game session name from the header (undefined if absent). */
  sessionName?: string;
  /** Map name from the header, e.g. `Persistent_Level` (undefined if absent). */
  mapName?: string;
  /** Satisfactory changelist/build number from the header — comparable to game data's `build`. */
  buildVersion?: number;
  /** Save-format version from the header. */
  saveVersion?: number;
  /** Total in-game play time in seconds, if the header carries it. */
  playDurationSeconds?: number;
  /** When the game wrote the save (ISO 8601 UTC), if the header recorded it. */
  savedAt?: string;
  /** ISO timestamp of when this state was parsed. */
  parsedAt: string;
  player: PlayerState;
  storage: {
    containers: StorageContainer[];
    dimensionalDepot: Inventory;
  };
  recipes: UnlockedRecipe[];
  /** Active factory machines (recipe-runners) and resource extractors. */
  production: ProductionState;
  milestones: Milestone[];
  /**
   * The factory's connectivity — every buildable actor, the conveyor/pipe links
   * between them, and the pre-grouped power circuits. The relational substrate the
   * connection graph projects (`@foreman/sf-save-data-graph`).
   */
  topology: TopologyState;
  /** Unlocked MAM research-tree class names (e.g. `BPD_ResearchTree_AlienOrganisms_C`). */
  mamResearch: string[];
  assemblyPhase?: AssemblyPhase;
  /**
   * The six per-world **Game Modes** settings (1.2 Advanced Game Settings). Always
   * present — {@link DEFAULT_ADVANCED_GAME_SETTINGS} for pre-1.2/all-default saves.
   */
  advancedGameSettings: AdvancedGameSettings;
  /**
   * Resolved per-node resource/purity overrides under node randomisation, read
   * directly from the save. Empty when randomisation is off.
   */
  resourceNodeOverrides: ResourceNodeOverride[];
  /**
   * The **Creative Mode** Advanced Game Settings. Always present —
   * {@link DEFAULT_CREATIVE_MODE_SETTINGS} for non-creative saves.
   */
  creativeMode: CreativeModeSettings;
  /**
   * GUIDs of collected collectibles (spheres/sloops/slugs), from
   * `FGScannableSubsystem.mDestroyedPickups` — matched against the world-locations
   * dataset for exact per-kind collected counts. See `collectibleProgressView`.
   */
  collectedPickupGuids: string[];
  /** GUIDs of looted hard-drive drop pods (`FGScannableSubsystem.mLootedDropPods`). */
  lootedDropPodGuids: string[];
  /**
   * Instance names of collected loose crash-site parts (`FGItemPickup_Spawnable`), taken
   * from each sublevel's `collectables` (collected/removed-actor) record. These are NOT in
   * `mDestroyedPickups` (that tracks collectibles only); they are matched against the
   * world-locations `lootPickups[].id` to drop already-grabbed parts. Map-wide and complete.
   */
  collectedLootIds: string[];
  /** Non-fatal issues collected during normalisation. */
  warnings: string[];
}

/** A valid empty state for when no save is loaded (or a parse failed). */
export function emptySaveState(version: string, saveName: string, parsedAt: string): SaveState {
  return {
    version,
    saveName,
    parsedAt,
    player: { inventory: [] },
    storage: { containers: [], dimensionalDepot: [] },
    recipes: [],
    production: { producers: [], extractors: [], generators: [], batteries: [] },
    milestones: [],
    topology: { buildables: [], edges: [], powerCircuits: [], splitters: [] },
    mamResearch: [],
    advancedGameSettings: { ...DEFAULT_ADVANCED_GAME_SETTINGS },
    resourceNodeOverrides: [],
    creativeMode: { ...DEFAULT_CREATIVE_MODE_SETTINGS },
    collectedPickupGuids: [],
    lootedDropPodGuids: [],
    collectedLootIds: [],
    warnings: [],
  };
}
