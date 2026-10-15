import { beforeAll, describe, expect, it } from 'vitest';

import { loadGameData } from '@foreman/sf-game-data';
import { GraphDB, initGraph } from '../src/graph/index.js';
import type { GeneratorFuel } from '@foreman/sf-game-data';

/**
 * Power correctness is critical, so these assert against the bundled stable data
 * (real game numbers), not a fixture. Every figure is a known-good in-game value —
 * a future data update that breaks the maths will fail here. The data comes from
 * the merged sf-game-data.json (gameData), loaded via loadGameData (#161/#162).
 */
let graph: GraphDB;

beforeAll(async () => {
  const { gameData } = loadGameData();
  graph = await initGraph(gameData);
});

const fuelFor = (
  fuels: GeneratorFuel[] | undefined,
  itemClass: string,
): GeneratorFuel | undefined => fuels?.find((f) => f.fuel.itemClassName === itemClass);

describe('get_building — power generators', () => {
  it('Coal-Powered Generator: 75 MW, 15 coal/min, 45 m³ water/min', () => {
    const coal = graph.getBuilding('Coal-Powered Generator');
    expect(coal?.powerProduction).toBe(75);
    const onCoal = fuelFor(coal?.fuels, 'Desc_Coal_C');
    expect(onCoal?.fuel.perMinute).toBe(15);
    expect(onCoal?.fuel.unit).toBe('items');
    expect(onCoal?.supplemental?.itemClassName).toBe('Desc_Water_C');
    expect(onCoal?.supplemental?.perMinute).toBe(45);
    expect(onCoal?.supplemental?.unit).toBe('m³');
    // Compacted Coal (630 MJ) burns slower.
    expect(fuelFor(coal?.fuels, 'Desc_CompactedCoal_C')?.fuel.perMinute).toBeCloseTo(7.1429, 3);
    expect(coal?.buildCost.length ?? 0).toBeGreaterThan(0);
  });

  it('Fuel-Powered Generator: 250 MW, 20 m³ fuel/min (7.5 turbofuel)', () => {
    const gen = graph.getBuilding('Fuel-Powered Generator');
    expect(gen?.powerProduction).toBe(250);
    const fuel = fuelFor(gen?.fuels, 'Desc_LiquidFuel_C');
    expect(fuel?.fuel.perMinute).toBe(20);
    expect(fuel?.fuel.unit).toBe('m³');
    expect(fuelFor(gen?.fuels, 'Desc_LiquidTurboFuel_C')?.fuel.perMinute).toBe(7.5);
  });

  it('Nuclear Power Plant: 2500 MW, 0.2 rod/min, 240 m³ water/min, 10 waste/min', () => {
    const nuke = graph.getBuilding('Nuclear Power Plant');
    expect(nuke?.powerProduction).toBe(2500);
    const rod = fuelFor(nuke?.fuels, 'Desc_NuclearFuelRod_C');
    expect(rod?.fuel.perMinute).toBe(0.2);
    expect(rod?.supplemental?.perMinute).toBe(240);
    expect(rod?.byproduct?.itemClassName).toBe('Desc_NuclearWaste_C');
    expect(rod?.byproduct?.perMinute).toBe(10);
  });

  it('Geothermal Generator: variable, geyser-dependent', () => {
    const geo = graph.getBuilding('Geothermal Generator');
    expect(geo?.variablePowerProduction).toBe(true);
    expect(geo?.powerProduction).toBeUndefined();
  });
});

describe('get_building — machine power draw', () => {
  it('reports constant draw for production machines', () => {
    expect(graph.getBuilding('Constructor')?.powerConsumption).toBe(4);
    expect(graph.getBuilding('Smelter')?.powerConsumption).toBe(4);
    expect(graph.getBuilding('Manufacturer')?.powerConsumption).toBe(55);
    expect(graph.getBuilding('Water Extractor')?.powerConsumption).toBe(20);
  });

  it('reports max draw for variable-power machines', () => {
    const pa = graph.getBuilding('Particle Accelerator');
    expect(pa?.powerConsumption).toBe(0);
    expect(pa?.maxPowerConsumption).toBe(1500);
    expect(graph.getBuilding('Quantum Encoder')?.maxPowerConsumption).toBe(2000);
  });

  it('returns undefined for an unknown building', () => {
    expect(graph.getBuilding('Dyson Sphere')).toBeUndefined();
  });
});

describe('list_buildings', () => {
  it('lists real named buildables and excludes dataless Desc_* descriptors', () => {
    const buildings = graph.listBuildings();
    expect(buildings.length).toBeGreaterThan(0);
    // Every entry has a non-empty display name...
    expect(buildings.every((b) => b.displayName !== '')).toBe(true);
    // ...and the dataless descriptor twins are excluded.
    expect(buildings.some((b) => b.className.startsWith('Desc_'))).toBe(false);
    // Sorted by display name.
    const names = buildings.map((b) => b.displayName);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('surfaces the canonical names the foreman kept guessing wrong (#220)', () => {
    const byName = (search: string): string[] =>
      graph.listBuildings({ search }).map((b) => b.displayName);
    // "Splitter" → the three splitter variants, none of them bare "Splitter".
    expect(byName('splitter')).toEqual(
      expect.arrayContaining(['Conveyor Splitter', 'Smart Splitter', 'Programmable Splitter']),
    );
    // "Pipeline Pump" → mark-suffixed, not the bare name.
    expect(byName('pipeline pump')).toEqual(
      expect.arrayContaining(['Pipeline Pump Mk.1', 'Pipeline Pump Mk.2']),
    );
    // The junctions the foreman named "…Cross" / "…T-Intersection".
    expect(byName('junction')).toEqual(
      expect.arrayContaining(['Pipeline Junction', 'Pipeline T-Junction']),
    );
  });

  it('search matches class name and is case-insensitive', () => {
    const hits = graph.listBuildings({ search: 'CONVEYORATTACHMENTSPLITTER' });
    expect(hits.map((b) => b.className)).toContain('Build_ConveyorAttachmentSplitter_C');
  });

  it('filters by exact (case-insensitive) category', () => {
    const belts = graph.listBuildings({ category: 'conveyorbelt' });
    expect(belts.length).toBeGreaterThan(0);
    expect(belts.every((b) => b.category.toLowerCase() === 'conveyorbelt')).toBe(true);
    expect(belts.map((b) => b.displayName)).toContain('Conveyor Belt Mk.1');
  });

  it('returns an empty list for a search that matches nothing', () => {
    expect(graph.listBuildings({ search: 'dyson sphere' })).toEqual([]);
  });
});

describe('list_power_generators', () => {
  it('lists every generator with output and fuels', () => {
    const generators = graph.listPowerGenerators();
    const names = generators.map((g) => g.displayName);
    expect(names).toContain('Coal-Powered Generator');
    expect(names).toContain('Fuel-Powered Generator');
    expect(names).toContain('Nuclear Power Plant');
    expect(names).toContain('Geothermal Generator');

    const nuke = generators.find((g) => g.displayName === 'Nuclear Power Plant');
    expect(nuke?.powerProduction).toBe(2500);
    expect(nuke?.fuels.length ?? 0).toBeGreaterThan(0);
  });
});
