import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { McpGateway, ToolDefinition, ToolInvocationResult } from '../src/mcp/client.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import {
  BLOCK_WORK_ORDER,
  CREATE_CHILD_WORK_ORDER,
  CREATE_EXPLORE_ORDER,
  CREATE_WORK_ORDER,
  PROPOSE_COMPLETION,
  REVISE_WORK_ORDER,
  handleWorkOrderTool,
  isWorkOrderTool,
  resolvePlanReferences,
  workOrderToolDefinitions,
  type WorkOrderToolDeps,
} from '../src/tools/workOrderTools.js';
import { createTestDb, createTestPlaythrough, type TestDb } from './helpers.js';

let db: TestDb;
let deps: WorkOrderToolDeps;

async function seedPlaythrough(): Promise<string> {
  return createTestPlaythrough(db.prisma);
}

/**
 * A stub gateway covering every resolver + discovery tool resolvePlanReferences uses:
 * get_building/get_recipe/get_item/get_schematic (exact-match, isError on a miss) and
 * their list_* discovery counterparts (backing best-match suggestions).
 */
function stubMcp(): McpGateway {
  const costs: Record<
    string,
    { className: string; buildCost: { item: string; itemClassName: string; amount: number }[] }
  > = {
    Smelter: {
      className: 'Build_SmelterMk1_C',
      buildCost: [{ item: 'Iron Rod', itemClassName: 'Desc_IronRod_C', amount: 5 }],
    },
    'Conveyor Splitter': {
      className: 'Build_ConveyorAttachmentSplitter_C',
      buildCost: [{ item: 'Iron Plate', itemClassName: 'Desc_IronPlate_C', amount: 2 }],
    },
    'Coal-Powered Generator': {
      className: 'Build_GeneratorCoal_C',
      buildCost: [{ item: 'Rotor', itemClassName: 'Desc_Rotor_C', amount: 10 }],
    },
    'Fuel-Powered Generator': {
      className: 'Build_GeneratorFuel_C',
      buildCost: [{ item: 'Motor', itemClassName: 'Desc_Motor_C', amount: 5 }],
    },
    'Geothermal Generator': {
      className: 'Build_GeneratorGeoThermal_C',
      buildCost: [{ item: 'Copper Sheet', itemClassName: 'Desc_CopperSheet_C', amount: 20 }],
    },
    Constructor: {
      className: 'Build_ConstructorMk1_C',
      buildCost: [
        { item: 'Reinforced Iron Plate', itemClassName: 'Desc_IronPlateReinforced_C', amount: 2 },
      ],
    },
    Assembler: {
      className: 'Build_AssemblerMk1_C',
      buildCost: [{ item: 'Rotor', itemClassName: 'Desc_Rotor_C', amount: 4 }],
    },
    Refinery: {
      className: 'Build_OilRefinery_C',
      buildCost: [{ item: 'Motor', itemClassName: 'Desc_Motor_C', amount: 4 }],
    },
  };
  // Full RecipeView data (per single machine at 100% clock) for get_recipe + derivation.
  const recipeViews: Record<
    string,
    {
      className: string;
      producedIn: string[];
      ingredients: { item: string; perMinute: number }[];
      products: { item: string; perMinute: number }[];
    }
  > = {
    'Iron Plate': {
      className: 'Recipe_IronPlate_C',
      producedIn: ['Constructor'],
      ingredients: [{ item: 'Iron Ingot', perMinute: 30 }],
      products: [{ item: 'Iron Plate', perMinute: 20 }],
    },
    Screw: {
      className: 'Recipe_Screw_C',
      producedIn: ['Constructor'],
      ingredients: [{ item: 'Iron Rod', perMinute: 10 }],
      products: [{ item: 'Screw', perMinute: 40 }],
    },
    // A byproduct recipe (two products) to exercise multi-product aggregation.
    Fuel: {
      className: 'Recipe_Fuel_C',
      producedIn: ['Refinery'],
      ingredients: [{ item: 'Crude Oil', perMinute: 60 }],
      products: [
        { item: 'Fuel', perMinute: 40 },
        { item: 'Polymer Resin', perMinute: 30 },
      ],
    },
  };
  const items: Record<string, string> = {
    'Iron Ore': 'Desc_OreIron_C',
    'Iron Ingot': 'Desc_IronIngot_C',
    'Iron Plate': 'Desc_IronPlate_C',
  };
  const schematics: Record<string, string> = { 'Plate Production': 'Schematic_Tier0_Plates_C' };

  // The lists backing list_* (used to suggest names on a miss).
  const buildings = [
    { className: 'Build_SmelterMk1_C', displayName: 'Smelter', category: 'Manufacturer' },
    {
      className: 'Build_ConveyorAttachmentSplitter_C',
      displayName: 'Conveyor Splitter',
      category: 'AttachmentSplitter',
    },
    {
      className: 'Build_ConveyorAttachmentSplitterSmart_C',
      displayName: 'Smart Splitter',
      category: 'SplitterSmart',
    },
  ];
  const recipeList = [
    { className: 'Recipe_IronPlate_C', displayName: 'Iron Plate' },
    { className: 'Recipe_IngotIron_C', displayName: 'Iron Ingot' },
    { className: 'Recipe_IngotPureIron_C', displayName: 'Alternate: Pure Iron Ingot' },
  ];
  const itemList = [
    { className: 'Desc_OreIron_C', displayName: 'Iron Ore' },
    { className: 'Desc_IronIngot_C', displayName: 'Iron Ingot' },
    { className: 'Desc_IronPlate_C', displayName: 'Iron Plate' },
  ];
  const schematicList = [
    { className: 'Schematic_Tier0_Plates_C', displayName: 'Plate Production' },
  ];
  // Backs list_power_generators: two fixed-output types + one variable (Geothermal).
  const powerGenerators = [
    {
      className: 'Build_GeneratorCoal_C',
      displayName: 'Coal-Powered Generator',
      powerProduction: 75,
    },
    {
      className: 'Build_GeneratorFuel_C',
      displayName: 'Fuel-Powered Generator',
      powerProduction: 250,
    },
    {
      className: 'Build_GeneratorGeoThermal_C',
      displayName: 'Geothermal Generator',
      variablePowerProduction: true,
    },
  ];

  /** A get_* result: the entity under `key` on a hit, isError on a miss. */
  const resolved = (
    map: Record<string, string>,
    name: string,
    key: string,
  ): ToolInvocationResult =>
    map[name] === undefined
      ? { text: `Not found: ${key}.`, isError: true }
      : { text: JSON.stringify({ [key]: { className: map[name] } }), isError: false };

  return {
    gameVersion: '1.2.3.0',
    listTools: async (): Promise<ToolDefinition[]> => [],
    callTool: async (name, args): Promise<ToolInvocationResult> => {
      const argName = String((args as { name?: string }).name);
      switch (name) {
        case 'get_building': {
          const building = costs[argName];
          return building === undefined
            ? { text: 'Not found: building.', isError: true }
            : { text: JSON.stringify({ building }), isError: false };
        }
        case 'get_recipe': {
          const view = recipeViews[argName];
          return view === undefined
            ? { text: 'Not found: recipe.', isError: true }
            : {
                text: JSON.stringify({
                  recipe: {
                    className: view.className,
                    displayName: argName,
                    isAlternate: false,
                    producedIn: view.producedIn,
                    ingredients: view.ingredients,
                    products: view.products,
                  },
                }),
                isError: false,
              };
        }
        case 'get_item':
          return resolved(items, argName, 'item');
        case 'get_schematic':
          return resolved(schematics, argName, 'schematic');
        case 'list_buildings':
          return { text: JSON.stringify({ buildings }), isError: false };
        case 'list_recipes':
          return { text: JSON.stringify({ recipes: recipeList }), isError: false };
        case 'list_items':
          return { text: JSON.stringify({ items: itemList }), isError: false };
        case 'list_schematics':
          return { text: JSON.stringify({ schematics: schematicList }), isError: false };
        case 'list_power_generators':
          return { text: JSON.stringify({ generators: powerGenerators }), isError: false };
        case 'resolve_collectibles': {
          const ids = ((args as { ids?: string[] }).ids ?? []) as string[];
          const world: Record<string, Record<string, unknown>> = {
            'C-SLOOP': { kind: 'somersloop', guid: 'G-SLOOP', x: 1, y: 2, z: 0 },
            'C-POD': {
              kind: 'hardDrive',
              guid: 'G-POD',
              unlock: { powerMW: 250 },
              x: 3,
              y: 4,
              z: 0,
            },
          };
          const resolved: Record<string, unknown>[] = [];
          const unresolved: string[] = [];
          for (const id of ids) {
            const c = world[id];
            if (c === undefined) {
              unresolved.push(id);
            } else {
              resolved.push({ id, ...c });
            }
          }
          return { text: JSON.stringify({ resolved, unresolved }), isError: false };
        }
        default:
          return { text: '', isError: true };
      }
    },
  };
}

