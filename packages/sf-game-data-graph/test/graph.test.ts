import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import type { GameData } from '@foreman/sf-game-data';
import { GraphDB, initGraph } from '../src/graph/index.js';

// These tests assert exact, controlled counts ("2 recipes", "3 rows"), so they run
// against a small, fixed GameData fixture rather than the full bundled dataset.
// The hand-written parser + its raw-docs fixture were retired in #162; this static
// GameData was generated from that raw-docs fixture (version 'test-1.0') and frozen
// here. (power.test.ts asserts real in-game numbers and uses the bundled dataset.)
const gameData: GameData = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('./fixtures/game-data.json', import.meta.url)), 'utf8'),
);

let graph: GraphDB;

beforeAll(async () => {
  graph = await initGraph(gameData);
});

describe('ingredient_tree', () => {
  it('returns a flat, correct breakdown with machine counts for Reinforced Iron Plate @ 5/min', async () => {
    const tree = await graph.ingredientTree('Reinforced Iron Plate', 5);
    expect(tree?.recipe).toBe('Reinforced Iron Plate');
    expect(tree?.machine).toBe('Assembler');
    expect(tree?.machineCount).toBe(1);

    const find = (cn: string) => tree?.components.find((c) => c.itemClassName === cn);
    expect(find('Desc_IronIngot_C')).toMatchObject({
      perMinute: 60,
      machine: 'Smelter',
      machineCount: 2,
    });
    expect(find('Desc_IronPlate_C')).toMatchObject({ perMinute: 30, machineCount: 1.5 });
    expect(find('Desc_IronScrew_C')).toMatchObject({ perMinute: 60, machineCount: 1.5 });
    expect(find('Desc_OreIron_C')).toMatchObject({ perMinute: 60, isRaw: true });
  });

  it('honours a recipe choice override (Bolted Iron Plate)', async () => {
    const tree = await graph.ingredientTree('Reinforced Iron Plate', 15, {
      'Reinforced Iron Plate': 'Alternate: Bolted Iron Plate',
    });
    expect(tree?.recipe).toBe('Alternate: Bolted Iron Plate');
  });
});

describe('total_raw_inputs', () => {
  it('terminates at raw resource leaves for Reinforced Iron Plate', async () => {
    const result = await graph.totalRawInputs('Reinforced Iron Plate', 5);
    expect(result?.rawInputs).toEqual([
      { item: 'Iron Ore', itemClassName: 'Desc_OreIron_C', perMinute: 60, unit: 'items' },
    ]);
  });

  it('reports fluid raw inputs in m³ (Plastic → Crude Oil)', async () => {
    const result = await graph.totalRawInputs('Plastic', 20);
    expect(result?.rawInputs).toEqual([
      { item: 'Crude Oil', itemClassName: 'Desc_LiquidOil_C', perMinute: 30, unit: 'm³' },
    ]);
  });
});

describe('full_production_line', () => {
  it('costs production machines (exact), extraction, and estimated logistics', async () => {
    const line = await graph.fullProductionLine('Reinforced Iron Plate', 5);
    expect(line).toBeDefined();

    // Production machines: exact, every tier, whole-machine counts ≥ exact.
    const buildings = line!.productionMachines.map((m) => m.building);
    expect(buildings).toContain('Assembler');
    expect(buildings).toContain('Smelter');
    expect(buildings).toContain('Constructor');
    for (const m of line!.productionMachines) {
      expect(m.count).toBeGreaterThanOrEqual(Math.ceil(m.exactCount));
      expect(m.buildCost.length).toBeGreaterThan(0);
    }

    // Extraction: a miner for the iron ore leaf.
    const miner = line!.extraction.find((e) => e.resource === 'Iron Ore');
    expect(miner?.building).toBe('Miner Mk.1');
    expect(miner!.count).toBeGreaterThanOrEqual(1);

    // Logistics: estimated belts + splitters + mergers, all flagged.
    const kinds = new Set(line!.logistics.map((l) => l.kind));
    expect(kinds.has('belt')).toBe(true);
    expect(kinds.has('splitter')).toBe(true);
    expect(kinds.has('merger')).toBe(true);
    expect(line!.logistics.every((l) => l.estimated)).toBe(true);

    // One aggregated shopping list + the estimate caveat.
    expect(line!.totalBuildCost.length).toBeGreaterThan(0);
    expect(line!.assumptions).toMatchObject({ minerMark: 1, purity: 'normal' });
    expect(line!.warnings.some((w) => w.toLowerCase().includes('estimate'))).toBe(true);
  });

  it('honours an alt-recipe choice (changes the production set)', async () => {
    const line = await graph.fullProductionLine('Reinforced Iron Plate', 15, {
      'Reinforced Iron Plate': 'Alternate: Bolted Iron Plate',
    });
    expect(line?.recipe).toBe('Alternate: Bolted Iron Plate');
  });

  it('scales miners down on a pure node vs a normal one', async () => {
    const normal = await graph.fullProductionLine('Reinforced Iron Plate', 120, {});
    const pure = await graph.fullProductionLine(
      'Reinforced Iron Plate',
      120,
      {},
      { purity: 'pure' },
    );
    const minersOf = (r: typeof normal): number =>
      r!.extraction.find((e) => e.resource === 'Iron Ore')!.count;
    expect(minersOf(pure)).toBeLessThan(minersOf(normal));
  });
});

