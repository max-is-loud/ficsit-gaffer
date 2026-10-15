// Pure read-model functions behind the save tools: turn a SaveState, save graph and game-data index into the
// model-facing views (player, recipes, milestones, storage, collectibles, nearby, production, power, material coverage).

import {
  type Building,
  type Collectible,
  type CollectibleKind as WorldCollectibleKind,
  type IngredientUnit,
  type LootPickup,
  type Purity,
  type Recipe,
  type ResourceNode,
  type UnlockCost,
  type WorldLocations,
} from '@foreman/sf-game-data';
import { cmToMetres, compassBearing, humaniseClassName } from '@foreman/sf-present';

import { WATER_EXTRACTOR, WATER_ITEM_CLASS } from '@foreman/sf-save-data';
import type { ActorNode, SaveGraph } from '@foreman/sf-save-data-graph';
import type { GameDataIndex, NameResolver } from '../gameData.js';
import type {
  AssemblyPhase,
  ExtractorLine,
  Inventory,
  MilestoneKind,
  ProducerLine,
  ResourceNodeOverride,
  SaveState,
  Vec3,
} from '@foreman/sf-save-data';

/** Convert a centimetre position to the metres the pioneer sees in-game (2dp). */
function vecToMetres(v: Vec3): Vec3 {
  return { x: cmToMetres(v.x), y: cmToMetres(v.y), z: cmToMetres(v.z) };
}

/**
 * The save model carries raw class names only; these tool-facing shapes add the
 * resolved display name at the edge (game-data authored name, or humanised
 * fallback). The output field stays named `displayName` for response stability.
 */
export interface NamedStack {
  itemClass: string;
  displayName: string;
  quantity: number;
}

export interface NamedRecipe {
  recipeClass: string;
  displayName: string;
  isAlternate: boolean;
}

export interface NamedMilestone {
  schematicClass: string;
  displayName: string;
  tier?: number;
  kind: MilestoneKind;
}

export interface NamedContainer {
  buildingClass: string;
  displayName: string;
  location?: Vec3;
  inventory: NamedStack[];
  distance?: number;
}

/** Resolve a save inventory's item classes to display-named stacks. */
function nameStacks(inventory: Inventory, resolve: NameResolver): NamedStack[] {
  return inventory.map((s) => ({
    itemClass: s.itemClass,
    displayName: resolve(s.itemClass),
    quantity: s.quantity,
  }));
}

/** Strips the "BPD Research Tree" / "Research Tree" prefix from a humanised name. */
function cleanResearchTreeName(name: string): string {
  return name.replace(/^(?:BPD\s+)?Research Tree\s+/i, '').trim();
}

/**
 * Pure, tool-facing read functions over a `SaveState`. These shape the computed
 * answers the MCP tools return; keeping them here keeps `tools/index.ts` thin and
 * makes the logic directly unit-testable.
 */

export interface PlayerSummary {
  location?: Vec3;
  hubLocation?: Vec3;
  /** Total in-game play time in seconds, if the save header carries it. */
  playDurationSeconds?: number;
  /** The same play time formatted as "Xh Ym", for convenience. */
  playTime?: string;
  itemCount: number;
  inventory: NamedStack[];
}

export function playerSummary(state: SaveState, resolve: NameResolver): PlayerSummary {
  return {
    location: state.player.location === undefined ? undefined : vecToMetres(state.player.location),
    hubLocation:
      state.player.hubLocation === undefined ? undefined : vecToMetres(state.player.hubLocation),
    playDurationSeconds: state.playDurationSeconds,
    playTime: formatDuration(state.playDurationSeconds),
    itemCount: state.player.inventory.length,
    inventory: nameStacks(state.player.inventory, resolve),
  };
}

/** Formats a duration in seconds as "Xh Ym" (e.g. 45296 → "12h 34m"). */
function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return undefined;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export interface RecipeSummary {
  total: number;
  standardCount: number;
  alternateCount: number;
  standard: NamedRecipe[];
  alternates: NamedRecipe[];
}

