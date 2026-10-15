// Production-planning queries: the recursive ingredient tree, total raw inputs, a costed full
// production line (machines, extractors, estimated logistics) and the items buildable from given
// raw resources.

import type { IngredientUnit } from '@foreman/sf-game-data';
import {
  type QueryContext,
  displayForItem,
  itemByClass,
  machineForRecipe,
  round,
  unitForItem,
} from '../context.js';
import type {
  CostLine,
  ExtractionCost,
  FullProductionLineResult,
  IngredientTreeResult,
  LogisticsCost,
  ProductionComponent,
  ProductionMachineCost,
  RawInput,
} from '../types.js';

interface ProducingRecipe {
  className: string;
  displayName: string;
  isAlternate: boolean;
  outputPerMinute: number;
}

interface SubNode {
  recipe?: ProducingRecipe;
  ingredients: { className: string; perMinute: number }[];
}

export interface TotalRawInputsResult {
  item: string;
  itemClassName: string;
  targetPerMinute: number;
  unit: IngredientUnit;
  rawInputs: RawInput[];
  warnings: string[];
}

export interface BuildableItem {
  item: string;
  itemClassName: string;
}

async function producingRecipes(
  ctx: QueryContext,
  itemClassName: string,
): Promise<ProducingRecipe[]> {
  return (ctx.producersByItem.get(itemClassName) ?? []).map((recipe) => ({
    className: recipe.className,
    displayName: recipe.displayName,
    isAlternate: recipe.isAlternate,
    outputPerMinute: recipe.products.find((p) => p.itemClassName === itemClassName)?.perMinute ?? 0,
  }));
}

async function consumesOf(
  ctx: QueryContext,
  recipeClassName: string,
): Promise<{ className: string; perMinute: number }[]> {
  const recipe = ctx.gameData.recipes[recipeClassName];
  return (recipe?.ingredients ?? []).map((ingredient) => ({
    className: ingredient.itemClassName,
    perMinute: ingredient.perMinute,
  }));
}

function chooseRecipe(
  recipes: ProducingRecipe[],
  itemClassName: string,
  choiceMap: Map<string, string>,
  warnings: string[],
): ProducingRecipe | undefined {
  if (recipes.length === 0) {
    return undefined;
  }
  const override = choiceMap.get(itemClassName);
  if (override !== undefined) {
    const match = recipes.find((r) => r.className === override);
    if (match !== undefined) {
      return match;
    }
    warnings.push(`Recipe '${override}' does not produce '${itemClassName}'; using default.`);
  }
  const byClass = (a: ProducingRecipe, b: ProducingRecipe): number =>
    a.className.localeCompare(b.className);
  const standard = recipes.filter((r) => !r.isAlternate).sort(byClass);
  return standard[0] ?? [...recipes].sort(byClass)[0];
}

/**
 * Flattened per-minute requirements and machine counts for every tier of
 * production. The adjacency index supplies the structure (producing recipes and
 * their ingredients); the weighted multiplicative roll-up — demand multiplies
 * along each edge and sums across shared sub-components — is done here over a
 * topologically-ordered subgraph.
 */
