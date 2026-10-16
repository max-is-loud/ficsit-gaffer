import { describe, expect, it } from 'vitest';

import { renderSaveSummary } from '../src/context/renderSaveSummary.js';
import type { SaveSummary } from '../src/context/saveSummarySchema.js';

const UPLOADED = new Date('2026-10-16T04:59:12.000Z');

const production: SaveSummary = {
  save: {
    saveName: 'Codex',
    version: 'build 513885 (save 60)',
    savedAt: '2026-10-16T04:58:40.112Z',
    playDurationSeconds: 64121,
  },
  player: {
    position: { x: -363, y: 2516, z: -14 },
    biome: 'GRASS FIELDS',
    within: 'SW',
    hub: { x: -397, y: 2437, z: -25 },
  },
  progress: {
    highestTier: 3,
    tierMilestones: ['3-1', '3-2'],
    spaceElevatorPhase: 1,
    mamTrees: ['Caterium', 'Power Slugs'],
  },
  recipes: {
    standardCount: 171,
    alternateCount: 1,
    alternates: ['Alternate: Cheap Silica'],
    alternatesOmitted: 0,
  },
  power: {
    capacityMw: 660,
    consumptionMw: 146,
    headroomMw: 514,
    circuits: 1,
    overloadedCircuits: 0,
    generators: [{ type: 'Biomass Burner', count: 22, mw: 660 }],
  },
  production: [
    { item: 'Screws', perMinute: 240, machines: 6 },
    { item: 'Water', perMinute: 120, machines: 1, unit: 'm³' },
  ],
  storage: [{ item: 'Screws', quantity: 12364 }],
  nearbyResources: [
    {
      resource: 'Iron Ore',
      purity: 'impure',
      distanceMetres: 60,
      bearing: 'N',
      biome: 'GRASS FIELDS',
    },
  ],
};

describe('renderSaveSummary', () => {
  it('renders the production example', () => {
    expect(renderSaveSummary(production, UPLOADED)).toBe(
      [
        '## Save snapshot — saved in-game 2026-10-16 04:58 UTC, uploaded 2026-10-16 04:59 UTC (not live)',
        '',
        'Save "Codex", build 513885 (save 60), play time 17h 48m. Figures are as of that save.',
        '- Position: (-363, 2516, -14) m, in the SW of GRASS FIELDS. HUB: (-397, 2437, -25) m.',
        '- Progress: tier 3 (milestones 3-1, 3-2); Space Elevator phase 1; MAM trees: Caterium, Power Slugs.',
        '- Recipes: 171 standard, 1 alternate: Alternate: Cheap Silica.',
        '- Power: 660 MW capacity, 146 MW draw, 514 MW headroom; 1 circuit, 0 overloaded. Generators: 22 × Biomass Burner (660 MW).',
        '- Production, configured per minute (machines): Screws 240 (6), Water 120 m³ (1).',
        '- Storage, containers and depot: Screws 12364.',
        '- Nearest resource node of each type (existing miners not checked): Iron Ore impure 60 m N (GRASS FIELDS).',
        '',
        'For anything not listed here, or more detail, use the save tools.',
      ].join('\n'),
    );
  });

  it('is byte-identical for the same input', () => {
    const copy = JSON.parse(JSON.stringify(production)) as SaveSummary;
    expect(renderSaveSummary(copy, new Date(UPLOADED.getTime()))).toBe(
      renderSaveSummary(production, UPLOADED),
    );
  });

  it('gives only the upload time when the save time is unknown', () => {
    const { savedAt: _savedAt, ...save } = production.save;
    const text = renderSaveSummary({ ...production, save }, UPLOADED);
    expect(text.split('\n')[0]).toBe('## Save snapshot — uploaded 2026-10-16 04:59 UTC (not live)');
  });

  it('omits empty sections and never prints undefined or NaN', () => {
    const empty: SaveSummary = {
      save: { saveName: 'Fresh', version: 'unknown' },
      player: {},
      progress: { highestTier: 0, tierMilestones: [], mamTrees: [] },
      recipes: { standardCount: 0, alternateCount: 0, alternates: [], alternatesOmitted: 0 },
      power: {
        capacityMw: 0,
        consumptionMw: 0,
        headroomMw: 0,
        circuits: 0,
        overloadedCircuits: 0,
        generators: [],
      },
      production: [],
      storage: [],
      nearbyResources: [],
    };
    const text = renderSaveSummary(empty, UPLOADED);
    expect(text).not.toMatch(/undefined|NaN/);
    expect(text).not.toContain('Position');
    expect(text).not.toContain('Production');
    expect(text).not.toContain('Storage');
    expect(text).not.toContain('Power');
    expect(text).toContain('- Progress: no milestones purchased yet.');
    expect(text).toContain('Save "Fresh", version unknown.');
  });

  it('notes omitted alternates', () => {
    const text = renderSaveSummary(
      {
        ...production,
        recipes: { ...production.recipes, alternateCount: 31, alternatesOmitted: 30 },
      },
      UPLOADED,
    );
    expect(text).toContain('31 alternates: Alternate: Cheap Silica, +30 more.');
  });

  it('stays within the 4,800-character budget with every list at its cap', () => {
    // 32 characters: longer than real names ("Alternate: Turbo Electric Motor" is 31).
    const name = (prefix: string, i: number): string => `${prefix} ${i}`.padEnd(32, 'x');
    const full: SaveSummary = {
      save: { ...production.save, saveName: name('Save', 0) },
      player: production.player,
      progress: {
        highestTier: 9,
        tierMilestones: Array.from({ length: 8 }, (_, i) => name('Milestone', i)),
        spaceElevatorPhase: 5,
        mamTrees: Array.from({ length: 14 }, (_, i) => `MAM tree ${i}`.padEnd(20, 'x')),
      },
      recipes: {
        standardCount: 300,
        alternateCount: 110,
        alternates: Array.from({ length: 30 }, (_, i) => name('Alternate: Recipe', i)),
        alternatesOmitted: 80,
      },
      power: {
        ...production.power,
        capacityMw: 99999.9,
        generators: Array.from({ length: 6 }, (_, i) => ({
          type: name('Gen', i),
          count: 999,
          mw: 99999.9,
        })),
      },
      production: Array.from({ length: 15 }, (_, i) => ({
        item: name('Item', i),
        perMinute: 9999.9,
        machines: 999,
      })),
      storage: Array.from({ length: 15 }, (_, i) => ({ item: name('Item', i), quantity: 9999999 })),
      nearbyResources: Array.from({ length: 8 }, (_, i) => ({
        resource: `Resource ${i}`.padEnd(20, 'x'),
        purity: 'normal',
        distanceMetres: 99999,
        bearing: 'NE',
        biome: 'BIOME NAME'.padEnd(25, 'x'),
      })),
    };
    expect(renderSaveSummary(full, UPLOADED).length).toBeLessThanOrEqual(4800);
  });
});