const validCreateInput = {
  title: 'Establish Iron Ingot Line',
  goal: 'Smelt 30 iron ingots per minute.',
  buildSteps: [
    { title: 'Place two smelters', buildables: [{ name: 'Smelter', requiredCount: 2 }] },
  ],
  expectedOutputs: [{ kind: 'item', item: 'Iron Ingot', perMinute: 30 }],
};

/**
 * A plan exercising every resolvable name kind (buildable, per-block recipe, expected-output
 * item, unlock schematic, resource). Recipes are annotated on the production block (#228); the
 * server derives the recipes[] rates. 3 Constructors × 20 Iron Plate/min = 60 → meets the target.
 */
const validFullCreateInput = {
  title: 'Iron Plate Line',
  goal: 'Make iron plates.',
  buildSteps: [
    {
      title: 'Constructors',
      buildables: [{ name: 'Constructor', requiredCount: 3, recipeName: 'Iron Plate' }],
    },
  ],
  expectedOutputs: [
    { kind: 'item', item: 'Iron Plate', perMinute: 60 },
    { kind: 'unlock', schematic: 'Plate Production' },
  ],
  resourceNodes: [{ resourceName: 'Iron Ore', purity: 'normal' }],
};

beforeAll(async () => {
  db = await createTestDb();
  deps = {
    workOrders: new WorkOrderService(db.prisma),
    gameVersion: () => '1.2.3.0',
    mcp: stubMcp(),
  };
});

