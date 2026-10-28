// Registers the save-game MCP tools (player state, recipes, milestones, storage, collectibles,
// production, power, bottlenecks, nearby items and parts, material coverage), resolving the save
// per call through the registry and delegating the maths to query/.

import { loadWorldLocations, type WorldLocations } from '@foreman/sf-game-data';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { bottlenecksView } from '../query/bottlenecks.js';
import { loadGameDataIndex, makeNameResolver } from '../gameData.js';
import { logger } from '../logger.js';
import {
  collectedGuidSet,
  collectedLootIdSet,
  unlockedSchematicSet,
  collectibleProgressView,
  materialCoverageView,
  milestones,
  nearbyFromWorld,
  nearbyParts,
  playerSummary,
  powerView,
  productionView,
  storageView,
  unlockedRecipes,
} from '../query/selectors.js';
import type { SaveStore } from '../store/saveStore.js';
import type { SaveStoreRegistry } from '../store/registry.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const collectibleKindSchema = z.enum([
  'mercerSphere',
  'somersloop',
  'powerSlugBlue',
  'powerSlugYellow',
  'powerSlugPurple',
  'hardDrive',
  'helmet',
  'mtape',
]);

// The host (foreman backend) injects the active playthrough's save path; the
// model never needs to set it. Optional so the legacy single-save mode still
// works when no path is supplied. The registry checks only that the path is
// inside SAVE_DATA_DIR, not who owns the save: a host must never forward a
// savePath from the model; it must remove it and inject its own.
const savePathSchema = z
  .string()
  .optional()
  .describe('Managed by the host — the save to read. Leave unset.');

/**
 * Registers the save-game tools. Descriptions are tight and model-facing — they
 * appear in the system context on every request. All tools are read-only and tag
 * every response with the detected game version and save name. Each accepts an
 * optional `savePath` (host-injected) so a tool call reads the right
 * playthrough's save; the {@link SaveStoreRegistry} resolves (and caches) it.
 */