describe('recipes_for', () => {
  it('returns all producing recipes and flags the standard one', async () => {
    const result = await graph.recipesFor('Reinforced Iron Plate');
    expect(result?.recipes).toHaveLength(2);
    const standard = result?.recipes.find((r) => r.isStandard);
    expect(standard?.className).toBe('Recipe_IronPlateReinforced_C');
    expect(result?.recipes.some((r) => r.isAlternate)).toBe(true);
  });
});

describe('buildable_with', () => {
  it('returns the transitive closure from iron ore (excluding plastic, which needs oil)', async () => {
    const buildable = await graph.buildableWith(['Iron Ore']);
    const names = buildable.map((b) => b.item);
    expect(names).toEqual(
      expect.arrayContaining([
        'Iron Ingot',
        'Iron Plate',
        'Iron Rod',
        'Screw',
        'Reinforced Iron Plate',
      ]),
    );
    expect(names).not.toContain('Plastic');
  });
});

describe('get_recipe byproducts', () => {
  it('returns both products for a byproduct recipe', () => {
    const recipe = graph.getRecipe('Plastic');
    expect(recipe?.products).toHaveLength(2);
  });
});

describe('listItems', () => {
  it('lists every item and resource, sorted by display name', () => {
    const items = graph.listItems();
    const names = items.map((i) => i.displayName);
    // 7 items + 3 resources in the fixture.
    expect(items).toHaveLength(10);
    expect(names).toContain('Iron Plate');
    expect(names).toContain('Iron Ore'); // resource, folded into the item set
    expect(names).toContain('Crude Oil');
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('narrows by a case-insensitive search over display and class name', () => {
    const names = graph.listItems({ search: 'IRON' }).map((i) => i.displayName);
    expect(names).toContain('Iron Plate');
    expect(names).toContain('Iron Ore');
    expect(names).toContain('Screw'); // matches via class name Desc_IronScrew_C
    expect(names).not.toContain('Plastic');
  });

  it('returns [] when nothing matches', () => {
    expect(graph.listItems({ search: 'zzznope' })).toEqual([]);
  });
});

describe('listRecipes', () => {
  it('lists every recipe with its alternate flag', () => {
    const recipes = graph.listRecipes();
    expect(recipes).toHaveLength(9);
    const alt = recipes.find((r) => r.displayName === 'Alternate: Bolted Iron Plate');
    expect(alt?.isAlternate).toBe(true);
    const standard = recipes.find((r) => r.className === 'Recipe_IronPlate_C');
    expect(standard?.isAlternate).toBe(false);
  });

  it('narrows by search term', () => {
    const names = graph.listRecipes({ search: 'plate' }).map((r) => r.displayName);
    expect(names).toEqual(
      expect.arrayContaining([
        'Iron Plate',
        'Reinforced Iron Plate',
        'Alternate: Bolted Iron Plate',
      ]),
    );
    expect(names).not.toContain('Screw');
  });
});

describe('listSchematics search', () => {
  it('narrows by search term alongside the tier filter', () => {
    expect(graph.listSchematics({ search: 'plate' }).map((s) => s.displayName)).toEqual([
      'Plate Production',
    ]);
    expect(graph.listSchematics({ search: 'zzznope' })).toEqual([]);
    expect(graph.listSchematics({ tier: 0 })).toHaveLength(1);
    expect(graph.listSchematics({ tier: 5 })).toEqual([]);
  });
});

describe('version tagging', () => {
  it('exposes the parsed game version', () => {
    expect(graph.version).toBe('test-1.0');
  });
});