export async function ingredientTree(
  ctx: QueryContext,
  itemName: string,
  targetPerMinute: number,
  recipeChoices?: Record<string, string>,
): Promise<IngredientTreeResult | undefined> {
  const targetCn = ctx.resolver.resolveItem(itemName);
  if (targetCn === undefined) {
    return undefined;
  }
  const warnings: string[] = [];

  const choiceMap = new Map<string, string>();
  if (recipeChoices !== undefined) {
    for (const [key, value] of Object.entries(recipeChoices)) {
      const itemKey = ctx.resolver.resolveItem(key) ?? key;
      const recipeValue = ctx.resolver.resolveRecipe(value) ?? value;
      choiceMap.set(itemKey, recipeValue);
    }
  }

  // Build the production subgraph, memoised so shared sub-trees are visited once.
  const nodes = new Map<string, SubNode>();
  const visit = async (cn: string): Promise<void> => {
    if (nodes.has(cn)) {
      return;
    }
    // Raw resources are always leaves. The game has Converter recipes that
    // produce ores (e.g. "Iron Ore (Limestone)"), but players mine ore — so a
    // resource terminates the tree regardless of any recipe that can make it.
    if (itemByClass(ctx.gameData, cn)?.isResource === true) {
      nodes.set(cn, { ingredients: [] });
      return;
    }
    const recipe = chooseRecipe(await producingRecipes(ctx, cn), cn, choiceMap, warnings);
    if (recipe === undefined) {
      nodes.set(cn, { ingredients: [] }); // raw resource / unproduced leaf
      return;
    }
    const node: SubNode = { recipe, ingredients: [] };
    nodes.set(cn, node); // set before recursing — guards against cycles
    const consumes = await consumesOf(ctx, recipe.className);
    node.ingredients = consumes;
    for (const ingredient of consumes) {
      await visit(ingredient.className);
    }
  };
  await visit(targetCn);

  // Topological order, target first. Back-edges (cycles) are reported and broken.
  const order: string[] = [];
  const temp = new Set<string>();
  const perm = new Set<string>();
  const topo = (cn: string): void => {
    if (perm.has(cn)) {
      return;
    }
    if (temp.has(cn)) {
      warnings.push(`Cycle detected at '${displayForItem(ctx.gameData, cn)}'; breaking.`);
      return;
    }
    temp.add(cn);
    for (const ingredient of nodes.get(cn)?.ingredients ?? []) {
      topo(ingredient.className);
    }
    temp.delete(cn);
    perm.add(cn);
    order.push(cn);
  };
  topo(targetCn);
  order.reverse();

  // Propagate demand from the target downwards.
  const demand = new Map<string, number>([[targetCn, targetPerMinute]]);
  const machineCount = new Map<string, number>();
  for (const cn of order) {
    const node = nodes.get(cn);
    const required = demand.get(cn) ?? 0;
    if (node?.recipe !== undefined) {
      const scale = node.recipe.outputPerMinute > 0 ? required / node.recipe.outputPerMinute : 0;
      machineCount.set(cn, (machineCount.get(cn) ?? 0) + scale);
      for (const ingredient of node.ingredients) {
        demand.set(
          ingredient.className,
          (demand.get(ingredient.className) ?? 0) + ingredient.perMinute * scale,
        );
      }
    }
  }

  const components: ProductionComponent[] = [];
  for (const cn of order) {
    if (cn === targetCn) {
      continue;
    }
    const node = nodes.get(cn);
    const component: ProductionComponent = {
      item: displayForItem(ctx.gameData, cn),
      itemClassName: cn,
      perMinute: round(demand.get(cn) ?? 0),
      unit: unitForItem(ctx.gameData, cn),
      isRaw: node?.recipe === undefined,
    };
    if (node?.recipe !== undefined) {
      component.recipe = node.recipe.displayName;
      const machine = machineForRecipe(ctx.gameData, node.recipe.className);
      if (machine !== undefined) {
        component.machine = machine;
      }
      component.machineCount = round(machineCount.get(cn) ?? 0);
    }
    components.push(component);
  }

  const targetNode = nodes.get(targetCn);
  const result: IngredientTreeResult = {
    item: displayForItem(ctx.gameData, targetCn),
    itemClassName: targetCn,
    targetPerMinute,
    unit: unitForItem(ctx.gameData, targetCn),
    recipe: targetNode?.recipe?.displayName ?? '(no recipe — raw item)',
    components,
    warnings,
  };
  if (targetNode?.recipe !== undefined) {
    const machine = machineForRecipe(ctx.gameData, targetNode.recipe.className);
    if (machine !== undefined) {
      result.machine = machine;
    }
    result.machineCount = round(machineCount.get(targetCn) ?? 0);
  }
  return result;
}

/** Leaf raw resources only — what the player actually mines/extracts. */
export async function totalRawInputs(
  ctx: QueryContext,
  itemName: string,
  targetPerMinute: number,
): Promise<TotalRawInputsResult | undefined> {
  const tree = await ingredientTree(ctx, itemName, targetPerMinute);
  if (tree === undefined) {
    return undefined;
  }
  const rawInputs: RawInput[] = tree.components
    .filter((component) => component.isRaw)
    .map((component) => ({
      item: component.item,
      itemClassName: component.itemClassName,
      perMinute: component.perMinute,
      unit: component.unit,
    }));
  return {
    item: tree.item,
    itemClassName: tree.itemClassName,
    targetPerMinute,
    unit: tree.unit,
    rawInputs,
    warnings: tree.warnings,
  };
}

// ── Full production-line costing (#66) ──────────────────────────────────────
// Stable building/resource class names (verified against the bundled data).
const MINERS = ['Build_MinerMk1_C', 'Build_MinerMk2_C', 'Build_MinerMk3_C'];
const BELTS = [
  'Build_ConveyorBeltMk1_C',
  'Build_ConveyorBeltMk2_C',
  'Build_ConveyorBeltMk3_C',
  'Build_ConveyorBeltMk4_C',
  'Build_ConveyorBeltMk5_C',
  'Build_ConveyorBeltMk6_C',
];
const PIPES = ['Build_Pipeline_C', 'Build_PipelineMK2_C'];
const WATER_EXTRACTOR = 'Build_WaterPump_C';
const OIL_EXTRACTOR = 'Build_OilPump_C';
const SPLITTER = 'Build_ConveyorAttachmentSplitter_C';
const MERGER = 'Build_ConveyorAttachmentMerger_C';
const WATER = 'Desc_Water_C';
const CRUDE_OIL = 'Desc_LiquidOil_C';
const PURITY: Record<string, number> = { impure: 0.5, normal: 1, pure: 2 };