afterAll(async () => {
  await db.cleanup();
});

describe('work-order tool registry', () => {
  it('recognises the server-local tools and nothing else', () => {
    expect(isWorkOrderTool(CREATE_WORK_ORDER)).toBe(true);
    expect(isWorkOrderTool(PROPOSE_COMPLETION)).toBe(true);
    expect(isWorkOrderTool('get_recipe')).toBe(false);
  });

  it('exposes valid Anthropic tool definitions', () => {
    const defs = workOrderToolDefinitions();
    expect(defs.length).toBeGreaterThanOrEqual(7);
    for (const def of defs) {
      expect(def.inputSchema['type']).toBe('object');
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('exposes resourceNodes and opportunities in the create/revise schemas (#232)', () => {
    for (const name of [CREATE_WORK_ORDER, REVISE_WORK_ORDER]) {
      const def = workOrderToolDefinitions().find((d) => d.name === name);
      const props = (def?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(props['resourceNodes']).toBeDefined();
      expect(props['opportunities']).toBeDefined();
    }
  });
});

describe('handleWorkOrderTool', () => {
  it('creates an order in the new state, stamps the version, and resolves build cost', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validCreateInput,
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.sequenceNumber).toBe(1);
    expect(outcome.workOrder?.state).toBe('new');
    expect(outcome.workOrder?.version).toBe('1.2.3.0');
    expect(outcome.text).toContain('WO-001');
    // The server resolved the Smelter's per-unit build cost via get_building.
    const buildable = outcome.workOrder?.buildSteps[0]?.buildables[0];
    expect(buildable?.buildingClass).toBe('Build_SmelterMk1_C');
    expect(buildable?.buildCost).toEqual([
      { itemName: 'Iron Rod', itemClass: 'Desc_IronRod_C', amount: 5 },
    ]);
  });

  it('carries model-authored resourceNodes + opportunities on a created order (#232)', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      {
        ...validFullCreateInput,
        resourceNodes: [
          { resourceName: 'Iron Ore', purity: 'normal', coordinates: { x: 1, y: 2, z: 0 } },
        ],
        opportunities: {
          nearbyCollectiblesFromPlayer: [
            { kind: 'somersloop', optional: true, reason: 'On the way' },
          ],
          notes: ['Grab the slug while you are here.'],
        },
      },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.resourceNodes?.[0]).toMatchObject({
      resourceName: 'Iron Ore',
      purity: 'normal',
    });
    expect(outcome.workOrder?.opportunities?.nearbyCollectiblesFromPlayer?.[0]?.kind).toBe(
      'somersloop',
    );
  });

  it('does not supersede the previous order on a second create', async () => {
    const playthrough = await seedPlaythrough();
    await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, validCreateInput, deps);
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      { ...validCreateInput, title: 'Pivot to copper' },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('WO-002');
    expect(await deps.workOrders.list(playthrough)).toHaveLength(2);
  });

  it('rejects invalid create input without persisting', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, { title: '' }, deps);
    expect(outcome.isError).toBe(true);
    expect(outcome.workOrder).toBeUndefined();
    expect(await deps.workOrders.list(playthrough)).toHaveLength(0);
  });

  it('rejects (and does not persist) an order naming an unresolvable buildable', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      {
        ...validCreateInput,
        buildSteps: [{ title: 'Belts', buildables: [{ name: 'Splitter', requiredCount: 15 }] }],
      },
      deps,
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.workOrder).toBeUndefined();
    expect(outcome.text).toContain('Conveyor Splitter'); // suggestion in the rejection
    // Nothing was written — the foreman must fix the name and retry.
    expect(await deps.workOrders.list(playthrough)).toHaveLength(0);
  });

  it('revises the current order in place rather than creating a new one', async () => {
    const playthrough = await seedPlaythrough();
    const created = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validCreateInput,
      deps,
    );
    // No Start — the order is still `new`. Revise must still target it.
    const outcome = await handleWorkOrderTool(
      playthrough,
      REVISE_WORK_ORDER,
      { goal: 'Smelt 45 iron ingots per minute.', changeSummary: 'Bumped target.' },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.id).toBe(created.workOrder?.id);
    expect(outcome.workOrder?.sequenceNumber).toBe(1);
    expect(outcome.workOrder?.currentRevision).toBe(2);
    expect(await deps.workOrders.list(playthrough)).toHaveLength(1);
  });

  it('refuses to propose completion of a new (unstarted) order', async () => {
    const playthrough = await seedPlaythrough();
    await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, validCreateInput, deps);
    const outcome = await handleWorkOrderTool(playthrough, PROPOSE_COMPLETION, {}, deps);
    // A work order can't be completed before the pioneer has started it.
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/started/i);
  });

  it('proposes completion of the active order without completing it', async () => {
    const playthrough = await seedPlaythrough();
    const created = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validCreateInput,
      deps,
    );
    await deps.workOrders.transition(playthrough, created.workOrder!.id, 'Start', 'Pioneer');

    const outcome = await handleWorkOrderTool(playthrough, PROPOSE_COMPLETION, {}, deps);
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toMatch(/confirm/i);
    // State is unchanged — the foreman cannot complete.
    expect(outcome.workOrder?.state).toBe('active');
  });

  it('blocks the active order with a reason and resolution hint', async () => {
    const playthrough = await seedPlaythrough();
    const created = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validCreateInput,
      deps,
    );
    await deps.workOrders.transition(playthrough, created.workOrder!.id, 'Start', 'Pioneer');

    const outcome = await handleWorkOrderTool(
      playthrough,
      BLOCK_WORK_ORDER,
      { blockedReason: 'Recipe locked.', blockedResolutionHint: 'Research it in the MAM.' },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.state).toBe('blocked');
  });

  it('errors when proposing completion with no active order', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(playthrough, PROPOSE_COMPLETION, {}, deps);
    expect(outcome.isError).toBe(true);
  });
});

