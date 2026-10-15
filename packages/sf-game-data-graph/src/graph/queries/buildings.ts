// Building queries: look up a building's power profile and build cost, list buildable names,
// and list power generators with their fuel rates.

import type { Building, GeneratorFuel } from '@foreman/sf-game-data';
import type { QueryContext } from '../context.js';
import { displayForItem } from '../context.js';

/** A build-cost line with the item's display name resolved. */
export interface BuildCostView {
  item: string;
  itemClassName: string;
  amount: number;
}

/** A building with its power profile and build cost, ready for the model. */
export interface BuildingView {
  className: string;
  displayName: string;
  category: string;
  description: string;
  /** Constant MW draw (0 for generators and variable-power machines). */
  powerConsumption: number;
  /** Max MW draw for variable-power machines (Particle Accelerator, …). */
  maxPowerConsumption?: number;
  /** MW generated (power generators only). */
  powerProduction?: number;
  /** True when output is variable/geyser-dependent (Geothermal). */
  variablePowerProduction?: boolean;
  /** Fuel options with derived per-minute rates (fuel generators only). */
  fuels?: GeneratorFuel[];
  buildCost: BuildCostView[];
}

/** A compact building entry for name discovery (no power/cost detail). */
export interface BuildingSummary {
  className: string;
  displayName: string;
  category: string;
}

/** A power generator with its output and fuel/water/byproduct rates. */
export interface GeneratorSummary {
  className: string;
  displayName: string;
  powerProduction?: number;
  variablePowerProduction?: boolean;
  fuels: GeneratorFuel[];
}

function toView(ctx: QueryContext, building: Building): BuildingView {
  const view: BuildingView = {
    className: building.className,
    displayName: building.displayName,
    category: building.category,
    description: building.description,
    powerConsumption: building.powerConsumption,
    buildCost: building.buildCost.map((line) => ({
      item: displayForItem(ctx.gameData, line.itemClassName),
      itemClassName: line.itemClassName,
      amount: line.amount,
    })),
  };
  if (building.maxPowerConsumption !== undefined) {
    view.maxPowerConsumption = building.maxPowerConsumption;
  }
  if (building.powerProduction !== undefined) {
    view.powerProduction = building.powerProduction;
  }
  if (building.variablePowerProduction === true) {
    view.variablePowerProduction = true;
  }
  if (building.fuels !== undefined) {
    view.fuels = building.fuels;
  }
  return view;
}

/** Resolve a building by display or class name; returns its full profile. */
export function getBuilding(ctx: QueryContext, name: string): BuildingView | undefined {
  const className = ctx.resolver.resolveBuilding(name);
  if (className === undefined) {
    return undefined;
  }
  const building = ctx.gameData.buildings[className];
  return building === undefined ? undefined : toView(ctx, building);
}

/**
 * Every real, named buildable as a compact `{ className, displayName, category }`
 * entry — the foreman's way to discover canonical building names before naming a
 * buildable in a work order. Excludes the dataless `Desc_*` descriptors (empty
 * display name). Optionally narrows by a case-insensitive `search` substring
 * (matched against display name, class name, and category) and/or an exact
 * (case-insensitive) `category`.
 */
export function listBuildings(
  ctx: QueryContext,
  opts?: { search?: string; category?: string },
): BuildingSummary[] {
  const search = opts?.search?.trim().toLowerCase();
  const category = opts?.category?.trim().toLowerCase();
  const results: BuildingSummary[] = [];
  for (const building of Object.values(ctx.gameData.buildings)) {
    if (building.displayName === '') {
      continue;
    }
    if (category !== undefined && category !== '' && building.category.toLowerCase() !== category) {
      continue;
    }
    if (search !== undefined && search !== '') {
      const haystack =
        `${building.displayName} ${building.className} ${building.category}`.toLowerCase();
      if (!haystack.includes(search)) {
        continue;
      }
    }
    results.push({
      className: building.className,
      displayName: building.displayName,
      category: building.category,
    });
  }
  return results.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Every power-generating building with its output and complete fuel breakdown
 * (fuel burn, supplemental water, and byproduct rates per minute). The single
 * source of truth for power planning.
 */
export function listPowerGenerators(ctx: QueryContext): GeneratorSummary[] {
  const generators: GeneratorSummary[] = [];
  for (const building of Object.values(ctx.gameData.buildings)) {
    const isGenerator =
      building.powerProduction !== undefined ||
      building.variablePowerProduction === true ||
      building.fuels !== undefined;
    if (!isGenerator) {
      continue;
    }
    const summary: GeneratorSummary = {
      className: building.className,
      displayName: building.displayName,
      fuels: building.fuels ?? [],
    };
    if (building.powerProduction !== undefined) {
      summary.powerProduction = building.powerProduction;
    }
    if (building.variablePowerProduction === true) {
      summary.variablePowerProduction = true;
    }
    generators.push(summary);
  }
  return generators.sort((a, b) => (a.powerProduction ?? 0) - (b.powerProduction ?? 0));
}
