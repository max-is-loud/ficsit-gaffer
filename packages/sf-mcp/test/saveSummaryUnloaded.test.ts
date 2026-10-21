import { describe, expect, it } from 'vitest';

import { WorldQueries, type GameData, type WorldLocations } from '@foreman/sf-game-data';
import { emptySaveState } from '@foreman/sf-save-data';
import { buildSaveGraph } from '@foreman/sf-save-data-graph';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadGameDataIndex } from '../src/gameData.js';
import { SaveStore, type SaveStoreDeps } from '../src/store/saveStore.js';
import { SaveStoreRegistry } from '../src/store/registry.js';
import { registerSaveSummaryTool } from '../src/tools/saveSummary.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;
const NOW = '2026-01-01T00:00:00.000Z';
const SAVES = '/saves';
const SAVE_PATH = '/saves/game.sav';

const locations: WorldLocations = {
  gameVersion: 'test',
  build: 0,
  source: 'test',
  counts: {},
  collectibles: [],
  resourceNodes: [],
  lootPickups: [],
  biomes: [],
};

/** A save file whose parse fails until `readable` is set, and whose mtime the test controls. */
function flakySave(): SaveStoreDeps & { readable: boolean; mtime: number } {
  const file = {
    readable: false,
    mtime: 1,
    statMtime: (): number => file.mtime,
    load: () => {
      if (!file.readable) {
        throw new Error('truncated save');
      }
      const state = emptySaveState('1.1', 'Real Save', NOW);
      return { state, graph: buildSaveGraph(state) };
    },
    now: () => NOW,
  };
  return file;
}

function summaryHandler(defaultStore: SaveStore, deps: SaveStoreDeps): Handler {
  const registry = new SaveStoreRegistry(defaultStore, SAVES, 5, deps);
  const handlers = new Map<string, Handler>();
  const stubServer = {
    registerTool(name: string, _schema: unknown, handler: Handler): void {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  registerSaveSummaryTool(stubServer, registry, {
    locations,
    queries: new WorldQueries(locations, { items: {}, resources: {} } as unknown as GameData),
    gameData: loadGameDataIndex(),
  });
  const handler = handlers.get('get_save_summary');
  if (handler === undefined) {
    throw new Error('get_save_summary is not registered');
  }
  return handler;
}

function errorText(result: ToolResult): string {
  return (JSON.parse(result.content[0]!.text) as { error: string }).error;
}

describe('get_save_summary without a loaded save', () => {
  it('reports an unreadable save, then summarises it once a re-read succeeds', async () => {
    const file = flakySave();
    const handler = summaryHandler(new SaveStore(undefined), file);

    const failed = await handler({ savePath: SAVE_PATH });
    expect(failed.isError).toBe(true);
    expect(errorText(failed)).toMatch(/No save is loaded/);

    file.readable = true;
    file.mtime = 2;
    const recovered = await handler({ savePath: SAVE_PATH });
    expect(recovered.isError).toBeFalsy();
    const body = JSON.parse(recovered.content[0]!.text) as { version: string; saveName: string };
    expect(body).toMatchObject({ version: '1.1', saveName: 'Real Save' });
  });

  it('reports a save that cannot be stat-ed', async () => {
    const file = flakySave();
    file.statMtime = (): number => {
      throw new Error('ENOENT');
    };
    const result = await summaryHandler(new SaveStore(undefined), file)({ savePath: SAVE_PATH });
    expect(result.isError).toBe(true);
  });

  it('refuses a path outside the allowed directory rather than summarising the default save', async () => {
    const defaultStore = SaveStore.fromState(emptySaveState('1.1', 'Default', NOW));
    const result = await summaryHandler(defaultStore, flakySave())({ savePath: '/etc/passwd' });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/outside the allowed save directory/);
  });

  it('reports that no save is configured', async () => {
    const result = await summaryHandler(new SaveStore(undefined), flakySave())({});
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/No save is loaded/);
  });
});