export function registerSaveTools(server: McpServer, registry: SaveStoreRegistry): void {
  // The static world-location dataset (every fixed collectible placement), loaded
  // once at startup. Backs get_nearby — complete and accurate, unlike the save,
  // which only contains collectibles in already-streamed World-Partition cells.
  const worldResolution = loadWorldLocations();
  if (worldResolution.warning !== undefined) {
    logger.warn(worldResolution.warning);
  }
  const world: WorldLocations = worldResolution.world;

  // The parsed game-data index (display names + recipes + buildings + stack sizes),
  // loaded once. Display names upgrade drop-pod unlock costs and loose-part listings
  // from raw Desc_* classes; recipes/buildings back the production-rate + power join.
  const gameData = loadGameDataIndex();
  const resolveName = makeNameResolver(gameData);

  const ok = (store: SaveStore, payload: object): ToolResult => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ version: store.version, saveName: store.saveName, ...payload }),
      },
    ],
  });

  server.registerTool(
    'get_player_state',
    {
      title: 'Get player state',
      description:
        "The pioneer's current world location, HUB location, total play time, and personal inventory (aggregated per item). Coordinates are in metres (matching the in-game HUD).",
      inputSchema: { savePath: savePathSchema },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { player: playerSummary(store.getState(), resolveName) });
    },
  );

  server.registerTool(
    'get_unlocked_recipes',
    {
      title: 'Get unlocked recipes',
      description: 'All unlocked recipes, split into standard and alternate, with counts.',
      inputSchema: { savePath: savePathSchema },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { recipes: unlockedRecipes(store.getState(), resolveName) });
    },
  );

  server.registerTool(
    'get_milestones',
    {
      title: 'Get milestones',
      description:
        'Purchased milestones grouped by tier, the current Project Assembly (Space Elevator) phase, and `mamResearch` — the MAM research TREES the pioneer has unlocked (e.g. "Power Slugs", "Hard Drive"), i.e. the categories available to research, NOT individual completed nodes. `other` is a catch-all of remaining schematics; do not present it as completed MAM research.',
      inputSchema: { savePath: savePathSchema },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { progress: milestones(store.getState(), gameData, resolveName) });
    },
  );

  server.registerTool(
    'get_storage',
    {
      title: 'Get storage',
      description:
        'Storage container contents and the dimensional depot; container locations are in metres. Pass a location {x,y,z} in metres (e.g. from get_player_state) to sort containers nearest-first by distance (metres).',
      inputSchema: { location: vec3Schema.optional(), savePath: savePathSchema },
    },
    async ({ location, savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { storage: storageView(store.getState(), resolveName, location) });
    },
  );

  server.registerTool(
    'get_collectibles',
    {
      title: 'Get collectibles',
      description:
        "Exact per-kind collectible progress (Mercer Sphere, Somersloop, blue/yellow/purple power slug, hard drive): worldTotal, collected, and remaining. Counts are read from the save's own collected record and are exact at any progression — not estimates. Use get_nearby for the locations of the remaining ones.",
      inputSchema: { savePath: savePathSchema },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { collectibles: collectibleProgressView(store.getState(), world) });
    },
  );

  server.registerTool(
    'get_collected_identities',
    {
      title: 'Get collected collectible identities',
      description:
        "The identity keys of every collectible the save records as COLLECTED: `guids` (Mercer Spheres, Somersloops, power slugs, hard-drive pods — matched by pickup GUID) and `schematics` (customizer helmet/tapes, which unlock a cosmetic schematic rather than recording a GUID). A collectible is collected iff its guid is in `guids` or its schematic is in `schematics`. Use this to reconcile an explore order's collectibles against a re-uploaded save. Identity only — no coordinates.",
      inputSchema: { savePath: savePathSchema },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      const state = store.getState();
      return ok(store, {
        guids: [...collectedGuidSet(state)],
        schematics: [...unlockedSchematicSet(state)],
      });
    },
  );

  server.registerTool(
    'get_nearby',
    {
      title: 'Get nearby collectibles',
      description:
        'Un-collected collectibles near a world location, nearest-first, each with coordinates (metres), distance (metres), and a compass bearing (N/NE/E/…) from the origin. Positions are from the complete world dataset, with the ones the save records as already collected removed — so these are genuinely still grabbable. Filter by kinds (mercerSphere, somersloop, powerSlugBlue/Yellow/Purple, hardDrive), cap by radius (metres) and limit (default 20). Use the player location from get_player_state (also metres) as the origin to answer "what can I grab near me?". For hard drives, `unlockCost` is what the drop pod requires to open it (items and/or power) — it is a COST to open the pod, NOT a reward; the reward is the hard drive itself, which unlocks an alternate-recipe research at the MAM.',
      inputSchema: {
        location: vec3Schema,
        kinds: z.array(collectibleKindSchema).optional(),
        radius: z.number().positive().optional(),
        limit: z.number().int().positive().max(200).optional(),
        savePath: savePathSchema,
      },
    },
    async ({ location, kinds, radius, limit, savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      const state = store.getState();
      return ok(store, {
        nearby: nearbyFromWorld(
          world.collectibles,
          location,
          { kinds, radius, limit },
          collectedGuidSet(state),
          unlockedSchematicSet(state),
          resolveName,
        ),
      });
    },
  );

  server.registerTool(
    'get_nearby_parts',
    {
      title: 'Get nearby loose crash-site parts',
      description:
        'Un-grabbed loose crash-site parts near a world location, nearest-first, each with the item, amount, coordinates (metres), distance (metres) and a compass bearing from the origin. These are the free high-tier parts strewn around crash sites (Computers, Heavy Modular Frames, Motors, …) — answer "where can I grab a part I can\'t craft yet?". Positions come from the complete static world dataset, with the ones the save records as already picked up removed (map-wide, not just explored areas). Filter by item (name or class, e.g. "Computer"); cap by radius (metres) and limit (default 20). Pass the player location from get_player_state (metres).',
      inputSchema: {
        location: vec3Schema,
        item: z.string().optional(),
        radius: z.number().positive().optional(),
        limit: z.number().int().positive().max(200).optional(),
        savePath: savePathSchema,
      },
    },
    async ({ location, item, radius, limit, savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      const state = store.getState();
      return ok(store, {
        nearby: nearbyParts(
          world.lootPickups,
          location,
          { item, radius, limit },
          collectedLootIdSet(state),
          resolveName,
        ),
      });
    },
  );

  server.registerTool(
    'get_production',
    {
      title: 'Get production capacity',
      description:
        'What the factory can produce, aggregated by output item: across all recipe machines (Constructor → Manufacturer, Refinery, Blender, Particle Accelerator, …) and resource extractors (miners, pumps, fracking), the total effective per-minute output of each item, how many machines make it, and a breakdown by recipe/extractor. Effective = recipe rate × clock × somersloop boost (× node purity for extractors) — i.e. CONFIGURED capacity at full tilt, NOT measured output: it does not account for whether lines are actually fed (belts/splitters/pipes) or powered. Also returns an estimated total power draw. Pass `item` (name or class, e.g. "Iron Plate") to narrow to one item and additionally list the individual machines with their locations (metres).',
      inputSchema: { item: z.string().optional(), savePath: savePathSchema },
    },
    async ({ item, savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { production: productionView(store.getState(), gameData, world, { item }) });
    },
  );

  server.registerTool(
    'check_material_coverage',
    {
      title: 'Check material coverage',
      description:
        'Pre-work-order dependency check: given a list of materials (item names or classes), reports for each whether existing automation already produces it (effective per-minute + machine count) and how much is on hand in storage + the dimensional depot, plus a `gaps` list of materials that are neither produced nor stocked. Call this BEFORE issuing a work order with the materials it requires (build-cost items and/or production inputs); for any gap, issue a prerequisite work order to automate it first. Coverage is capacity/stock, not a guarantee the amount suffices — judge quantities for one-off builds.',
      inputSchema: {
        items: z.array(z.string()).min(1).describe('Materials to check (item name or class).'),
        savePath: savePathSchema,
      },
    },
    async ({ items, savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, {
        coverage: materialCoverageView(store.getState(), gameData, world, items, resolveName),
      });
    },
  );

  server.registerTool(
    'get_power',
    {
      title: 'Get power grid status',
      description:
        "The save's power grids: for each power circuit, its generation capacity vs estimated consumption (MW), the balance (headroom), and a status (ok / tight / overloaded / unknown), plus factory-wide totals and a rollup of generators by type (count, combined output, fuel loaded). Circuits are the game's pre-grouped grids. Capacity is each generator's nameplate output × clock (LINEAR in clock); consumption is an ESTIMATE (production machines scaled by clock/somersloop, other powered buildings at 100%). Geothermal output is variable and excluded from the numeric capacity (the circuit is flagged hasVariableGenerators — real capacity is higher); fuel supply is not checked. Answers \"is my power OK / which grid is overloaded?\".",
      inputSchema: { savePath: savePathSchema },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { power: powerView(store.getState(), store.getGraph(), gameData) });
    },
  );

  server.registerTool(
    'find_bottlenecks',
    {
      title: 'Find production bottlenecks',
      description:
        'Reconciles the factory\'s actual material flow and reports which machines are not running at full rate, and WHY. Distributes every source\'s output through belts/pipes (throughput-capped) and splitters/mergers to each machine input, then flags a producer "starved" when an input is delivered below its required rate (beyond the tolerance), "unpowered" (on an overloaded power circuit with no battery buffer), "idle" (no recipe set), or "unknown" (flow direction could not be resolved — never a false starved). Returns a summary by verdict plus the affected machines with the upstream cause (which input, delivered vs required) — not a graph dump. Unlike get_production (configured capacity), this accounts for feed, contention and belt limits. Pass `tolerance` (default 0.05) to widen/narrow the band. Honours smart/programmable splitter filters (item/any/overflow/any-undefined); fluid (pipe) inputs are reconciled over the connected pipe network — starved if no source of the fluid is on the network, the machine is above the network’s shared head lift (a tall consumer with no pump), or the network’s total supply of that fluid falls short of its total reachable demand (shared-pool contention; per-leg pipe throughput not modelled). Applies the save\'s 1.2 Advanced Game Settings: recipe parts-cost × on inputs, power-consumption × on draw (Creative No Power → zero), and resolved node type/purity under randomisation.',
      inputSchema: { tolerance: z.number().min(0).max(1).optional(), savePath: savePathSchema },
    },
    async ({ tolerance, savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, {
        bottlenecks: bottlenecksView(store.getState(), store.getGraph(), gameData, world, {
          tolerance,
        }),
      });
    },
  );

  // Host-facing: parse just the header of a save and return its in-game name +
  // version, used to seed a playthrough's default name on upload.
  server.registerTool(
    'describe_save',
    {
      title: 'Describe save',
      description:
        "Host-internal: returns a save file's identity (in-game name, session/map, build & save version, play time), used by the backend to seed a playthrough name and detect version/same-game on upload. Not for answering pioneer questions — for play time, location, or progress use get_player_state / get_milestones.",
      inputSchema: { savePath: z.string().describe('The save file to describe.') },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      // Parse (mtime-gated) and surface the header identity.
      const state = store.getState();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              saveName: state.saveName,
              version: state.version,
              sessionName: state.sessionName,
              mapName: state.mapName,
              buildVersion: state.buildVersion,
              saveVersion: state.saveVersion,
              playDurationSeconds: state.playDurationSeconds,
              creativeModeEnabled: state.creativeMode.enabled,
            }),
          },
        ],
      };
    },
  );
}
