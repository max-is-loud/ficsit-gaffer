// Condenses a save's existing selector views into the compact, capped summary the host puts in
// the foreman's context each turn. Pure: the caller collects the views; this sorts, caps and rounds
// them deterministically so the same save always yields the same summary.

import type { ResourceNodeHit } from '@foreman/sf-game-data';

import type {
  MilestoneSummary,
  NamedStack,
  PlayerSummary,
  PowerView,
  ProductionView,
  RecipeSummary,
  StorageView,
} from './selectors.js';
import type { UnlockedNames } from './unlocks.js';

/**
 * List caps: they keep the rendered summary within its token budget. The unlock caps cover the
 * whole game (129 factory buildings, 179 standard part recipes in 1.2), so those lists are never
 * cut: a partial unlock list would send the foreman back to the full milestone and recipe views.
 */
export const SUMMARY_CAPS = {
  tierMilestones: 8,
  alternates: 30,
  generatorTypes: 6,
  production: 15,
  storage: 15,
  resourceTypes: 8,
  buildings: 140,
  partRecipes: 200,
} as const;

/** A nearby resource node as the summary reports it (metres; bearing from the player). */
export interface SummaryResourceNode {
  resource: string;
  purity: string | null;
  distanceMetres: number;
  bearing: string;
  biome: string | null;
}

/** The views a summary is built from, collected by the caller from the existing selectors. */
export interface SaveViews {
  meta: { saveName: string; version: string; savedAt?: string; playDurationSeconds?: number };
  player: PlayerSummary;
  playerBiome?: { biome: string; within: string };
  progress: MilestoneSummary;
  recipes: RecipeSummary;
  power: PowerView;
  production: ProductionView;
  storage: StorageView;
  nearbyResources: SummaryResourceNode[];
  unlocks: UnlockedNames;
}

/**
 * The wire shape of `get_save_summary`. Distances and positions in metres, rates per minute
 * (fluids in m³, flagged by `unit`), power in MW. Every list is capped by {@link SUMMARY_CAPS}.
 */
export interface SaveSummary {
  save: { saveName: string; version: string; savedAt?: string; playDurationSeconds?: number };
  player: {
    position?: { x: number; y: number; z: number };
    biome?: string;
    within?: string;
    hub?: { x: number; y: number; z: number };
  };
  progress: {
    highestTier: number;
    tierMilestones: string[];
    spaceElevatorPhase?: number;
    /** The current phase's deliverables (effective amounts) and the tier it unlocks. */
    spaceElevatorCost?: { item: string; amount: number }[];
    spaceElevatorUnlocksTier?: number;
    mamTrees: string[];
  };
  recipes: {
    standardCount: number;
    alternateCount: number;
    alternates: string[];
    alternatesOmitted: number;
  };
  power: {
    capacityMw: number;
    consumptionMw: number;
    headroomMw: number;
    circuits: number;
    overloadedCircuits: number;
    /** `variable` marks output that is not in `mw` or the capacity (geothermal). */
    generators: { type: string; count: number; mw: number; variable?: true }[];
  };
  production: { item: string; perMinute: number; machines: number; unit?: 'm³' }[];
  storage: { item: string; quantity: number }[];
  nearbyResources: SummaryResourceNode[];
  unlocks: {
    buildings: string[];
    buildingsOmitted: number;
    partRecipes: string[];
    partRecipesOmitted: number;
  };
}

const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

const wholeMetres = (vec: {
  x: number;
  y: number;
  z: number;
}): {
  x: number;
  y: number;
  z: number;
} => ({ x: Math.round(vec.x), y: Math.round(vec.y), z: Math.round(vec.z) });

/** Descending by value, then ascending by name, so ties never reorder between builds. */
function byValueThenName<T>(value: (entry: T) => number, name: (entry: T) => string) {
  return (left: T, right: T): number =>
    value(right) - value(left) || name(left).localeCompare(name(right));
}

function summarisePlayer(views: SaveViews): SaveSummary['player'] {
  const { location, hubLocation } = views.player;
  return {
    ...(location === undefined ? {} : { position: wholeMetres(location) }),
    ...(views.playerBiome ?? {}),
    ...(hubLocation === undefined ? {} : { hub: wholeMetres(hubLocation) }),
  };
}

function summariseProgress(progress: MilestoneSummary): SaveSummary['progress'] {
  const purchased = progress.milestonesByTier.filter((tier) => tier.milestones.length > 0);
  const highest = purchased.reduce((best, tier) => (tier.tier > best.tier ? tier : best), {
    tier: 0,
    milestones: [] as MilestoneSummary['milestonesByTier'][number]['milestones'],
  });
  const phase = progress.assemblyPhase?.phase;
  return {
    highestTier: highest.tier,
    tierMilestones: highest.milestones
      .map((milestone) => milestone.displayName)
      .slice(0, SUMMARY_CAPS.tierMilestones),
    ...(phase === undefined ? {} : { spaceElevatorPhase: phase }),
    ...spaceElevatorGoal(progress),
    mamTrees: [...progress.mamResearch].sort(),
  };
}