describe('ingest-time name resolution (#222)', () => {
  it('persists an order when every name resolves (buildable, machine, recipe, items, schematic, resource)', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validFullCreateInput,
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder).toBeDefined();
    expect(await deps.workOrders.list(playthrough)).toHaveLength(1);
  });

  // A production block carrying a bad recipe name.
  const badRecipeSteps = [
    {
      title: 'Constructors',
      buildables: [{ name: 'Constructor', requiredCount: 3, recipeName: 'Iron Plates' }],
    },
  ];

  // Each row overrides exactly one resolvable field with a bad name; the rest resolve.
  const cases: {
    field: string;
    patch: Record<string, unknown>;
    bad: string;
    suggestion: string;
    listTool: string;
  }[] = [
    {
      field: 'buildable recipeName',
      patch: { buildSteps: badRecipeSteps },
      bad: 'Iron Plates',
      suggestion: 'Iron Plate',
      listTool: 'list_recipes',
    },
    {
      field: 'expectedOutputs item',
      patch: { expectedOutputs: [{ kind: 'item', item: 'Iron Plates', perMinute: 60 }] },
      bad: 'Iron Plates',
      suggestion: 'Iron Plate',
      listTool: 'list_items',
    },
    {
      field: 'expectedOutputs schematic',
      patch: {
        expectedOutputs: [
          { kind: 'item', item: 'Iron Plate', perMinute: 60 },
          { kind: 'unlock', schematic: 'Plate Prod' },
        ],
      },
      bad: 'Plate Prod',
      suggestion: 'Plate Production',
      listTool: 'list_schematics',
    },
    {
      field: 'resourceName',
      patch: { resourceNodes: [{ resourceName: 'Iron Ore Node' }] },
      bad: 'Iron Ore Node',
      suggestion: 'Iron Ore',
      listTool: 'list_items',
    },
  ];

  for (const c of cases) {
    it(`rejects (and does not persist) a bad ${c.field}, suggesting via ${c.listTool}`, async () => {
      const playthrough = await seedPlaythrough();
      const outcome = await handleWorkOrderTool(
        playthrough,
        CREATE_WORK_ORDER,
        { ...validFullCreateInput, ...c.patch },
        deps,
      );
      expect(outcome.isError).toBe(true);
      expect(outcome.workOrder).toBeUndefined();
      expect(outcome.text).toContain(`"${c.bad}"`);
      expect(outcome.text).toContain(c.suggestion);
      expect(outcome.text).toContain(c.listTool);
      expect(await deps.workOrders.list(playthrough)).toHaveLength(0);
    });
  }

  it('rejects a revise whose patch names an unresolvable block recipe, leaving the order untouched', async () => {
    const playthrough = await seedPlaythrough();
    await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, validFullCreateInput, deps);
    const outcome = await handleWorkOrderTool(
      playthrough,
      REVISE_WORK_ORDER,
      { buildSteps: badRecipeSteps },
      deps,
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('list_recipes');
    // No new revision was written.
    const orders = await deps.workOrders.list(playthrough);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.currentRevision).toBe(1);
  });

  it('rejects a create_child whose plan names an unresolvable block recipe, leaving only the parent', async () => {
    const playthrough = await seedPlaythrough();
    const parent = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validFullCreateInput,
      deps,
    );
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_CHILD_WORK_ORDER,
      {
        ...validFullCreateInput,
        title: 'Child order',
        parentWorkOrderId: parent.workOrder!.id,
        relationshipToParent: 'prerequisite',
        buildSteps: badRecipeSteps,
      },
      deps,
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('Iron Plate'); // suggestion
    expect(await deps.workOrders.list(playthrough)).toHaveLength(1); // only the parent
  });
});

