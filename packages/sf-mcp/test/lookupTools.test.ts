import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import type { GameData, WorldLocations } from '@foreman/sf-game-data';
import { WorldQueries } from '@foreman/sf-game-data';
import { initGraph } from '@foreman/sf-game-data-graph';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerGameDataTools } from '../src/tools/gameData.js';

// Batched lookups (#37): one call resolves several names, reports misses, and keeps the
// single-name shape that ff-server's work-order ingest relies on.
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

const gameData: GameData = JSON.parse(
  fs.readFileSync(
    fileURLToPath(
      new URL('../../sf-game-data-graph/test/fixtures/game-data.json', import.meta.url),
    ),
    'utf8',
  ),
);

const world: WorldLocations = {
  gameVersion: 'test',
  build: 0,
  source: 'test',
  counts: {},
  collectibles: [],
  resourceNodes: [
    { id: 'N1', kind: 'node', resourceClass: 'Desc_OreIron_C', purity: 'pure', x: 100, y: 0, z: 0 },
    {
      id: 'N2',
      kind: 'node',
      resourceClass: 'Desc_OreIron_C',
      purity: 'normal',
      x: 200,
      y: 0,
      z: 0,
    },
    {
      id: 'N3',
      kind: 'node',
      resourceClass: 'Desc_OreIron_C',
      purity: 'impure',
      x: 300,
      y: 0,
      z: 0,
    },
    {
      id: 'N4',
      kind: 'node',
      resourceClass: 'Desc_LiquidOil_C',
      purity: 'pure',
      x: 400,
      y: 0,
      z: 0,
    },
    {
      id: 'N5',
      kind: 'node',
      resourceClass: 'Desc_LiquidOil_C',
      purity: 'normal',
      x: 500,
      y: 0,
      z: 0,
    },
  ],
  lootPickups: [],
  biomes: [],
};

const handlers = new Map<string, Handler>();

beforeAll(async () => {
  const graph = await initGraph(gameData);
  const stubServer = {
    registerTool(name: string, _schema: unknown, handler: Handler): void {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  registerGameDataTools(stubServer, graph, new WorldQueries(world, gameData));
});

async function call(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  const handler = handlers.get(tool);
  if (handler === undefined) {
    throw new Error(`${tool} is not registered`);
  }
  return handler(args);
}

function body(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

/** Each lookup tool: its list argument, plural key, and two names that resolve. */
const cases = [
  { tool: 'get_item', arg: 'names', key: 'items', found: ['Iron Plate', 'Screw'] },
  { tool: 'get_recipe', arg: 'names', key: 'recipes', found: ['Iron Plate', 'Iron Rod'] },
  { tool: 'get_building', arg: 'names', key: 'buildings', found: ['Smelter', 'Constructor'] },
  { tool: 'get_schematic', arg: 'names', key: 'schematics', found: ['Plate Production'] },
  { tool: 'recipes_for', arg: 'items', key: 'results', found: ['Iron Plate', 'Iron Rod'] },
];

describe('batched lookup tools (#37)', () => {
  for (const testCase of cases) {
    it(`${testCase.tool}: resolves a mixed list in order, de-duplicated, reporting misses`, async () => {
      const [first, ...rest] = testCase.found;
      const names = [first, 'Nope', first, ...rest];
      const result = await call(testCase.tool, { [testCase.arg]: names });
      expect(result.isError).toBeFalsy();
      const payload = body(result);
      expect(payload['version']).toBe('test-1.0');
      expect(payload['notFound']).toEqual(['Nope']);
      expect(payload[testCase.key]).toHaveLength(testCase.found.length);
    });

    it(`${testCase.tool}: errors when nothing resolves`, async () => {
      const result = await call(testCase.tool, { [testCase.arg]: ['Nope', 'Also Nope'] });
      expect(result.isError).toBe(true);
      expect(body(result)['notFound']).toEqual(['Nope', 'Also Nope']);
    });

    it(`${testCase.tool}: rejects both or neither argument`, async () => {
      const single = testCase.arg.slice(0, -1);
      const both = await call(testCase.tool, { [single]: 'x', [testCase.arg]: ['y'] });
      expect(both.isError).toBe(true);
      expect(body(both)['error']).toBe(`Pass either '${single}' or '${testCase.arg}'.`);
      const neither = await call(testCase.tool, {});
      expect(neither.isError).toBe(true);
    });

    it.runIf(testCase.found.length >= 2)(
      `${testCase.tool}: a batch is no larger than the single calls it replaces`,
      async () => {
        const single = testCase.arg.slice(0, -1);
        const singles = await Promise.all(
          testCase.found.map((name) => call(testCase.tool, { [single]: name })),
        );
        const singleChars = singles.reduce(
          (sum, result) => sum + result.content[0]!.text.length,
          0,
        );
        const batch = await call(testCase.tool, { [testCase.arg]: testCase.found });
        expect(batch.content[0]!.text.length).toBeLessThanOrEqual(singleChars);
        expect(body(batch)).not.toHaveProperty('notFound');
      },
    );
  }

  it('get_recipe: the single-name response is unchanged', async () => {
    const payload = body(await call('get_recipe', { name: 'Iron Plate' }));
    expect(Object.keys(payload).sort()).toEqual(['recipe', 'version']);
    const miss = await call('get_recipe', { name: 'Nope' });
    expect(miss.isError).toBe(true);
    expect(body(miss)).toEqual({ version: 'test-1.0', error: "Not found: recipe 'Nope'" });
  });

  it('recipes_for: the single-item response is unchanged', async () => {
    const payload = body(await call('recipes_for', { item: 'Iron Plate' }));
    expect(payload).toHaveProperty('recipes');
    expect(payload).toHaveProperty('item', 'Iron Plate');
  });
});

describe('nearest_resource_nodes with several resources (#37)', () => {
  it('returns up to n nodes per resource and reports resources with no nodes', async () => {
    const result = await call('nearest_resource_nodes', {
      coord: { x: 0, y: 0, z: 0 },
      resources: ['Iron Ore', 'Crude Oil', 'Uranium'],
      n: 2,
    });
    expect(result.isError).toBeFalsy();
    const payload = body(result) as {
      byResource: Record<string, { id: string }[]>;
      notFound: string[];
    };
    expect(payload.byResource['Iron Ore']?.map((node) => node.id)).toEqual(['N1', 'N2']);
    expect(payload.byResource['Crude Oil']?.map((node) => node.id)).toEqual(['N4', 'N5']);
    expect(payload.notFound).toEqual(['Uranium']);
  });

  it('rejects resource and resources together', async () => {
    const result = await call('nearest_resource_nodes', {
      coord: { x: 0, y: 0, z: 0 },
      resource: 'Iron Ore',
      resources: ['Crude Oil'],
    });
    expect(result.isError).toBe(true);
  });
});