export interface FullProductionLineOptions {
  minerMark?: number; // 1–3
  purity?: 'impure' | 'normal' | 'pure';
  beltMetresPerLink?: number;
}

/** Scales a building's build cost by `n` whole machines into displayable cost lines. */
function costLinesFor(ctx: QueryContext, buildingClass: string, n: number): CostLine[] {
  const building = ctx.gameData.buildings[buildingClass];
  if (building === undefined) {
    return [];
  }
  return building.buildCost.map((line) => ({
    item: displayForItem(ctx.gameData, line.itemClassName),
    itemClassName: line.itemClassName,
    amount: round(line.amount * n),
  }));
}

/**
 * Costs a whole production line for `item` at `targetPerMinute`: the exact build
 * cost of every production machine (honouring chosen recipes), the miners /
 * extractors to feed it, and a close-enough estimate of belts, pipes, splitters
 * and mergers — aggregated into one shopping list (#66). Logistics figures are
 * estimates (layout/length aren't in the game data) and flagged as such.
 */
export async function fullProductionLine(
  ctx: QueryContext,
  itemName: string,
  targetPerMinute: number,
  recipeChoices?: Record<string, string>,
  options: FullProductionLineOptions = {},
): Promise<FullProductionLineResult | undefined> {
  const tree = await ingredientTree(ctx, itemName, targetPerMinute, recipeChoices);
  if (tree === undefined) {
    return undefined;
  }
  const warnings = [...tree.warnings];
  const minerMark = Math.min(3, Math.max(1, Math.round(options.minerMark ?? 1)));
  const purity = options.purity ?? 'normal';
  const beltMetresPerLink = options.beltMetresPerLink ?? 10;

  const totals = new Map<string, CostLine>();
  const addCost = (lines: CostLine[]): void => {
    for (const line of lines) {
      const existing = totals.get(line.itemClassName);
      if (existing === undefined) {
        totals.set(line.itemClassName, { ...line });
      } else {
        existing.amount = round(existing.amount + line.amount);
      }
    }
  };

  // ── Production machines (exact) — target + every non-raw component. ─────────
  let splitterMergerLinks = 0;
  const productionMachines: ProductionMachineCost[] = [];
  const producers: { machine: string; recipe: string; exactCount: number }[] = [];
  if (tree.machine !== undefined && tree.machineCount !== undefined) {
    producers.push({ machine: tree.machine, recipe: tree.recipe, exactCount: tree.machineCount });
  }
  for (const c of tree.components) {
    if (
      !c.isRaw &&
      c.machine !== undefined &&
      c.machineCount !== undefined &&
      c.recipe !== undefined
    ) {
      producers.push({ machine: c.machine, recipe: c.recipe, exactCount: c.machineCount });
    }
  }
  for (const p of producers) {
    const count = Math.max(1, Math.ceil(p.exactCount));
    splitterMergerLinks += count - 1; // an N-machine manifold ≈ N-1 splitters + N-1 mergers
    const buildingClass = ctx.resolver.resolveBuilding(p.machine);
    const buildCost = buildingClass !== undefined ? costLinesFor(ctx, buildingClass, count) : [];
    if (buildingClass === undefined || buildCost.length === 0) {
      warnings.push(`No build cost found for '${p.machine}'; excluded from the total.`);
    }
    addCost(buildCost);
    productionMachines.push({
      building: p.machine,
      recipe: p.recipe,
      count,
      exactCount: round(p.exactCount),
      buildCost,
    });
  }

  // ── Extraction (exact) — miners for solids, pumps for water / crude oil. ────
  const extraction: ExtractionCost[] = [];
  for (const c of tree.components) {
    if (!c.isRaw) {
      continue;
    }
    let buildingClass: string | undefined;
    let purityScaled = true;
    if (c.itemClassName === WATER) {
      buildingClass = WATER_EXTRACTOR;
      purityScaled = false; // water extractors sit on water, not a purity-graded node
    } else if (c.itemClassName === CRUDE_OIL) {
      buildingClass = OIL_EXTRACTOR;
    } else if (c.unit === 'm³') {
      warnings.push(`'${c.item}' is extracted via a resource well; not costed here.`);
      continue;
    } else {
      buildingClass = MINERS[minerMark - 1];
    }
    const building =
      buildingClass !== undefined ? ctx.gameData.buildings[buildingClass] : undefined;
    const baseRate = building?.extractionRatePerMin;
    if (building === undefined || baseRate === undefined || baseRate <= 0) {
      warnings.push(`No extraction rate for '${c.item}'; extractor count omitted.`);
      continue;
    }
    const effectiveRate = baseRate * (purityScaled ? PURITY[purity]! : 1);
    const count = Math.max(1, Math.ceil(c.perMinute / effectiveRate));
    splitterMergerLinks += count - 1;
    const buildCost = costLinesFor(ctx, buildingClass!, count);
    addCost(buildCost);
    extraction.push({
      building: building.displayName,
      resource: c.item,
      ratePerMin: c.perMinute,
      count,
      buildCost,
    });
  }

  // ── Belts / pipes (estimate) — one carrying link per item flow in the tree. ─
  const logistics: LogisticsCost[] = [];
  const flows = tree.components.filter((c) => c.perMinute > 0);
  for (const flow of flows) {
    const fluid = flow.unit === 'm³';
    const marks = fluid ? PIPES : BELTS;
    const rateOf = (b: string): number =>
      (fluid
        ? ctx.gameData.buildings[b]?.pipeFlowPerMin
        : ctx.gameData.buildings[b]?.conveyorSpeedPerMin) ?? 0;
    // Smallest mark that carries the flow in one line; else the top mark in parallel.
    let markIndex = marks.findIndex((b) => rateOf(b) >= flow.perMinute);
    if (markIndex === -1) {
      markIndex = marks.length - 1;
    }
    const buildingClass = marks[markIndex]!;
    const throughput = rateOf(buildingClass);
    if (throughput <= 0) {
      continue;
    }
    const lines = Math.max(1, Math.ceil(flow.perMinute / throughput));
    const units = fluid ? lines : lines * beltMetresPerLink; // belts cost per metre
    const buildCost = costLinesFor(ctx, buildingClass, units);
    addCost(buildCost);
    logistics.push({
      kind: fluid ? 'pipe' : 'belt',
      building: ctx.gameData.buildings[buildingClass]?.displayName ?? buildingClass,
      mark: markIndex + 1,
      lines,
      forItem: flow.item,
      count: lines,
      estimated: true,
      buildCost,
    });
  }

  // ── Splitters / mergers (estimate) — manifolds around parallel machines. ────
  for (const [kind, buildingClass] of [
    ['splitter', SPLITTER],
    ['merger', MERGER],
  ] as const) {
    if (splitterMergerLinks <= 0) {
      break;
    }
    const buildCost = costLinesFor(ctx, buildingClass, splitterMergerLinks);
    addCost(buildCost);
    logistics.push({
      kind,
      building: ctx.gameData.buildings[buildingClass]?.displayName ?? buildingClass,
      count: splitterMergerLinks,
      estimated: true,
      buildCost,
    });
  }

  warnings.push(
    'Belt, pipe, splitter and merger figures are estimates — they depend on factory layout, ' +
      `which is not in the game data (assumed ${beltMetresPerLink} m of belt per machine link).`,
  );

  return {
    item: tree.item,
    itemClassName: tree.itemClassName,
    targetPerMinute,
    unit: tree.unit,
    recipe: tree.recipe,
    productionMachines,
    extraction,
    logistics,
    totalBuildCost: [...totals.values()],
    assumptions: { minerMark, purity, beltMetresPerLink },
    warnings,
  };
}