describe('power output verification (#223)', () => {
  const powerPlant = (
    megawatts: number,
    buildables: { name: string; requiredCount: number }[],
  ): Record<string, unknown> => ({
    title: 'Coal Stack',
    goal: 'Supply power.',
    buildSteps: [{ title: 'Generators', buildables }],
    expectedOutputs: [{ kind: 'power', megawatts }],
  });

  it('rejects an under-provisioned plant (12 generators claim 1200 MW) without persisting', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      powerPlant(1200, [{ name: 'Coal-Powered Generator', requiredCount: 12 }]),
      deps,
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.workOrder).toBeUndefined();
    expect(outcome.text).toContain('1200');
    expect(outcome.text).toContain('900'); // 12 × 75
    expect(outcome.text).toContain('16'); // ceil(1200 / 75)
    expect(outcome.text).toContain('Coal-Powered Generator');
    expect(await deps.workOrders.list(playthrough)).toHaveLength(0);
  });

  it('accepts a plant that meets its target (16 × 75 = 1200 MW)', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      powerPlant(1200, [{ name: 'Coal-Powered Generator', requiredCount: 16 }]),
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(await deps.workOrders.list(playthrough)).toHaveLength(1);
  });

  it('accepts over-provisioning (1200 MW built for a 1000 MW target)', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      powerPlant(1000, [{ name: 'Coal-Powered Generator', requiredCount: 16 }]),
      deps,
    );
    expect(outcome.isError).toBe(false);
  });

  it('skips when there is no power output to check', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      {
        title: 'Generators only',
        goal: 'Place generators.',
        buildSteps: [
          { title: 'Gens', buildables: [{ name: 'Coal-Powered Generator', requiredCount: 4 }] },
        ],
      },
      deps,
    );
    expect(outcome.isError).toBe(false);
  });

  it('skips when the only generators are variable-output (Geothermal)', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      powerPlant(1000, [{ name: 'Geothermal Generator', requiredCount: 3 }]),
      deps,
    );
    // Geothermal has no fixed powerProduction → can't verify from a count → not rejected.
    expect(outcome.isError).toBe(false);
  });

  it('rejects an under-provisioned mixed-generator plant, naming both types', async () => {
    const playthrough = await seedPlaythrough();
    // 2 × 75 + 4 × 250 = 1150 MW < 1200 MW target.
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      powerPlant(1200, [
        { name: 'Coal-Powered Generator', requiredCount: 2 },
        { name: 'Fuel-Powered Generator', requiredCount: 4 },
      ]),
      deps,
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('Coal-Powered Generator');
    expect(outcome.text).toContain('Fuel-Powered Generator');
    expect(outcome.text).toContain('1150');
    expect(await deps.workOrders.list(playthrough)).toHaveLength(0);
  });

  it('allows a target-only revise the existing generators still cover', async () => {
    const playthrough = await seedPlaythrough();
    await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      powerPlant(1200, [{ name: 'Coal-Powered Generator', requiredCount: 16 }]), // 16 × 75 = 1200
      deps,
    );
    // Lowering the target below existing capacity is fine.
    const outcome = await handleWorkOrderTool(
      playthrough,
      REVISE_WORK_ORDER,
      { expectedOutputs: [{ kind: 'power', megawatts: 900 }], changeSummary: 'Trim target.' },
      deps,
    );
    expect(outcome.isError).toBe(false);
  });

  it('rejects a target-only revise that outstrips the existing generators (merged check)', async () => {
    // The live bug: "revise to 2400 MW" left 16 generators (= 1200 MW) untouched and shipped.
    const playthrough = await seedPlaythrough();
    await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      powerPlant(1200, [{ name: 'Coal-Powered Generator', requiredCount: 16 }]),
      deps,
    );
    const outcome = await handleWorkOrderTool(
      playthrough,
      REVISE_WORK_ORDER,
      { expectedOutputs: [{ kind: 'power', megawatts: 2400 }], changeSummary: 'Double it.' },
      deps,
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('2400'); // the new claim
    expect(outcome.text).toContain('1200'); // what the existing 16 generators produce
    expect(outcome.text).toContain('32'); // ceil(2400 / 75)
    // Rejected before persist — still on the original revision.
    const orders = await deps.workOrders.list(playthrough);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.currentRevision).toBe(1);
  });
});