export function unlockedRecipes(state: SaveState, resolve: NameResolver): RecipeSummary {
  const named: NamedRecipe[] = state.recipes
    .map((r) => ({
      recipeClass: r.recipeClass,
      displayName: resolve(r.recipeClass),
      isAlternate: r.isAlternate,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const standard = named.filter((r) => !r.isAlternate);
  const alternates = named.filter((r) => r.isAlternate);
  return {
    total: named.length,
    standardCount: standard.length,
    alternateCount: alternates.length,
    standard,
    alternates,
  };
}

/**
 * The Creative Mode settings that change *effective* progression — present only on a
 * creative save. The pioneer's actual purchased milestones/research are still listed
 * normally; these flags tell the foreman the effective unlocked state is broader (and
 * unlocks are free), so it doesn't advise grinding for what's already granted.
 */
export interface CreativeProgression {
  /** Tier granted at start (0 = none). */
  startingTier: number;
  /** All MAM research is unlocked. */
  unlockAllResearch: boolean;
  /** All AWESOME-shop schematics are unlocked. */
  unlockAllShop: boolean;
  /** Alternate recipes unlock instantly. */
  unlockInstantAltRecipes: boolean;
  /** Milestones / MAM / shop cost nothing to unlock. */
  noUnlockCost: boolean;
}

/** One Space Elevator / Project Assembly phase with its **effective** deliverable cost. */
export interface ProjectAssemblyPhaseView {
  /** Phase number (matches `assemblyPhase.phase`). */
  phase: number;
  /** HUB tier this phase unlocks. */
  unlocksTier: number;
  /** True for the pioneer's current phase. */
  current: boolean;
  /** Deliverables, each amount already scaled by the Space Elevator cost multiplier. */
  cost: { itemClass: string; displayName: string; amount: number }[];
}

export interface MilestoneSummary {
  assemblyPhase?: AssemblyPhase;
  milestonesByTier: { tier: number; milestones: NamedMilestone[] }[];
  tutorials: NamedMilestone[];
  other: NamedMilestone[];
  mamResearch: string[];
  /** Creative Mode progression overlay — present only when creative is enabled. */
  creative?: CreativeProgression;
  /**
   * Space Elevator / Project Assembly phase deliverables with **effective** costs
   * (base × the 1.2 Space Elevator cost multiplier). Empty when the dataset carries no
   * phase costs (pre-#172).
   */
  projectAssembly: ProjectAssemblyPhaseView[];
}

export function milestones(
  state: SaveState,
  game: GameDataIndex,
  resolve: NameResolver,
): MilestoneSummary {
  const byTier = new Map<number, NamedMilestone[]>();
  const tutorials: NamedMilestone[] = [];
  const other: NamedMilestone[] = [];
  for (const m of state.milestones) {
    const named: NamedMilestone = {
      schematicClass: m.schematicClass,
      displayName: resolve(m.schematicClass),
      tier: m.tier,
      kind: m.kind,
    };
    if (m.kind === 'tutorial') {
      tutorials.push(named);
    } else if (m.kind === 'milestone' && m.tier !== undefined) {
      const bucket = byTier.get(m.tier) ?? [];
      bucket.push(named);
      byTier.set(m.tier, bucket);
    } else {
      other.push(named);
    }
  }
  return {
    assemblyPhase: state.assemblyPhase,
    milestonesByTier: [...byTier.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tier, list]) => ({ tier, milestones: list })),
    tutorials,
    other,
    // Research trees aren't in game data, so resolve() humanises; trim the verbose
    // "BPD Research Tree X" prefix to the bare tree name and re-sort alphabetically.
    mamResearch: state.mamResearch
      .map((cls) => cleanResearchTreeName(resolve(cls)))
      .sort((a, b) => a.localeCompare(b)),
    ...(state.creativeMode.enabled
      ? {
          creative: {
            startingTier: state.creativeMode.startingTier,
            unlockAllResearch: state.creativeMode.unlockAllResearch,
            unlockAllShop: state.creativeMode.unlockAllShop,
            unlockInstantAltRecipes: state.creativeMode.unlockInstantAltRecipes,
            noUnlockCost: state.creativeMode.noUnlockCost,
          },
        }
      : {}),
    projectAssembly: projectAssemblyView(state, game, resolve),
  };
}

/**
 * The Space Elevator phase deliverables with **effective** costs: each base amount is
 * scaled by the 1.2 Space Elevator deliverable cost multiplier (rounded to a whole
 * deliverable). Empty when the dataset carries no phase costs.
 */
function projectAssemblyView(
  state: SaveState,
  game: GameDataIndex,
  resolve: NameResolver,
): ProjectAssemblyPhaseView[] {
  const mul = state.advancedGameSettings.spaceElevatorCostMultiplier;
  const currentPhase = state.assemblyPhase?.phase;
  return (game.projectAssemblyPhases ?? []).map((p) => ({
    phase: p.phase,
    unlocksTier: p.lastTierOfPhase,
    current: currentPhase !== undefined && currentPhase === p.phase,
    cost: p.cost.map((c) => ({
      itemClass: c.itemClassName,
      displayName: resolve(c.itemClassName),
      amount: Math.round(c.amount * mul),
    })),
  }));
}

export interface StorageView {
  containerCount: number;
  containers: NamedContainer[];
  dimensionalDepot: NamedStack[];
}

/**
 * Storage containers and the dimensional depot, with container locations in
 * metres. When a `location` (in metres, e.g. from get_player_state) is given,
 * containers are annotated with distance to it and sorted nearest-first.
 */
export function storageView(state: SaveState, resolve: NameResolver, location?: Vec3): StorageView {
  const containers: NamedContainer[] = state.storage.containers.map((container) => {
    const locM = container.location === undefined ? undefined : vecToMetres(container.location);
    return {
      buildingClass: container.buildingClass,
      displayName: resolve(container.buildingClass),
      location: locM,
      inventory: nameStacks(container.inventory, resolve),
      distance: location !== undefined && locM !== undefined ? distance(location, locM) : undefined,
    };
  });
  if (location !== undefined) {
    containers.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }
  return {
    containerCount: state.storage.containers.length,
    containers,
    dimensionalDepot: nameStacks(state.storage.dimensionalDepot, resolve),
  };
}

const COLLECTIBLE_KINDS: WorldCollectibleKind[] = [
  'mercerSphere',
  'somersloop',
  'powerSlugBlue',
  'powerSlugYellow',
  'powerSlugPurple',
  'hardDrive',
  'helmet',
  'mtape',
];

const COVERAGE_NOTE =
  "Exact per-kind counts. collected is read from the save's own collected record " +
  "(FGScannableSubsystem), matched to the world dataset by each collectible's GUID, so it is " +
  'accurate at any exploration level — never an estimate. remaining = worldTotal − collected ' +
  '(still out there); use get_nearby for the locations of those remaining ones.';

export interface CollectibleProgress {
  kind: WorldCollectibleKind;
  label: string;
  /** Fixed map-wide total for this kind. */
  worldTotal: number;
  /** Exactly how many the pioneer has collected (from the save's GUID record). */
  collected: number;
  /** Still out there to grab (worldTotal − collected). */
  remaining: number;
}

export interface CollectibleProgressView {
  perType: CollectibleProgress[];
  note: string;
}

/**
 * Exact per-kind collectible progress. The save's `FGScannableSubsystem` records
 * the GUID of every collected pickup (spheres/sloops/slugs) and looted hard-drive
 * pod; matching those against each world-dataset collectible's GUID gives an exact
 * collected count at any progression — no exploration-based estimation.
 */
export function collectibleProgressView(
  state: SaveState,
  world: WorldLocations,
): CollectibleProgressView {
  const collectedSet = collectedGuidSet(state);
  const unlockedSchematics = unlockedSchematicSet(state);
  const totals = new Map<string, number>();
  const collected = new Map<string, number>();
  for (const c of world.collectibles) {
    totals.set(c.kind, (totals.get(c.kind) ?? 0) + 1);
    if (isCollected(c, collectedSet, unlockedSchematics)) {
      collected.set(c.kind, (collected.get(c.kind) ?? 0) + 1);
    }
  }
  const perType: CollectibleProgress[] = COLLECTIBLE_KINDS.map((kind) => {
    const worldTotal = totals.get(kind) ?? 0;
    const got = collected.get(kind) ?? 0;
    return {
      kind,
      label: KIND_LABELS[kind] ?? kind,
      worldTotal,
      collected: got,
      remaining: worldTotal - got,
    };
  });
  return { perType, note: COVERAGE_NOTE };
}

/** Every collected-collectible GUID (pickups + looted pods) as one lookup set. */
export function collectedGuidSet(state: SaveState): Set<string> {
  return new Set([...state.collectedPickupGuids, ...state.lootedDropPodGuids]);
}

/**
 * Instance names of loose crash-site parts the save records as collected (from each
 * sublevel's `collectables` list). Matched against `lootPickups[].id` to drop
 * already-grabbed parts — loose parts are tracked here, not in `mDestroyedPickups`.
 */
export function collectedLootIdSet(state: SaveState): Set<string> {
  return new Set(state.collectedLootIds);
}

/**
 * The classes of every schematic the pioneer has unlocked. Customizer pickups
 * (helmet/tapes) carry no pickup GUID — picking one up unlocks a cosmetic
 * schematic, so this is how their collected status is determined.
 */
export function unlockedSchematicSet(state: SaveState): Set<string> {
  return new Set(state.milestones.map((m) => m.schematicClass));
}

/**
 * Whether a collectible has been collected: GUID-keyed kinds match the save's
 * destroyed-pickup record; schematic-keyed customizer kinds match the unlocked
 * schematics.
 */
export function isCollected(
  c: Collectible,
  collectedGuids: Set<string>,
  unlockedSchematics: Set<string>,
): boolean {
  if (c.guid !== undefined) {
    return collectedGuids.has(c.guid);
  }
  if (c.schematic !== undefined) {
    return unlockedSchematics.has(c.schematic);
  }
  return false;
}

/** A drop-pod unlock cost with the item descriptor resolved to a display name. */
export interface ResolvedUnlock {
  item?: { itemClass: string; name: string; amount: number };
  powerMW?: number;
}

/** Resolve a dataset unlock cost, upgrading the item class to a display name. */
function resolveUnlock(u: UnlockCost, itemName?: (className: string) => string): ResolvedUnlock {
  const out: ResolvedUnlock = {};
  if (u.item !== undefined) {
    out.item = {
      itemClass: u.item.itemClass,
      name: itemName?.(u.item.itemClass) ?? humaniseClassName(u.item.itemClass),
      amount: u.item.amount,
    };
  }
  if (u.powerMW !== undefined) {
    out.powerMW = u.powerMW;
  }
  return out;
}

export interface NearbyItem {
  kind: WorldCollectibleKind;
  label: string;
  /** World position in metres. */
  location: Vec3;
  /** Straight-line distance from the origin, in metres. */
  distance: number;
  /** 8-point compass direction from the origin (N, NE, E, …). */
  bearing: string;
  /**
   * For hard-drive crash sites: the **cost to open the drop pod** (the items and/or
   * power it requires) — NOT a reward. The reward is the hard drive itself, which
   * unlocks an alternate-recipe research at the MAM.
   */
  unlockCost?: ResolvedUnlock;
}

export interface NearbyOptions {
  kinds?: WorldCollectibleKind[];
  radius?: number;
  limit?: number;
}

export interface NearbyResult {
  origin: Vec3;
  radius?: number;
  /** Total matches (before the limit was applied). */
  matchCount: number;
  items: NearbyItem[];
  /** Honest caveat: positions are from the static world dataset. */
  note: string;
}

const DEFAULT_NEARBY_LIMIT = 20;

const KIND_LABELS: Record<WorldCollectibleKind, string> = {
  mercerSphere: 'Mercer Sphere',
  somersloop: 'Somersloop',
  powerSlugBlue: 'Blue Power Slug',
  powerSlugYellow: 'Yellow Power Slug',
  powerSlugPurple: 'Purple Power Slug',
  hardDrive: 'Hard Drive (crash site)',
  helmet: 'Customizer Helmet',
  mtape: 'Tape',
};

const NEARBY_NOTE =
  'Un-collected collectibles only: positions are from the static world dataset, with the ' +
  'ones the save records as already collected (by GUID) removed — so these are genuinely ' +
  'still out there to grab. Locations + distances are in metres; bearing is the compass ' +
  'direction from you (N/NE/E/…).';

/**
 * Un-collected collectibles near a world location, nearest-first, in metres.
 * `origin` is in metres (e.g. from get_player_state) and `radius` in metres.
 * Positions come from the static world-location dataset (complete and accurate);
 * collectibles the save records as collected (by GUID, via `excludeGuids`) are
 * removed, so the result is exactly what is still grabbable. Each item carries a
 * compass bearing from the origin. Capped by `limit` (default 20).
 */
export function nearbyFromWorld(
  collectibles: Collectible[],
  origin: Vec3,
  options: NearbyOptions = {},
  excludeGuids?: Set<string>,
  excludeSchematics?: Set<string>,
  itemName?: (className: string) => string,
): NearbyResult {
  const limit = options.limit ?? DEFAULT_NEARBY_LIMIT;
  const collected = (c: Collectible): boolean =>
    (c.guid !== undefined && excludeGuids?.has(c.guid) === true) ||
    (c.schematic !== undefined && excludeSchematics?.has(c.schematic) === true);
  let items: NearbyItem[] = collectibles
    .filter((c) => (options.kinds === undefined || options.kinds.includes(c.kind)) && !collected(c))
    .map((c) => {
      const location = vecToMetres({ x: c.x, y: c.y, z: c.z });
      return {
        kind: c.kind,
        label: KIND_LABELS[c.kind] ?? c.kind,
        location,
        distance: distance(origin, location),
        bearing: compassBearing(origin, location),
        ...(c.unlock !== undefined ? { unlockCost: resolveUnlock(c.unlock, itemName) } : {}),
      };
    })
    .sort((a, b) => a.distance - b.distance);
  if (options.radius !== undefined) {
    const radius = options.radius;
    items = items.filter((i) => i.distance <= radius);
  }
  return {
    origin,
    radius: options.radius,
    matchCount: items.length,
    items: items.slice(0, limit),
    note: NEARBY_NOTE,
  };
}

/** Straight-line distance between two points (same units in, same units out; exact). */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export interface NearbyPart {
  /** Item display name. */
  item: string;
  /** Item descriptor class (e.g. Desc_Computer_C). */
  itemClass: string;
  /** Stack size at this pickup. */
  amount: number;
  /** World position in metres. */
  location: Vec3;
  /** Straight-line distance from the origin, in metres. */
  distance: number;
  /** 8-point compass direction from the origin. */
  bearing: string;
}

export interface NearbyPartsOptions {
  /** Filter to items whose class or display name contains this (case-insensitive). */
  item?: string;
  /** Cap matches to within this many metres of the origin. */
  radius?: number;
  limit?: number;
}

export interface NearbyPartsResult {
  origin: Vec3;
  radius?: number;
  matchCount: number;
  items: NearbyPart[];
  note: string;
}

const PARTS_NOTE =
  'Un-grabbed loose crash-site parts: positions are from the complete static world dataset ' +
  '(the corrected 1.2 loot — every spawn, map-wide), with the ones the save records as already ' +
  'picked up removed, so these are genuinely still out there to grab. Locations + distances are ' +
  'in metres; bearing is the compass direction from you. (A save that began before 1.2 may show ' +
  'a few different in-world items than listed here, due to a since-fixed game bug.)';

/**
 * Un-grabbed loose crash-site parts near a world location, nearest-first, in metres.
 * `origin`/`radius` are in metres. Positions come from the complete static world dataset;
 * parts the save records as collected (by instance id, via `excludeIds` — the per-sublevel
 * `collectables` record, NOT `mDestroyedPickups`) are removed, so the result is exactly what
 * is still grabbable. `itemName` upgrades the item descriptor class to a display name.
 */
export function nearbyParts(
  loot: LootPickup[],
  origin: Vec3,
  options: NearbyPartsOptions = {},
  excludeIds?: Set<string>,
  itemName?: (className: string) => string,
): NearbyPartsResult {
  const limit = options.limit ?? DEFAULT_NEARBY_LIMIT;
  const needle = options.item?.trim().toLowerCase();
  const label = (cls: string): string => itemName?.(cls) ?? humaniseClassName(cls);
  let items: NearbyPart[] = loot
    .filter((p) => excludeIds?.has(p.id) !== true)
    .filter(
      (p) =>
        needle === undefined ||
        needle === '' ||
        p.itemClass.toLowerCase().includes(needle) ||
        label(p.itemClass).toLowerCase().includes(needle),
    )
    .map((p) => {
      const location = vecToMetres({ x: p.x, y: p.y, z: p.z });
      return {
        item: label(p.itemClass),
        itemClass: p.itemClass,
        amount: p.amount,
        location,
        distance: distance(origin, location),
        bearing: compassBearing(origin, location),
      };
    })
    .sort((a, b) => a.distance - b.distance);
  if (options.radius !== undefined) {
    const radius = options.radius;
    items = items.filter((i) => i.distance <= radius);
  }
  return {
    origin,
    radius: options.radius,
    matchCount: items.length,
    items: items.slice(0, limit),
    note: PARTS_NOTE,
  };
}

// ── Production (theoretical capability) ──────────────────────────────────────

/**
 * What the factory *can* produce, given how every machine is configured. This is
 * theoretical capacity — recipe × clock × somersloop boost (× node purity for
 * extractors) — NOT measured output: it does not know whether a line is actually
 * fed (belts/splitters/pipes) or powered. That is tracked separately by the
 * actual-production graph. All figures are derived in-process from the game data.
 */

/** Output-rate multiplier per node purity (impure 0.5 / normal 1 / pure 2). */
const PURITY_MULTIPLIER: Record<Purity, number> = { impure: 0.5, normal: 1, pure: 2 };

/**
 * Satisfactory's overclock power exponent: power scales as `clock^1.321928`.
 * Somersloop production amplification scales power by `boost²` on top.
 */
const OVERCLOCK_POWER_EXPONENT = 1.321928;

/**
 * A miner / oil pump / fracking extractor snaps onto its node, so it sits within a
 * few hundred cm of the node centre. Keep the match tight (≈20 m) so an extractor is
 * never mis-resolved to a different, unrelated node nearby.
 */
const NODE_MATCH_CM = 2000;

/** Cap on individually-listed machines (when filtered by item), to bound tokens. */
const MAX_MACHINE_DETAIL = 100;

const PRODUCTION_NOTE =
  'Theoretical capacity, aggregated by output item: effective = recipe rate × clock × ' +
  'somersloop boost (× node purity for extractors), summed across machines. This is what the ' +
  'machines are CONFIGURED to make at full tilt — NOT measured output. It does not account for ' +
  'whether lines are actually fed (belts/splitters/pipes) or powered; that is tracked ' +
  'separately. Power figures are estimates. Pass `item` to also list the individual machines ' +
  '(with locations, in metres).';

export interface RateFlow {
  itemClass: string;
  name: string;
  /** Recipe rate at 100% clock, no boost. */
  basePerMinute: number;
  /** base × clock × boost (× purity for extractors). */
  effectivePerMinute: number;
  unit: IngredientUnit;
}

/** One machine's configuration + theoretical output (used for the detail listing). */
interface MachineLine {
  kind: 'manufacturer' | 'extractor';
  buildingClass: string;
  building: string;
  recipeClass?: string;
  recipe?: string;
  resourceClass?: string;
  resource?: string;
  purity?: Purity | 'unknown';
  clock: number;
  boost: number;
  location?: Vec3;
  outputs: RateFlow[];
  powerMW?: number;
}

/** A machine in the detail listing (compact; coordinates in metres). */
export interface MachineDetail {
  building: string;
  recipe?: string;
  resource?: string;
  purity?: Purity | 'unknown';
  clockPercent: number;
  productionBoost: number;
  location?: Vec3;
  outputs: RateFlow[];
  estimatedPowerMW?: number;
}

/** Per-recipe (or per-extractor) contribution to one output item. */
export interface ProductionSource {
  label: string;
  machineCount: number;
  effectivePerMinute: number;
}

/** Aggregated theoretical output of one item across the whole factory. */
export interface ProductionItem {
  item: string;
  itemClass: string;
  unit: IngredientUnit;
  /** Summed effective output per minute across every machine making this item. */
  effectivePerMinute: number;
  /** How many machines contribute to this item. */
  machineCount: number;
  /** Breakdown by recipe / extractor, largest first. */
  sources: ProductionSource[];
}

export interface ProductionView {
  producerCount: number;
  extractorCount: number;
  /** Estimated total power draw of all production lines, MW (an estimate). */
  estimatedPowerMW: number;
  /** Theoretical output per item, largest effective rate first. */
  items: ProductionItem[];
  /** Individual machines — present only when filtered by `item`, capped. */
  machines?: MachineDetail[];
  /** True when the machine listing was capped at {@link MAX_MACHINE_DETAIL}. */
  machinesTruncated?: boolean;
  note: string;
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * The effective consumer power multiplier for a save: the 1.2 Power Consumption ×,
 * or **0 under Creative Mode "No Power"** (machines run without drawing power).
 * Generators are unaffected — this is the consumer side only.
 */
function effectivePowerMultiplier(state: SaveState): number {
  return state.creativeMode.noPower ? 0 : state.advancedGameSettings.powerConsumptionMultiplier;
}

/**
 * Estimated MW draw at the line's clock + boost (undefined for generators/unknown).
 * `powerMul` is the 1.2 Power Consumption × (consumers only; default 1 / no-op).
 */
function estimatePower(
  building: Building | undefined,
  recipe: Recipe | undefined,
  clock: number,
  boost: number,
  powerMul = 1,
): number | undefined {
  if (building === undefined) {
    return undefined;
  }
  let base = building.powerConsumption;
  if (!(base > 0)) {
    if (recipe?.variablePower !== undefined) {
      base = (recipe.variablePower.min + recipe.variablePower.max) / 2;
    } else if (building.maxPowerConsumption !== undefined) {
      base = building.maxPowerConsumption;
    } else {
      return undefined;
    }
  }
  const factor = clock ** OVERCLOCK_POWER_EXPONENT * (boost > 1 ? boost * boost : 1);
  return round(base * factor * powerMul, 1);
}

/** Build one manufacturer's theoretical line from its config + the recipe/building data. */
function manufacturerLine(line: ProducerLine, game: GameDataIndex, powerMul = 1): MachineLine {
  const recipe = line.recipeClass === undefined ? undefined : game.recipes[line.recipeClass];
  const building = game.buildings[line.buildingClass];
  const scale = line.clockSpeed * line.productionBoost;
  const outputs: RateFlow[] =
    recipe?.products.map((p) => ({
      itemClass: p.itemClassName,
      name: game.displayNames.get(p.itemClassName) ?? humaniseClassName(p.itemClassName),
      basePerMinute: round(p.perMinute),
      effectivePerMinute: round(p.perMinute * scale),
      unit: p.unit,
    })) ?? [];
  return {
    kind: 'manufacturer',
    buildingClass: line.buildingClass,
    building: game.displayNames.get(line.buildingClass) ?? humaniseClassName(line.buildingClass),
    recipeClass: line.recipeClass,
    recipe:
      line.recipeClass === undefined
        ? undefined
        : (recipe?.displayName ?? humaniseClassName(line.recipeClass)),
    clock: line.clockSpeed,
    boost: line.productionBoost,
    location: line.location === undefined ? undefined : vecToMetres(line.location),
    outputs,
    powerMW: estimatePower(building, recipe, line.clockSpeed, line.productionBoost, powerMul),
  };
}

/**
 * Resolve what an extractor produces and its purity multiplier. Water extractors
 * draw Water from a volume (no node, no purity); everything else snaps onto a
 * resource node, so we read the resource + purity from the node it sits on.
 */
export function resolveExtraction(
  line: ExtractorLine,
  world: WorldLocations,
  overrides: ResourceNodeOverride[] = [],
): { resourceClass?: string; purity?: Purity | 'unknown'; purityMul: number } {
  if (WATER_EXTRACTOR.test(line.buildingClass)) {
    return { resourceClass: WATER_ITEM_CLASS, purityMul: 1 };
  }
  const node =
    line.location === undefined ? undefined : nearestNode(world.resourceNodes, line.location);
  // Under 1.2 node randomisation the canonical (bundled) node's type/purity is stale;
  // the save's resolved override at this position is authoritative when present.
  const override =
    line.location === undefined ? undefined : nearestNodeOverride(overrides, line.location);
  const resourceClass = override?.resourceClass ?? node?.resourceClass ?? undefined;
  const purity = override?.purity ?? node?.purity ?? undefined;
  if (resourceClass == null) {
    return { resourceClass: undefined, purity: 'unknown', purityMul: 1 };
  }
  return {
    resourceClass,
    purity: purity ?? 'unknown',
    purityMul: purity == null ? 1 : PURITY_MULTIPLIER[purity],
  };
}

/** Build one extractor's theoretical line, resolving resource + purity from its node. */
function extractorLine(
  line: ExtractorLine,
  game: GameDataIndex,
  world: WorldLocations,
  overrides: ResourceNodeOverride[] = [],
  powerMul = 1,
): MachineLine {
  const building = game.buildings[line.buildingClass];
  const { resourceClass, purity, purityMul } = resolveExtraction(line, world, overrides);
  const outputs: RateFlow[] = [];
  if (building?.extractionRatePerMin !== undefined && resourceClass !== undefined) {
    const base = building.extractionRatePerMin * purityMul;
    outputs.push({
      itemClass: resourceClass,
      name: game.displayNames.get(resourceClass) ?? humaniseClassName(resourceClass),
      basePerMinute: round(base),
      effectivePerMinute: round(base * line.clockSpeed * line.productionBoost),
      unit: extractorUnit(resourceClass),
    });
  }
  return {
    kind: 'extractor',
    buildingClass: line.buildingClass,
    building: game.displayNames.get(line.buildingClass) ?? humaniseClassName(line.buildingClass),
    resourceClass,
    resource:
      resourceClass === undefined
        ? undefined
        : (game.displayNames.get(resourceClass) ?? humaniseClassName(resourceClass)),
    purity,
    clock: line.clockSpeed,
    boost: line.productionBoost,
    location: line.location === undefined ? undefined : vecToMetres(line.location),
    outputs,
    powerMW: estimatePower(building, undefined, line.clockSpeed, line.productionBoost, powerMul),
  };
}

function extractorUnit(resourceClass: string): IngredientUnit {
  // Fluids (water/oil/etc.) are reported in m³. We don't have the item form to hand
  // here, so infer from the well-known fluid resource classes.
  return /Water|LiquidOil|NitrogenGas|NitricAcid|HeavyOilResidue/i.test(resourceClass)
    ? 'm³'
    : 'items';
}

/** The nearest resource node to a centimetre position, within {@link NODE_MATCH_CM}. */
function nearestNode(nodes: ResourceNode[], locCm: Vec3): ResourceNode | undefined {
  let best: ResourceNode | undefined;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const d = Math.hypot(node.x - locCm.x, node.y - locCm.y, node.z - locCm.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = node;
    }
  }
  return bestDistance <= NODE_MATCH_CM ? best : undefined;
}

/**
 * The nearest save-recorded node override to a centimetre position, within
 * {@link NODE_MATCH_CM}. Under 1.2 node randomisation the save carries each node's
 * *resolved* resource/purity (`SaveState.resourceNodeOverrides`); matched by position
 * to an extractor it takes precedence over the bundled (canonical-world) node.
 */
function nearestNodeOverride(
  overrides: ResourceNodeOverride[],
  locCm: Vec3,
): ResourceNodeOverride | undefined {
  let best: ResourceNodeOverride | undefined;
  let bestDistance = Infinity;
  for (const override of overrides) {
    if (override.position === undefined) {
      continue;
    }
    const { x, y, z } = override.position;
    const d = Math.hypot(x - locCm.x, y - locCm.y, z - locCm.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = override;
    }
  }
  return bestDistance <= NODE_MATCH_CM ? best : undefined;
}

/** A machine's source label for the per-item breakdown (recipe, or extractor + purity). */
function sourceLabel(line: MachineLine): string {
  if (line.kind === 'manufacturer') {
    return line.recipe ?? '(unconfigured)';
  }
  return line.purity !== undefined && line.purity !== 'unknown'
    ? `${line.building} (${line.purity})`
    : line.building;
}

function toDetail(line: MachineLine): MachineDetail {
  return {
    building: line.building,
    recipe: line.recipe,
    resource: line.resource,
    purity: line.purity,
    clockPercent: round(line.clock * 100, 1),
    productionBoost: line.boost,
    location: line.location,
    outputs: line.outputs,
    estimatedPowerMW: line.powerMW,
  };
}

/**
 * Theoretical production capacity, aggregated by output item. Manufacturers are
 * joined to their recipe and extractors to the resource node they sit on; each
 * machine's effective output (rate × clock × boost × purity) is summed per item.
 * When `item` is given, the result is narrowed to lines producing that item (name
 * or class) and the individual machines are listed too (capped). See
 * {@link PRODUCTION_NOTE} for what this does and does not represent.
 */
export function productionView(
  state: SaveState,
  game: GameDataIndex,
  world: WorldLocations,
  options: { item?: string } = {},
): ProductionView {
  // 1.2 Advanced Game Settings overlay: power draw × on consumers (0 under Creative
  // No Power), resolved node type/purity from the save's randomisation overrides.
  const powerMul = effectivePowerMultiplier(state);
  const overrides = state.resourceNodeOverrides;
  const lines: MachineLine[] = [
    ...state.production.producers.map((p) => manufacturerLine(p, game, powerMul)),
    ...state.production.extractors.map((e) => extractorLine(e, game, world, overrides, powerMul)),
  ];

  const needle = options.item?.trim().toLowerCase();
  const filtered =
    needle === undefined || needle === ''
      ? lines
      : lines.filter((l) =>
          l.outputs.some(
            (o) =>
              o.name.toLowerCase().includes(needle) || o.itemClass.toLowerCase().includes(needle),
          ),
        );

  // Aggregate effective output per item, with a per-source (recipe/extractor) breakdown.
  const items = new Map<string, ProductionItem>();
  const sources = new Map<string, Map<string, ProductionSource>>();
  for (const line of filtered) {
    for (const out of line.outputs) {
      const item = items.get(out.itemClass) ?? {
        item: out.name,
        itemClass: out.itemClass,
        unit: out.unit,
        effectivePerMinute: 0,
        machineCount: 0,
        sources: [],
      };
      item.effectivePerMinute = round(item.effectivePerMinute + out.effectivePerMinute);
      item.machineCount += 1;
      items.set(out.itemClass, item);

      const bySource = sources.get(out.itemClass) ?? new Map<string, ProductionSource>();
      const label = sourceLabel(line);
      const src = bySource.get(label) ?? { label, machineCount: 0, effectivePerMinute: 0 };
      src.machineCount += 1;
      src.effectivePerMinute = round(src.effectivePerMinute + out.effectivePerMinute);
      bySource.set(label, src);
      sources.set(out.itemClass, bySource);
    }
  }
  const itemList = [...items.values()]
    .map((item) => ({
      ...item,
      sources: [...(sources.get(item.itemClass)?.values() ?? [])].sort(
        (a, b) => b.effectivePerMinute - a.effectivePerMinute,
      ),
    }))
    .sort((a, b) => b.effectivePerMinute - a.effectivePerMinute);

  const estimatedPowerMW = round(
    filtered.reduce((sum, l) => sum + (l.powerMW ?? 0), 0),
    1,
  );

  const view: ProductionView = {
    producerCount: state.production.producers.length,
    extractorCount: state.production.extractors.length,
    estimatedPowerMW,
    items: itemList,
    note: PRODUCTION_NOTE,
  };

  // Only enumerate individual machines when the caller has narrowed by item — an
  // unfiltered factory can be hundreds of machines (the aggregate is the answer).
  if (needle !== undefined && needle !== '') {
    view.machines = filtered.slice(0, MAX_MACHINE_DETAIL).map(toDetail);
    if (filtered.length > MAX_MACHINE_DETAIL) {
      view.machinesTruncated = true;
    }
  }

  return view;
}

/* ── Power (#68) ──────────────────────────────────────────────────────────── */

const POWER_NOTE =
  "Capacity is each generator's nameplate output scaled LINEARLY by clock speed; " +
  'consumption is an ESTIMATE (production machines scaled by clock/somersloop, other ' +
  'powered buildings at 100% draw). Geothermal output is variable (geyser-purity ' +
  'dependent) and excluded from the numeric capacity — circuits containing one are ' +
  'flagged hasVariableGenerators, so real capacity is higher than shown. Fuel supply ' +
  'is not checked: an unfuelled generator still counts toward capacity. Power Storage ' +
  '(batteries) is reported per circuit as batteryCount + batteryChargeMWh, NOT as ' +
  'capacity or draw — charged batteries buffer a momentary deficit, so an overloaded ' +
  'circuit with stored charge will not trip until that charge is exhausted.';

export type PowerStatus = 'ok' | 'tight' | 'overloaded' | 'unknown';

/** One power circuit's capacity vs estimated draw (a pre-grouped grid). */
export interface PowerCircuitView {
  circuitId: number;
  generatorCount: number;
  /** Sum of fixed-output generators' nameplate MW × clock (excludes variable/geothermal). */
  capacityMW: number;
  /** True if the circuit has a variable-output (geothermal) generator — real capacity is higher. */
  hasVariableGenerators: boolean;
  consumerCount: number;
  /** Estimated total draw, MW. */
  consumptionMW: number;
  /** capacityMW − consumptionMW (positive = headroom). */
  balanceMW: number;
  status: PowerStatus;
  /** Power Storage (batteries) on this circuit — they buffer a momentary deficit. */
  batteryCount: number;
  /** Combined stored energy of those batteries (raw `mPowerStore`; a full Mk1 ≈ 100 MWh). */
  batteryChargeMWh: number;
}

/** Generators of one building type, rolled up across the whole save. */
export interface GeneratorTypeView {
  building: string;
  buildingClass: string;
  count: number;
  /** Combined nameplate MW × clock for this type (0 when output is variable). */
  capacityMW: number;
  variableOutput: boolean;
  /** Fuel item display names currently loaded across this type (empty for geothermal/unfuelled). */
  fuels: string[];
}

export interface PowerView {
  /** Per-circuit capacity vs draw, lowest circuit id first. */
  circuits: PowerCircuitView[];
  /** Generators rolled up by building type (every generator, including off-grid ones). */
  generators: GeneratorTypeView[];
  generatorCount: number;
  /** Sum of all circuits' fixed capacity, MW. */
  totalCapacityMW: number;
  /** Sum of all circuits' estimated consumption, MW. */
  totalConsumptionMW: number;
  note: string;
}

/**
 * A generator's MW output: nameplate × clock — **linear** in clock, unlike consumer
 * draw (generators are not subject to the overclock power exponent). Variable-output
 * (geothermal) reports 0 MW + `variable: true`, since the save carries no geyser purity.
 */
function generatorCapacityMW(
  buildingClass: string,
  clockSpeed: number,
  game: GameDataIndex,
): { mw: number; variable: boolean } {
  const building = game.buildings[buildingClass];
  if (building?.variablePowerProduction === true) {
    return { mw: 0, variable: true };
  }
  return { mw: round((building?.powerProduction ?? 0) * clockSpeed, 1), variable: false };
}

/**
 * A node's estimated power draw: production machines scale by clock/somersloop; other
 * powered buildings draw their flat consumption at 100%. Generators draw nothing.
 */
function consumerDrawMW(node: ActorNode, game: GameDataIndex, powerMul = 1): number {
  if (node.producer !== undefined) {
    const recipe =
      node.producer.recipeClass === undefined ? undefined : game.recipes[node.producer.recipeClass];
    return (
      estimatePower(
        game.buildings[node.producer.buildingClass],
        recipe,
        node.producer.clockSpeed,
        node.producer.productionBoost,
        powerMul,
      ) ?? 0
    );
  }
  if (node.extractor !== undefined) {
    return (
      estimatePower(
        game.buildings[node.extractor.buildingClass],
        undefined,
        node.extractor.clockSpeed,
        node.extractor.productionBoost,
        powerMul,
      ) ?? 0
    );
  }
  if (node.kind === 'generator') {
    return 0;
  }
  const consumption = game.buildings[node.classKey]?.powerConsumption ?? 0;
  return consumption > 0 ? round(consumption * powerMul, 1) : 0;
}

function powerStatus(
  capacityMW: number,
  consumptionMW: number,
  balanceMW: number,
  hasVariable: boolean,
): PowerStatus {
  if (capacityMW === 0 && !hasVariable) {
    return consumptionMW > 0 ? 'overloaded' : 'ok';
  }
  if (balanceMW < 0) {
    return hasVariable ? 'unknown' : 'overloaded';
  }
  if (capacityMW > 0 && balanceMW / capacityMW < 0.1) {
    return 'tight';
  }
  return 'ok';
}

/**
 * Per-power-circuit capacity vs estimated consumption, plus a generator rollup.
 * Circuits are pre-grouped by the game (`SaveState.topology`, exposed via the graph);
 * each member is classified through its graph node — generator capacity on one side,
 * consumer draw on the other — and summed. See {@link POWER_NOTE} for caveats.
 */
export function powerView(state: SaveState, graph: SaveGraph, game: GameDataIndex): PowerView {
  // 1.2 Power Consumption × scales consumer draw (generators are unaffected); Creative
  // No Power zeroes it, so every circuit reads ok.
  const powerMul = effectivePowerMultiplier(state);
  const circuits: PowerCircuitView[] = graph
    .powerCircuits()
    .map((circuit) => {
      let capacityMW = 0;
      let consumptionMW = 0;
      let generatorCount = 0;
      let consumerCount = 0;
      let hasVariableGenerators = false;
      let batteryCount = 0;
      let batteryChargeMWh = 0;
      for (const member of circuit.members) {
        const node = graph.getActor(member);
        if (node === undefined) {
          continue;
        }
        if (node.kind === 'generator' && node.generator !== undefined) {
          generatorCount += 1;
          const cap = generatorCapacityMW(
            node.generator.buildingClass,
            node.generator.clockSpeed,
            game,
          );
          if (cap.variable) {
            hasVariableGenerators = true;
          } else {
            capacityMW += cap.mw;
          }
        } else if (node.battery !== undefined) {
          // A battery neither generates nor consumes in this balance; it buffers the
          // circuit, so it is reported separately rather than as capacity/draw.
          batteryCount += 1;
          batteryChargeMWh += node.battery.chargeMWh;
        } else {
          const draw = consumerDrawMW(node, game, powerMul);
          if (draw > 0) {
            consumptionMW += draw;
            consumerCount += 1;
          }
        }
      }
      capacityMW = round(capacityMW, 1);
      consumptionMW = round(consumptionMW, 1);
      const balanceMW = round(capacityMW - consumptionMW, 1);
      return {
        circuitId: circuit.circuitId,
        generatorCount,
        capacityMW,
        hasVariableGenerators,
        consumerCount,
        consumptionMW,
        balanceMW,
        status: powerStatus(capacityMW, consumptionMW, balanceMW, hasVariableGenerators),
        batteryCount,
        batteryChargeMWh: round(batteryChargeMWh, 1),
      };
    })
    .sort((a, b) => a.circuitId - b.circuitId);

  // Roll up every generator by building type (independent of circuit membership).
  interface GenAccum {
    building: string;
    buildingClass: string;
    count: number;
    capacityMW: number;
    variableOutput: boolean;
    fuels: Set<string>;
  }
  const byType = new Map<string, GenAccum>();
  for (const gen of state.production.generators) {
    const entry: GenAccum = byType.get(gen.buildingClass) ?? {
      building: game.displayNames.get(gen.buildingClass) ?? humaniseClassName(gen.buildingClass),
      buildingClass: gen.buildingClass,
      count: 0,
      capacityMW: 0,
      variableOutput: false,
      fuels: new Set<string>(),
    };
    entry.count += 1;
    const cap = generatorCapacityMW(gen.buildingClass, gen.clockSpeed, game);
    if (cap.variable) {
      entry.variableOutput = true;
    } else {
      entry.capacityMW = round(entry.capacityMW + cap.mw, 1);
    }
    if (gen.fuelClass !== undefined) {
      entry.fuels.add(game.displayNames.get(gen.fuelClass) ?? humaniseClassName(gen.fuelClass));
    }
    byType.set(gen.buildingClass, entry);
  }
  const generators: GeneratorTypeView[] = [...byType.values()]
    .map((e) => ({
      building: e.building,
      buildingClass: e.buildingClass,
      count: e.count,
      capacityMW: e.capacityMW,
      variableOutput: e.variableOutput,
      fuels: [...e.fuels].sort(),
    }))
    .sort((a, b) => b.capacityMW - a.capacityMW);

  return {
    circuits,
    generators,
    generatorCount: state.production.generators.length,
    totalCapacityMW: round(
      circuits.reduce((sum, c) => sum + c.capacityMW, 0),
      1,
    ),
    totalConsumptionMW: round(
      circuits.reduce((sum, c) => sum + c.consumptionMW, 0),
      1,
    ),
    note: POWER_NOTE,
  };
}

/** One material's coverage verdict for the work-order dependency check (#62). */
export interface MaterialCoverage {
  /** The query string the caller supplied (item name or class). */
  query: string;
  /** Resolved display name when matched, else the query echoed back. */
  item: string;
  itemClass?: string;
  /** True when an existing machine/extractor produces this item. */
  automated: boolean;
  /** Summed effective output across producing machines (0 when not automated). */
  producedPerMinute: number;
  /** How many machines/extractors produce it. */
  machineCount: number;
  /** Total quantity on hand across storage containers + the dimensional depot. */
  inStock: number;
  /** Covered when it is produced by automation OR present in storage. */
  covered: boolean;
}

export interface MaterialCoverageView {
  coverage: MaterialCoverage[];
  /** The queries that are neither automated nor in stock — candidate prerequisites. */
  gaps: string[];
  note: string;
}

const MATERIAL_COVERAGE_NOTE =
  'Coverage = produced by existing automation (effective per-minute capacity) OR present in storage. ' +
  'Build costs are one-off quantities — judge whether the on-hand stock / production can amass the amount ' +
  'a build needs; for a `gap` (neither produced nor stocked) issue a prerequisite work order before this one.';

/**
 * Pre-work-order dependency check (#62): for each requested material, report whether
 * existing automation produces it and how much is in storage — so the foreman can issue
 * a prerequisite order for anything uncovered before issuing the main order. Matches a
 * query against produced/stored items by display name or class (case-insensitive, exact
 * then substring). Read-only; reuses the production + storage views.
 */
export function materialCoverageView(
  state: SaveState,
  game: GameDataIndex,
  world: WorldLocations,
  queries: string[],
  resolve: NameResolver,
): MaterialCoverageView {
  const production = productionView(state, game, world);
  const storage = storageView(state, resolve);
  const stock = [...storage.dimensionalDepot, ...storage.containers.flatMap((c) => c.inventory)];

  const matchItem = (q: string): ProductionItem | undefined => {
    const lower = q.toLowerCase();
    return (
      production.items.find(
        (i) => i.item.toLowerCase() === lower || i.itemClass.toLowerCase() === lower,
      ) ??
      production.items.find(
        (i) => i.item.toLowerCase().includes(lower) || i.itemClass.toLowerCase().includes(lower),
      )
    );
  };
  const stockFor = (q: string, itemClass?: string): number => {
    const lower = q.toLowerCase();
    return stock
      .filter((s) =>
        itemClass !== undefined
          ? s.itemClass === itemClass
          : s.displayName.toLowerCase() === lower ||
            s.itemClass.toLowerCase() === lower ||
            s.displayName.toLowerCase().includes(lower),
      )
      .reduce((sum, s) => sum + s.quantity, 0);
  };

  const coverage: MaterialCoverage[] = queries.map((query) => {
    const prod = matchItem(query);
    const itemClass = prod?.itemClass;
    const inStock = stockFor(query, itemClass);
    const automated = prod !== undefined && prod.machineCount > 0;
    return {
      query,
      item: prod?.item ?? query,
      ...(itemClass !== undefined ? { itemClass } : {}),
      automated,
      producedPerMinute: prod?.effectivePerMinute ?? 0,
      machineCount: prod?.machineCount ?? 0,
      inStock,
      covered: automated || inStock > 0,
    };
  });

  return {
    coverage,
    gaps: coverage.filter((c) => !c.covered).map((c) => c.query),
    note: MATERIAL_COVERAGE_NOTE,
  };
}
