// Registers the host-internal get_save_summary tool: collects a save's views from the existing
// selectors plus the player's surroundings from the world data, and returns the capped summary the
// host renders into the foreman's context.

import type { Coord, WorldLocations, WorldQueries } from '@foreman/sf-game-data';
import type { SaveState } from '@foreman/sf-save-data';
import { cmToMetres, compassBearing } from '@foreman/sf-present';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { makeNameResolver, type GameDataIndex } from '../gameData.js';
import {
  nearestPerResource,
  SUMMARY_CAPS,
  summariseSave,
  type SaveViews,
  type SummaryResourceNode,
} from '../query/saveSummary.js';
import {
  milestones,
  playerSummary,
  powerView,
  productionView,
  storageView,
  unlockedRecipes,
} from '../query/selectors.js';
import { unlockedNames } from '../query/unlocks.js';
import type { SaveStore } from '../store/saveStore.js';
import type { SaveStoreRegistry } from '../store/registry.js';
import type { ToolResult } from './toolResult.js';

/** Nodes scanned around the player when picking the nearest of each resource type. */
const NODE_SCAN = 200;

/**
 * What the summary reads besides the save: raw world placements (production), world queries
 * (places) and the game-data index, all loaded once by the caller.
 */
export interface SaveSummarySources {
  locations: WorldLocations;
  queries: WorldQueries;
  gameData: GameDataIndex;
}

/** The biome the player stands in and the direction within it, as describe_location gives. */
function playerBiome(world: WorldQueries, location: Coord): SaveViews['playerBiome'] {
  const hit = world.biomeAt(location);
  return hit === null
    ? undefined
    : { biome: hit.name, within: compassBearing(hit.centroid, location) };
}

function nearbyResources(world: WorldQueries, location: Coord): SummaryResourceNode[] {
  const hits = world.nearestResourceNodes(location, { n: NODE_SCAN });
  return nearestPerResource(hits, SUMMARY_CAPS.resourceTypes).map((hit) => ({
    resource: hit.resource?.displayName ?? 'Unknown',
    purity: hit.purity,
    distanceMetres: Math.round(cmToMetres(hit.distance)),
    bearing: compassBearing(location, hit),
    biome: world.biomeAt(hit)?.name ?? null,
  }));
}

function collectViews(store: SaveStore, sources: SaveSummarySources): SaveViews {
  const { gameData } = sources;
  const state: SaveState = store.getState();
  const resolve = makeNameResolver(gameData);
  const location = state.player.location;
  return {
    meta: {
      saveName: store.saveName,
      version: store.version,
      savedAt: state.savedAt,
      playDurationSeconds: state.playDurationSeconds,
    },
    player: playerSummary(state, resolve),
    playerBiome: location === undefined ? undefined : playerBiome(sources.queries, location),
    progress: milestones(state, gameData, resolve),
    recipes: unlockedRecipes(state, resolve),
    power: powerView(state, store.getGraph(), gameData),
    production: productionView(state, gameData, sources.locations),
    storage: storageView(state, resolve),
    nearbyResources: location === undefined ? [] : nearbyResources(sources.queries, location),
    unlocks: unlockedNames(state, gameData),
  };
}

/**
 * Registers `get_save_summary`. Host-internal: the backend calls it once per save and keeps the
 * result in the foreman's context; the model is not offered it.
 */
export function registerSaveSummaryTool(
  server: McpServer,
  registry: SaveStoreRegistry,
  sources: SaveSummarySources,
): void {
  server.registerTool(
    'get_save_summary',
    {
      title: 'Get save summary',
      description:
        "Host-internal: a compact, capped summary of a save (position, progress, recipes, unlocked buildings, power, top production and storage, nearest resource types) that the backend places in the foreman's context. Not for answering pioneer questions directly.",
      inputSchema: {
        savePath: z.string().optional().describe('Managed by the host — the save to read.'),
      },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      const summary = summariseSave(collectViews(store, sources));
      const payload = { version: store.version, saveName: store.saveName, summary };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  );
}