describe('recipe derivation (#228)', () => {
  const block = (
    name: string,
    requiredCount: number,
    recipeName: string,
  ): Record<string, unknown> => ({ name, requiredCount, recipeName });

  it('derives recipes[] rates (count × per-machine) from an annotated production block', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validFullCreateInput,
      deps,
    );
    expect(outcome.isError).toBe(false);
    // 3 Constructors × (30 Iron Ingot → 20 Iron Plate) per machine.
    expect(outcome.workOrder?.recipes).toEqual([
      {
        machineName: 'Constructor',
        recipeName: 'Iron Plate',
        inputItems: [{ itemName: 'Iron Ingot', perMinute: 90 }],
        outputItems: [{ itemName: 'Iron Plate', perMinute: 60 }],
      },
    ]);
  });

  it('aggregates two blocks of the same recipe into one derived entry', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      {
        title: 'Plates',
        goal: 'Plates.',
        buildSteps: [
          { title: 'A', buildables: [block('Constructor', 3, 'Iron Plate')] },
          { title: 'B', buildables: [block('Constructor', 2, 'Iron Plate')] },
        ],
      },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.recipes).toHaveLength(1);
    expect(outcome.workOrder?.recipes[0]?.outputItems).toEqual([
      { itemName: 'Iron Plate', perMinute: 100 }, // (3 + 2) × 20
    ]);
  });

  it('derives all products of a byproduct recipe', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      {
        title: 'Fuel',
        goal: 'Burn oil.',
        buildSteps: [{ title: 'Refineries', buildables: [block('Refinery', 2, 'Fuel')] }],
      },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.recipes[0]?.outputItems).toEqual([
      { itemName: 'Fuel', perMinute: 80 }, // 2 × 40
      { itemName: 'Polymer Resin', perMinute: 60 }, // 2 × 30
    ]);
  });

  it('rejects a block whose building cannot run its recipe', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      {
        title: 'Wrong machine',
        goal: 'Oops.',
        buildSteps: [{ title: 'A', buildables: [block('Assembler', 3, 'Iron Plate')] }],
      },
      deps,
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.workOrder).toBeUndefined();
    expect(outcome.text).toContain('Constructor'); // the recipe's actual machine
    expect(outcome.text).toContain('Assembler'); // the wrongly-chosen building
    expect(await deps.workOrders.list(playthrough)).toHaveLength(0);
  });

  it('persists with a non-blocking advisory when derived output falls short of the target', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      {
        title: 'Under-built',
        goal: 'Plates.',
        buildSteps: [{ title: 'A', buildables: [block('Constructor', 2, 'Iron Plate')] }],
        expectedOutputs: [{ kind: 'item', item: 'Iron Plate', perMinute: 60 }],
      },
      deps,
    );
    // Persists (advisory is non-blocking) but the foreman is told to self-correct.
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder).toBeDefined();
    expect(outcome.text).toContain('40'); // 2 × 20 produced
    expect(outcome.text).toContain('60'); // target
    expect(outcome.text).toContain('Constructor'); // "about 1 more Constructor"
    expect(await deps.workOrders.list(playthrough)).toHaveLength(1);
  });

  it('adds no advisory when the plan meets its target', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validFullCreateInput, // 3 × 20 = 60 = target
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.text).not.toContain('under-delivers');
  });

  it('advises (non-blocking) on a target-only revise that outstrips current production, via the merged plan', async () => {
    const playthrough = await seedPlaythrough();
    // validFullCreateInput: 3 Constructors → 60 Iron Plate/min.
    await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, validFullCreateInput, deps);
    const outcome = await handleWorkOrderTool(
      playthrough,
      REVISE_WORK_ORDER,
      {
        expectedOutputs: [{ kind: 'item', item: 'Iron Plate', perMinute: 200 }],
        changeSummary: 'Bump target.',
      },
      deps,
    );
    // Non-blocking (manufacturing counts are advisory), but the merged check catches that
    // the existing 60/min doesn't meet the new 200/min target and tells the foreman.
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('under-delivers');
    expect(outcome.text).toContain('60'); // current production
    expect(outcome.text).toContain('200'); // new target
    const orders = await deps.workOrders.list(playthrough);
    expect(orders[0]?.currentRevision).toBe(2);
  });

  it('does not advise when a partial revise touches neither production nor its target', async () => {
    const playthrough = await seedPlaythrough();
    await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, validFullCreateInput, deps);
    // Change only the goal text — no buildSteps, no expectedOutputs → nothing to check.
    const outcome = await handleWorkOrderTool(
      playthrough,
      REVISE_WORK_ORDER,
      { goal: 'Make iron plates, faster.', changeSummary: 'Reword.' },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.text).not.toContain('under-delivers');
  });
});

