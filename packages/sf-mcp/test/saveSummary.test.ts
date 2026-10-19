import { describe, expect, it } from 'vitest';

import type { ResourceNodeHit } from '@foreman/sf-game-data';

import {
  nearestPerResource,
  SUMMARY_CAPS,
  summariseSave,
  type SaveViews,
} from '../src/query/saveSummary.js';

function views(overrides: Partial<SaveViews> = {}): SaveViews {
  return {
    meta: { saveName: 'Codex', version: 'build 1 (save 2)', savedAt: '2026-10-16T04:58:40.112Z' },
    player: { itemCount: 0, inventory: [], location: { x: 1.4, y: -2.6, z: 3.5 } },
    playerBiome: { biome: 'Grass Fields', within: 'NW' },
    progress: {
      milestonesByTier: [],
      tutorials: [],
      other: [],
      mamResearch: [],
      projectAssembly: [],
    },
    recipes: { total: 0, standardCount: 0, alternateCount: 0, standard: [], alternates: [] },
    power: {
      circuits: [],
      generators: [],
      generatorCount: 0,
      totalCapacityMW: 0,
      totalConsumptionMW: 0,
      note: '',
    },
    production: { producerCount: 0, extractorCount: 0, estimatedPowerMW: 0, items: [], note: '' },
    storage: { containerCount: 0, containers: [], dimensionalDepot: [] },
    nearbyResources: [],
    unlocks: { buildings: [], partRecipes: [] },
    ...overrides,
  };
}

const stack = (displayName: string, quantity: number) => ({
  itemClass: `Desc_${displayName}_C`,
  displayName,
  quantity,
});

