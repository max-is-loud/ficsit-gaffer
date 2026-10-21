import { describe, expect, it } from 'vitest';

import { WorldQueries, type GameData, type WorldLocations } from '@foreman/sf-game-data';
import { emptySaveState } from '@foreman/sf-save-data';
import { buildSaveGraph } from '@foreman/sf-save-data-graph';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadGameDataIndex } from '../src/gameData.js';
import { SaveStore } from '../src/store/saveStore.js';
import { SaveStoreRegistry } from '../src/store/registry.js';
import { registerSaveSummaryTool } from '../src/tools/saveSummary.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;
const NOW = '2026-01-01T00:00:00.000Z';

const locations: WorldLocations = {
  gameVersion: 'test',
  build: 0,
  source: 'test',
  counts: {},
  collectibles: [],
  resourceNodes: [
    {
      id: 'N1',
      kind: 'node',
      resourceClass: 'Desc_OreIron_C',
      purity: 'pure',
      x: 10000,
      y: 0,
      z: 0,
    },
    {
      id: 'N2',
      kind: 'node',
      resourceClass: 'Desc_OreIron_C',
      purity: 'impure',
      x: 20000,
      y: 0,
      z: 0,
    },
  ],
  lootPickups: [],
  biomes: [],
};
const gameData = {
  items: {},
  resources: { Desc_OreIron_C: { className: 'Desc_OreIron_C', displayName: 'Iron Ore' } },
} as unknown as GameData;

function summaryHandler(state: ReturnType<typeof emptySaveState>): Handler {
  const registry = new SaveStoreRegistry(SaveStore.fromState(state), undefined, 5, {
    statMtime: () => 1,
    load: () => ({ state, graph: buildSaveGraph({}) }),
    now: () => NOW,
  });
  const handlers = new Map<string, Handler>();
  const stubServer = {
    registerTool(name: string, _schema: unknown, handler: Handler): void {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  registerSaveSummaryTool(stubServer, registry, {
    locations,
    queries: new WorldQueries(locations, gameData),
    gameData: loadGameDataIndex(),
  });
  const handler = handlers.get('get_save_summary');
  if (handler === undefined) {
    throw new Error('get_save_summary is not registered');
  }
  return handler;
}

describe('get_save_summary', () => {
  it('summarises an empty save to empty lists', async () => {
    const result = await summaryHandler(emptySaveState('v', 'Fixture', NOW))({});
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0]!.text) as { saveName: string; summary: unknown };
    expect(body.saveName).toBe('Fixture');
    expect(body.summary).toMatchObject({
      save: { saveName: 'Fixture' },
      player: {},
      production: [],
      storage: [],
      nearbyResources: [],
    });
  });

  it('lists the nearest node of each resource from the player position', async () => {
    const state = emptySaveState('v', 'Fixture', NOW);
    state.player.location = { x: 0, y: 0, z: 0 };
    const result = await summaryHandler(state)({});
    const body = JSON.parse(result.content[0]!.text) as {
      summary: { player: { position: unknown }; nearbyResources: unknown[] };
    };
    expect(body.summary.player.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(body.summary.nearbyResources).toEqual([
      { resource: 'Iron Ore', purity: 'pure', distanceMetres: 100, bearing: 'E', biome: null },
    ]);
  });
});