describe('revise buildSteps drop safeguard (#16)', () => {
  const twoStepPlan = {
    title: 'Two lines',
    goal: 'Plates and screws.',
    buildSteps: [
      {
        title: 'Plates',
        buildables: [{ name: 'Constructor', requiredCount: 3, recipeName: 'Iron Plate' }],
      },
      {
        title: 'Screws',
        buildables: [{ name: 'Constructor', requiredCount: 2, recipeName: 'Screw' }],
      },
    ],
  };

  it('warns (non-blocking) when a revise shrinks the build plan', async () => {
    const playthrough = await seedPlaythrough();
    await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, twoStepPlan, deps);
    // Revise sends only ONE of the two steps — the classic accidental-delta.
    const outcome = await handleWorkOrderTool(
      playthrough,
      REVISE_WORK_ORDER,
      {
        buildSteps: [
          {
            title: 'Plates',
            buildables: [{ name: 'Constructor', requiredCount: 3, recipeName: 'Iron Plate' }],
          },
        ],
        changeSummary: 'Tweak plates.',
      },
      deps,
    );
    expect(outcome.isError).toBe(false); // non-blocking
    expect(outcome.text).toContain('fewer parts');
    expect(outcome.text).toContain('resend');
    // The revise still applied (replace semantics) — this is a warning, not a block.
    const orders = await deps.workOrders.list(playthrough);
    expect(orders[0]?.currentRevision).toBe(2);
  });

  it('does not warn when a revise keeps or grows the plan', async () => {
    const playthrough = await seedPlaythrough();
    await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, twoStepPlan, deps);
    // Resend both steps plus a third.
    const outcome = await handleWorkOrderTool(
      playthrough,
      REVISE_WORK_ORDER,
      {
        buildSteps: [
          ...twoStepPlan.buildSteps,
          {
            title: 'More plates',
            buildables: [{ name: 'Constructor', requiredCount: 1, recipeName: 'Iron Plate' }],
          },
        ],
        changeSummary: 'Add a line.',
      },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.text).not.toContain('fewer parts');
  });
});