/**
 * Items producible from a set of raw resources. A fixpoint closure over recipe
 * edges fetched from the graph: an item is buildable only when every ingredient
 * of some recipe producing it is already buildable.
 */
export async function buildableWith(
  ctx: QueryContext,
  resourceNames: string[],
): Promise<BuildableItem[]> {
  const available = new Set<string>();
  for (const name of resourceNames) {
    const className = ctx.resolver.resolveItem(name);
    if (className !== undefined) {
      available.add(className);
    }
  }
  const seeds = new Set(available);

  const ingredientsByRecipe = new Map<string, string[]>();
  const productsByRecipe = new Map<string, string[]>();
  for (const recipe of Object.values(ctx.gameData.recipes)) {
    ingredientsByRecipe.set(
      recipe.className,
      recipe.ingredients.map((i) => i.itemClassName),
    );
    productsByRecipe.set(
      recipe.className,
      recipe.products.map((p) => p.itemClassName),
    );
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [recipe, ingredients] of ingredientsByRecipe) {
      if (!ingredients.every((cn) => available.has(cn))) {
        continue;
      }
      for (const product of productsByRecipe.get(recipe) ?? []) {
        if (!available.has(product)) {
          available.add(product);
          changed = true;
        }
      }
    }
  }

  return [...available]
    .filter((cn) => !seeds.has(cn))
    .map((cn) => ({ item: displayForItem(ctx.gameData, cn), itemClassName: cn }))
    .sort((a, b) => a.item.localeCompare(b.item));
}