/** The current Space Elevator phase's cost and unlock, when the game data carries phase costs. */
function spaceElevatorGoal(progress: MilestoneSummary): Partial<SaveSummary['progress']> {
  const current = progress.projectAssembly.find((phase) => phase.current);
  return current === undefined
    ? {}
    : {
        spaceElevatorCost: current.cost.map((entry) => ({
          item: entry.displayName,
          amount: entry.amount,
        })),
        spaceElevatorUnlocksTier: current.unlocksTier,
      };
}

function summariseUnlocks(unlocks: UnlockedNames): SaveSummary['unlocks'] {
  return {
    buildings: unlocks.buildings.slice(0, SUMMARY_CAPS.buildings),
    buildingsOmitted: Math.max(0, unlocks.buildings.length - SUMMARY_CAPS.buildings),
    partRecipes: unlocks.partRecipes.slice(0, SUMMARY_CAPS.partRecipes),
    partRecipesOmitted: Math.max(0, unlocks.partRecipes.length - SUMMARY_CAPS.partRecipes),
  };
}

function summariseRecipes(recipes: RecipeSummary): SaveSummary['recipes'] {
  const names = recipes.alternates.map((recipe) => recipe.displayName).sort();
  return {
    standardCount: recipes.standardCount,
    alternateCount: recipes.alternateCount,
    alternates: names.slice(0, SUMMARY_CAPS.alternates),
    alternatesOmitted: Math.max(0, names.length - SUMMARY_CAPS.alternates),
  };
}

function summarisePower(power: PowerView): SaveSummary['power'] {
  return {
    capacityMw: oneDecimal(power.totalCapacityMW),
    consumptionMw: oneDecimal(power.totalConsumptionMW),
    headroomMw: oneDecimal(power.totalCapacityMW - power.totalConsumptionMW),
    circuits: power.circuits.length,
    overloadedCircuits: power.circuits.filter((circuit) => circuit.status === 'overloaded').length,
    generators: [...power.generators]
      .sort(
        byValueThenName(
          (generator) => generator.capacityMW,
          (generator) => generator.building,
        ),
      )
      .slice(0, SUMMARY_CAPS.generatorTypes)
      .map((generator) => ({
        type: generator.building,
        count: generator.count,
        mw: oneDecimal(generator.capacityMW),
        ...(generator.variableOutput ? { variable: true as const } : {}),
      })),
  };
}

function summariseProduction(production: ProductionView): SaveSummary['production'] {
  return [...production.items]
    .sort(
      byValueThenName(
        (item) => item.effectivePerMinute,
        (item) => item.item,
      ),
    )
    .slice(0, SUMMARY_CAPS.production)
    .map((item) => ({
      item: item.item,
      perMinute: oneDecimal(item.effectivePerMinute),
      machines: item.machineCount,
      ...(item.unit === 'm³' ? { unit: 'm³' as const } : {}),
    }));
}

function summariseStorage(storage: StorageView): SaveSummary['storage'] {
  const totals = new Map<string, number>();
  const add = (stacks: NamedStack[]): void => {
    stacks.forEach((stack) => {
      totals.set(stack.displayName, (totals.get(stack.displayName) ?? 0) + stack.quantity);
    });
  };
  storage.containers.forEach((container) => add(container.inventory));
  add(storage.dimensionalDepot);
  return [...totals.entries()]
    .map(([item, quantity]) => ({ item, quantity }))
    .sort(
      byValueThenName(
        (entry) => entry.quantity,
        (entry) => entry.item,
      ),
    )
    .slice(0, SUMMARY_CAPS.storage);
}

/** Builds the capped, deterministic summary from a save's views. */
export function summariseSave(views: SaveViews): SaveSummary {
  return {
    save: { ...views.meta },
    player: summarisePlayer(views),
    progress: summariseProgress(views.progress),
    recipes: summariseRecipes(views.recipes),
    power: summarisePower(views.power),
    production: summariseProduction(views.production),
    storage: summariseStorage(views.storage),
    nearbyResources: views.nearbyResources.slice(0, SUMMARY_CAPS.resourceTypes),
    unlocks: summariseUnlocks(views.unlocks),
  };
}

/**
 * From nearest-first node hits, the nearest node of each resource type, up to `limit` types.
 * Geysers (no resource) are skipped. Not checked against existing miners.
 */
export function nearestPerResource(hits: ResourceNodeHit[], limit: number): ResourceNodeHit[] {
  const seen = new Set<string>();
  const nearest: ResourceNodeHit[] = [];
  for (const hit of hits) {
    const name = hit.resource?.displayName;
    if (name === undefined || seen.has(name) || nearest.length >= limit) {
      continue;
    }
    seen.add(name);
    nearest.push(hit);
  }
  return nearest;
}