describe('explore orders (#207)', () => {
  const explorePlan = {
    title: 'Sweep the ridge',
    goal: 'Grab the nearby loot.',
    waypoints: [
      {
        label: 'Ridge',
        collectibles: [{ id: 'C-SLOOP', reason: 'overclock the iron line' }, { id: 'C-POD' }],
      },
    ],
  };

  it('creates an explore order with server-derived collectible facts (incl. pod unlock cost)', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(playthrough, CREATE_EXPLORE_ORDER, explorePlan, deps);
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.orderType).toBe('explore');
    expect(outcome.text).toContain('EO-001'); // explore label, not WO-
    const waypoints = outcome.workOrder?.waypoints;
    expect(waypoints).toHaveLength(1);
    const collectibles = waypoints![0]!.collectibles;
    // Facts are DERIVED from the world data, not transcribed by the model.
    const pod = collectibles.find((c) => c.kind === 'hardDrive');
    expect(pod?.guid).toBe('G-POD');
    expect(pod?.unlockCost?.powerMW).toBe(250); // a pod always lists its true open cost
    const sloop = collectibles.find((c) => c.kind === 'somersloop');
    expect(sloop?.reason).toBe('overclock the iron line');
    expect(collectibles.every((c) => c.collected === false)).toBe(true);
  });

  it('rejects an explore order referencing an unknown collectible id', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_EXPLORE_ORDER,
      { ...explorePlan, waypoints: [{ collectibles: [{ id: 'C-SLOOP' }, { id: 'ghost-id' }] }] },
      deps,
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('ghost-id');
    expect(await deps.workOrders.list(playthrough)).toHaveLength(0);
  });

  it('marks a waypoint collectible collected (execution)', async () => {
    const playthrough = await seedPlaythrough();
    const created = await handleWorkOrderTool(playthrough, CREATE_EXPLORE_ORDER, explorePlan, deps);
    const waypointId = created.workOrder!.waypoints![0]!.id;
    const outcome = await deps.workOrders.markCollectibleCollected(
      playthrough,
      created.workOrder!.id,
      waypointId,
      'C-SLOOP',
      true,
    );
    expect(outcome.ok).toBe(true);
    const collected = outcome.order?.waypoints
      ?.flatMap((w) => w.collectibles)
      .find((c) => c.id === 'C-SLOOP')?.collected;
    expect(collected).toBe(true);
  });

  it('reconciles collectibles by identity on re-upload, monotonically (#209-B)', async () => {
    const playthrough = await seedPlaythrough();
    const created = await handleWorkOrderTool(playthrough, CREATE_EXPLORE_ORDER, explorePlan, deps);
    // The re-uploaded save shows the somersloop (G-SLOOP) collected; the pod (G-POD) not.
    const summary = await deps.workOrders.reconcileCollectibles(
      playthrough,
      new Set(['G-SLOOP']),
      new Set(),
    );
    expect(summary.synced).toBe(1);
    expect(summary.orders[0]?.label).toContain('EO-');
    const reloaded = await deps.workOrders.get(playthrough, created.workOrder!.id);
    const items = reloaded!.waypoints!.flatMap((w) => w.collectibles);
    expect(items.find((c) => c.guid === 'G-SLOOP')?.collected).toBe(true);
    expect(items.find((c) => c.guid === 'G-POD')?.collected).toBe(false);
    // Monotonic: a later save that no longer reports it collected does NOT un-collect.
    const again = await deps.workOrders.reconcileCollectibles(playthrough, new Set(), new Set());
    expect(again.synced).toBe(0);
    const reloaded2 = await deps.workOrders.get(playthrough, created.workOrder!.id);
    expect(
      reloaded2!.waypoints!.flatMap((w) => w.collectibles).find((c) => c.guid === 'G-SLOOP')
        ?.collected,
    ).toBe(true);
  });
});

describe('resolvePlanReferences', () => {
  it('attaches per-unit cost + class for resolved buildables', async () => {
    const plan = {
      buildSteps: [
        { title: 'a', buildables: [{ name: 'Smelter', requiredCount: 2 }] },
        { title: 'b', buildables: [{ name: 'Conveyor Splitter', requiredCount: 4 }] },
      ],
    };
    const result = await resolvePlanReferences(plan, stubMcp());
    expect(result.ok).toBe(true);
    expect(plan.buildSteps[0]!.buildables[0]).toMatchObject({
      buildingClass: 'Build_SmelterMk1_C',
      buildCost: [{ itemName: 'Iron Rod', itemClass: 'Desc_IronRod_C', amount: 5 }],
    });
    expect(plan.buildSteps[1]!.buildables[0]!.buildingClass).toBe(
      'Build_ConveyorAttachmentSplitter_C',
    );
  });

  it('is ok when there are no buildables to resolve', async () => {
    const result = await resolvePlanReferences({}, stubMcp());
    expect(result.ok).toBe(true);
  });

  it('rejects an unresolved buildable and suggests the canonical name', async () => {
    const plan = {
      buildSteps: [{ title: 'a', buildables: [{ name: 'Splitter', requiredCount: 15 }] }],
    };
    const result = await resolvePlanReferences(plan, stubMcp());
    expect(result.ok).toBe(false);
    if (result.ok) {
      return; // narrow for the type-checker
    }
    expect(result.unresolved).toEqual(['Splitter']);
    // The rejection surfaces the two splitter variants, not the bare guess.
    expect(result.message).toContain('"Splitter"');
    expect(result.message).toContain('Conveyor Splitter');
    expect(result.message).toContain('Smart Splitter');
    expect(result.message).toContain('list_buildings');
  });

  it('reports no close match when nothing overlaps', async () => {
    const plan = {
      buildSteps: [{ title: 'a', buildables: [{ name: 'Nonexistent Machine', requiredCount: 1 }] }],
    };
    const result = await resolvePlanReferences(plan, stubMcp());
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain('Nonexistent Machine');
    expect(result.message).toContain('no close match');
  });
});