describe('summariseSave', () => {
  it('summarises an empty save to empty lists without throwing', () => {
    const summary = summariseSave(
      views({ player: { itemCount: 0, inventory: [] }, playerBiome: undefined }),
    );
    expect(summary.player).toEqual({});
    expect(summary.production).toEqual([]);
    expect(summary.storage).toEqual([]);
    expect(summary.recipes).toEqual({
      standardCount: 0,
      alternateCount: 0,
      alternates: [],
      alternatesOmitted: 0,
    });
    expect(summary.progress.highestTier).toBe(0);
    expect(summary.save).toEqual({
      saveName: 'Codex',
      version: 'build 1 (save 2)',
      savedAt: '2026-10-16T04:58:40.112Z',
    });
  });

  it('rounds the player position to whole metres and adds the biome', () => {
    expect(summariseSave(views()).player).toEqual({
      position: { x: 1, y: -3, z: 4 },
      biome: 'Grass Fields',
      within: 'NW',
    });
  });

  it('sums storage over containers and the depot, keeping the top 15 by quantity', () => {
    const containers = Array.from({ length: 40 }, (_, i) => ({
      buildingClass: 'Build_StorageContainerMk1_C',
      displayName: 'Storage Container',
      inventory: [stack(`Item${String(i).padStart(2, '0')}`, i)],
    }));
    const summary = summariseSave(
      views({
        storage: {
          containerCount: 40,
          containers,
          dimensionalDepot: [stack('Item00', 500), stack('Item01', 100)],
        },
      }),
    );
    expect(summary.storage).toHaveLength(15);
    expect(summary.storage[0]).toEqual({ item: 'Item00', quantity: 500 });
    expect(summary.storage[1]).toEqual({ item: 'Item01', quantity: 101 });
    expect(summary.storage[2]).toEqual({ item: 'Item39', quantity: 39 });
  });

  it('keeps 30 alternate names and counts the rest', () => {
    const alternates = Array.from({ length: 50 }, (_, i) => ({
      recipeClass: `Recipe_Alt${i}_C`,
      displayName: `Alternate: ${String(i).padStart(2, '0')}`,
      isAlternate: true,
    }));
    const summary = summariseSave(
      views({
        recipes: { total: 60, standardCount: 10, alternateCount: 50, standard: [], alternates },
      }),
    );
    expect(summary.recipes.standardCount).toBe(10);
    expect(summary.recipes.alternateCount).toBe(50);
    expect(summary.recipes.alternates).toHaveLength(30);
    expect(summary.recipes.alternatesOmitted).toBe(20);
  });

  it('keeps the top 15 production items, sorted by rate then name', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      item: `Item${String(i).padStart(2, '0')}`,
      itemClass: `Desc_${i}_C`,
      unit: i === 0 ? ('m³' as const) : ('items' as const),
      effectivePerMinute: i === 1 ? 999 : i === 0 ? 5 : 10 + (i % 3),
      machineCount: 2,
      sources: [],
    }));
    const summary = summariseSave(
      views({
        production: { producerCount: 20, extractorCount: 0, estimatedPowerMW: 1, items, note: '' },
      }),
    );
    expect(summary.production).toHaveLength(15);
    expect(summary.production[0]).toEqual({ item: 'Item01', perMinute: 999, machines: 2 });
    expect(summary.production[1]).toEqual({ item: 'Item02', perMinute: 12, machines: 2 });
    expect(summary.production.find((entry) => entry.item === 'Item00')).toBeUndefined();
  });

  it('marks fluid rates with their unit', () => {
    const summary = summariseSave(
      views({
        production: {
          producerCount: 1,
          extractorCount: 1,
          estimatedPowerMW: 1,
          note: '',
          items: [
            {
              item: 'Water',
              itemClass: 'Desc_Water_C',
              unit: 'm³',
              effectivePerMinute: 120.04,
              machineCount: 1,
              sources: [],
            },
          ],
        },
      }),
    );
    expect(summary.production).toEqual([
      { item: 'Water', perMinute: 120, machines: 1, unit: 'm³' },
    ]);
  });

  it('totals power, counts overloaded circuits and keeps the six largest generator types', () => {
    const generators = Array.from({ length: 8 }, (_, i) => ({
      building: `Gen${i}`,
      buildingClass: `Build_Gen${i}_C`,
      count: 1,
      capacityMW: i * 10,
      variableOutput: false,
      fuels: [],
    }));
    const circuit = (status: 'ok' | 'overloaded') => ({
      circuitId: 1,
      generatorCount: 1,
      capacityMW: 1,
      hasVariableGenerators: false,
      consumerCount: 1,
      consumptionMW: 1,
      balanceMW: 0,
      status,
    });
    const summary = summariseSave(
      views({
        power: {
          circuits: [circuit('ok'), circuit('overloaded')],
          generators,
          generatorCount: 8,
          totalCapacityMW: 280.04,
          totalConsumptionMW: 190.06,
          note: '',
        },
      }),
    );
    expect(summary.power).toMatchObject({
      capacityMw: 280,
      consumptionMw: 190.1,
      headroomMw: 90,
      circuits: 2,
      overloadedCircuits: 1,
    });
    expect(summary.power.generators.map((generator) => generator.type)).toEqual([
      'Gen7',
      'Gen6',
      'Gen5',
      'Gen4',
      'Gen3',
      'Gen2',
    ]);
  });

  it('reports the highest tier with purchases, its milestones (max 8), phase and MAM trees', () => {
    const named = (tier: number, i: number) => ({
      schematicClass: `Schematic_${tier}_${i}_C`,
      displayName: `T${tier} Milestone ${i}`,
      tier,
      kind: 'milestone' as const,
    });
    const summary = summariseSave(
      views({
        progress: {
          milestonesByTier: [
            { tier: 1, milestones: [named(1, 1)] },
            { tier: 3, milestones: Array.from({ length: 10 }, (_, i) => named(3, i)) },
          ],
          tutorials: [],
          other: [],
          mamResearch: ['Caterium', 'Power Slugs'],
          projectAssembly: [],
          assemblyPhase: { phase: 2 },
        },
      }),
    );
    expect(summary.progress.highestTier).toBe(3);
    expect(summary.progress.tierMilestones).toHaveLength(8);
    expect(summary.progress.spaceElevatorPhase).toBe(2);
    expect(summary.progress.mamTrees).toEqual(['Caterium', 'Power Slugs']);
    expect(summary.progress.spaceElevatorCost).toBeUndefined();
  });

  it("states the current Space Elevator phase's cost and the tier it unlocks", () => {
    const phase = (number: number, current: boolean, amount: number) => ({
      phase: number,
      unlocksTier: number * 2 + 2,
      current,
      cost: [{ itemClass: 'Desc_SpaceElevatorPart_1_C', displayName: 'Smart Plating', amount }],
    });
    const summary = summariseSave(
      views({
        progress: {
          milestonesByTier: [],
          tutorials: [],
          other: [],
          mamResearch: [],
          projectAssembly: [phase(1, true, 50), phase(2, false, 1000)],
          assemblyPhase: { phase: 1 },
        },
      }),
    );
    expect(summary.progress.spaceElevatorCost).toEqual([{ item: 'Smart Plating', amount: 50 }]);
    expect(summary.progress.spaceElevatorUnlocksTier).toBe(4);
  });

  it('caps the unlocked buildings and part recipes and counts the rest', () => {
    const names = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => `${prefix} ${String(i).padStart(3, '0')}`);
    const unlocks = {
      buildings: names('Building', SUMMARY_CAPS.buildings + 5),
      partRecipes: names('Recipe', 3),
    };
    const summary = summariseSave(views({ unlocks }));
    expect(summary.unlocks.buildings).toHaveLength(SUMMARY_CAPS.buildings);
    expect(summary.unlocks.buildingsOmitted).toBe(5);
    expect(summary.unlocks.partRecipes).toEqual(names('Recipe', 3));
    expect(summary.unlocks.partRecipesOmitted).toBe(0);
  });
});

describe('nearestPerResource', () => {
  const hit = (id: string, resource: string | null, distance: number): ResourceNodeHit => ({
    id,
    kind: 'node',
    resource: resource === null ? null : { className: `Desc_${resource}_C`, displayName: resource },
    purity: 'normal',
    x: distance,
    y: 0,
    z: 0,
    distance,
  });

  it('keeps the nearest node of each resource, skipping geysers, up to the limit', () => {
    const hits = [
      hit('a', 'Iron Ore', 100),
      hit('b', 'Iron Ore', 200),
      hit('c', null, 250),
      hit('d', 'Copper Ore', 300),
      hit('e', 'Limestone', 400),
    ];
    expect(nearestPerResource(hits, 2).map((node) => node.id)).toEqual(['a', 'd']);
  });
});
