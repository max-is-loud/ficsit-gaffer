// Registers the game-data MCP tools (items, recipes, production lines, schematics, buildings, world
// collectibles and resource nodes) against the production graph and world queries, converting
// between metres and centimetres at the edge.

import type { Coord, WorldQueries } from '@foreman/sf-game-data';
import { cmToMetres, compassBearing, metresToCm } from '@foreman/sf-present';
import type { GraphDB } from '@foreman/sf-game-data-graph';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/** Collectible kinds accepted by the world-location tools. */
const collectibleKind = z.enum([
  'mercerSphere',
  'somersloop',
  'powerSlugBlue',
  'powerSlugYellow',
  'powerSlugPurple',
  'hardDrive',
  'helmet',
  'mtape',
]);

/** A world location in **metres** (matching the in-game HUD) — usually the pioneer's position. */
const coord = z.object({ x: z.number(), y: z.number(), z: z.number() });

/** Pioneer-facing metres → internal centimetres (the dataset/query unit). */
function toCm(origin: { x: number; y: number; z: number }): Coord {
  return { x: metresToCm(origin.x), y: metresToCm(origin.y), z: metresToCm(origin.z) };
}

/**
 * A world hit (centimetre x/y/z + cm distance) reshaped for the pioneer: coordinates and
 * distance in metres plus a compass bearing from the (metres) origin. Identity fields
 * (`guid` / `id` / `schematic`) are PRESERVED so a collectible can be stored on an
 * explore-order waypoint and later reconciled by identity on save re-upload (#207/#209).
 */
function placeInMetres<T extends { x: number; y: number; z: number; distance: number }>(
  hit: T,
  originMetres: { x: number; y: number },
): T & { bearing: string } {
  const x = cmToMetres(hit.x);
  const y = cmToMetres(hit.y);
  return {
    ...hit,
    x,
    y,
    z: cmToMetres(hit.z),
    distance: cmToMetres(hit.distance),
    bearing: compassBearing(originMetres, { x, y }),
  };
}

/** The biome a (centimetre) point falls in — nearest biome for coastal/cave points; null if none loaded. */
function biomeOf(world: WorldQueries, h: { x: number; y: number; z: number }): string | null {
  return world.biomeAt({ x: h.x, y: h.y, z: h.z })?.name ?? null;
}

/**
 * Registers every Foreman MCP tool. Tool descriptions are tight and
 * model-facing — they appear in the system context on every request. All
 * responses are version-tagged. Tools return computed, distilled answers; the
 * recursion and aggregation happen server-side in the graph layer.
 */
export function registerGameDataTools(
  server: McpServer,
  graph: GraphDB,
  world: WorldQueries,
): void {
  const ok = (payload: object): ToolResult => ({
    content: [{ type: 'text', text: JSON.stringify({ version: graph.version, ...payload }) }],
  });
  const notFound = (what: string): ToolResult => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ version: graph.version, error: `Not found: ${what}` }),
      },
    ],
    isError: true,
  });

  server.registerTool(
    'get_item',
    {
      title: 'Get item',
      description:
        'Resolve an item by display name or class name. Returns item details including form (solid/liquid/gas) and sink points.',
      inputSchema: { name: z.string() },
    },
    async ({ name }): Promise<ToolResult> => {
      const item = graph.getItem(name);
      return item === undefined ? notFound(`item '${name}'`) : ok({ item });
    },
  );

  server.registerTool(
    'list_items',
    {
      title: 'List items',
      description:
        'Discover canonical item (and resource) names before naming one in a work order. Returns compact entries (display name, class name) for every real item. Pass a search term to narrow by name (e.g. "plate" → Iron Plate, Reinforced Iron Plate, Copper Sheet…). Use this whenever unsure of an item\'s exact name — item names in a work order resolve by exact display or class name, so a near-miss silently degrades the plan.',
      inputSchema: { search: z.string().optional() },
    },
    async ({ search }): Promise<ToolResult> => {
      return ok({ items: graph.listItems({ search }) });
    },
  );

  server.registerTool(
    'get_recipe',
    {
      title: 'Get recipe',
      description:
        'Resolve a recipe by display name or class name. Returns the full recipe: ingredients, products, machine and per-minute rates.',
      inputSchema: { name: z.string() },
    },
    async ({ name }): Promise<ToolResult> => {
      const recipe = graph.getRecipe(name);
      return recipe === undefined ? notFound(`recipe '${name}'`) : ok({ recipe });
    },
  );

  server.registerTool(
    'list_recipes',
    {
      title: 'List recipes',
      description:
        'Discover canonical recipe names before naming one in a work order. Returns compact entries (display name, class name, isAlternate) for every recipe. Pass a search term to narrow by name (e.g. "rotor" → Rotor, Alternate: Steel Rotor…). isAlternate distinguishes the standard recipe from alternates that can share a display name. Use this whenever unsure of a recipe\'s exact name — recipe names in a work order resolve by exact display or class name.',
      inputSchema: { search: z.string().optional() },
    },
    async ({ search }): Promise<ToolResult> => {
      return ok({ recipes: graph.listRecipes({ search }) });
    },
  );

  server.registerTool(
    'recipes_for',
    {
      title: 'Recipes for item',
      description:
        'All recipes that produce the named item, including alternates. Flags which recipe is the standard one.',
      inputSchema: { item: z.string() },
    },
    async ({ item }): Promise<ToolResult> => {
      const result = await graph.recipesFor(item);
      return result === undefined ? notFound(`item '${item}'`) : ok(result);
    },
  );

  server.registerTool(
    'ingredient_tree',
    {
      title: 'Ingredient tree',
      description:
        'Flat list of per-minute requirements and machine counts for every tier of production of an item at a target rate. Does NOT return nested recipe objects — the graph does the recursion and returns the computed answer. Optional recipeChoices maps an item (name or class) to a chosen recipe.',
      inputSchema: {
        item: z.string(),
        targetPerMinute: z.number().positive(),
        recipeChoices: z.record(z.string(), z.string()).optional(),
      },
    },
    async ({ item, targetPerMinute, recipeChoices }): Promise<ToolResult> => {
      const result = await graph.ingredientTree(item, targetPerMinute, recipeChoices);
      return result === undefined ? notFound(`item '${item}'`) : ok({ tree: result });
    },
  );

  server.registerTool(
    'full_production_line',
    {
      title: 'Full production line cost',
      description:
        'Total build cost of a whole production line for an item at a target rate: every production machine (exact, honouring chosen standard/alt recipes via recipeChoices), the miners/extractors to feed it (exact, by miner mark + node purity), and a close-enough ESTIMATE of belts, pipes, splitters and mergers — aggregated into one shopping list (totalBuildCost). Logistics figures are estimates (factory layout/length is not in the game data) and flagged; tune via the optional assumptions.',
      inputSchema: {
        item: z.string(),
        targetPerMinute: z.number().positive(),
        recipeChoices: z.record(z.string(), z.string()).optional(),
        assumptions: z
          .object({
            minerMark: z.number().int().min(1).max(3).optional(),
            purity: z.enum(['impure', 'normal', 'pure']).optional(),
            beltMetresPerLink: z.number().positive().optional(),
          })
          .optional(),
      },
    },
    async ({ item, targetPerMinute, recipeChoices, assumptions }): Promise<ToolResult> => {
      const result = await graph.fullProductionLine(
        item,
        targetPerMinute,
        recipeChoices,
        assumptions,
      );
      return result === undefined ? notFound(`item '${item}'`) : ok(result);
    },
  );

  server.registerTool(
    'total_raw_inputs',
    {
      title: 'Total raw inputs',
      description:
        'Leaf raw resources only (iron ore, water, crude oil, …) needed to produce an item at a target rate. What the player actually has to mine or extract.',
      inputSchema: { item: z.string(), targetPerMinute: z.number().positive() },
    },
    async ({ item, targetPerMinute }): Promise<ToolResult> => {
      const result = await graph.totalRawInputs(item, targetPerMinute);
      return result === undefined ? notFound(`item '${item}'`) : ok(result);
    },
  );

  server.registerTool(
    'what_consumes',
    {
      title: 'What consumes item',
      description: 'All recipes that use the named item as an ingredient.',
      inputSchema: { item: z.string() },
    },
    async ({ item }): Promise<ToolResult> => {
      const result = await graph.whatConsumes(item);
      return result === undefined ? notFound(`item '${item}'`) : ok(result);
    },
  );

  server.registerTool(
    'compare_alternates',
    {
      title: 'Compare alternate recipes',
      description:
        'Side-by-side cost and throughput comparison for all recipes (standard and alternate) that produce the named item.',
      inputSchema: { item: z.string() },
    },
    async ({ item }): Promise<ToolResult> => {
      const result = await graph.compareAlternates(item);
      return result === undefined ? notFound(`item '${item}'`) : ok(result);
    },
  );

  server.registerTool(
    'buildable_with',
    {
      title: 'Buildable with resources',
      description:
        'Given a list of raw resource names, returns every item producible from them (transitive closure over recipes).',
      inputSchema: { resources: z.array(z.string()).min(1) },
    },
    async ({ resources }): Promise<ToolResult> => {
      const buildable = await graph.buildableWith(resources);
      return ok({ resources, buildable });
    },
  );

  server.registerTool(
    'list_schematics',
    {
      title: 'List schematics',
      description:
        "All schematics (milestones, MAM, AWESOME shop, hard drives), optionally filtered by tier and/or a search term matched against display and class name. Use the search term to confirm a schematic's exact name before naming one in a work-order unlock output.",
      inputSchema: {
        tier: z.number().int().min(0).optional(),
        search: z.string().optional(),
      },
    },
    async ({ tier, search }): Promise<ToolResult> => {
      return ok({ schematics: graph.listSchematics({ tier, search }) });
    },
  );

  server.registerTool(
    'get_schematic',
    {
      title: 'Get schematic',
      description:
        'Resolve a schematic by display name or class name. Returns it with its full unlock list.',
      inputSchema: { name: z.string() },
    },
    async ({ name }): Promise<ToolResult> => {
      const schematic = graph.getSchematic(name);
      return schematic === undefined ? notFound(`schematic '${name}'`) : ok({ schematic });
    },
  );

  server.registerTool(
    'get_building',
    {
      title: 'Get building',
      description:
        'Resolve a building or machine by display name or class name. Returns power draw (constant, or max for variable-power machines), build cost, and — for power generators — MW output plus every fuel option with per-minute fuel, supplemental (water) and byproduct rates.',
      inputSchema: { name: z.string() },
    },
    async ({ name }): Promise<ToolResult> => {
      const building = graph.getBuilding(name);
      return building === undefined ? notFound(`building '${name}'`) : ok({ building });
    },
  );

  server.registerTool(
    'list_power_generators',
    {
      title: 'List power generators',
      description:
        'Every power-generating building with its MW output and complete fuel breakdown: per-minute fuel burn (per fuel option), supplemental water, and byproducts (e.g. nuclear waste). The authoritative source for power planning.',
      inputSchema: {},
    },
    async (): Promise<ToolResult> => {
      return ok({ generators: graph.listPowerGenerators() });
    },
  );

  server.registerTool(
    'list_buildings',
    {
      title: 'List buildings',
      description:
        'Discover canonical buildable names before naming one in a work order. Returns compact entries (display name, class name, category) for every real buildable. Pass a search term to narrow by name (e.g. "splitter" → Conveyor Splitter, Smart Splitter, Programmable Splitter; "pipeline pump" → Pipeline Pump Mk.1/Mk.2), or a category to list one group. Use this whenever you are unsure of a building\'s exact name — get_building and work-order costs resolve by exact display or class name, so a near-miss name silently drops its build cost.',
      inputSchema: {
        search: z.string().optional(),
        category: z.string().optional(),
      },
    },
    async ({ search, category }): Promise<ToolResult> => {
      return ok({ buildings: graph.listBuildings({ search, category }) });
    },
  );

  server.registerTool(
    'list_collectibles',
    {
      title: 'List collectibles',
      description:
        'World totals for each collectible kind (Mercer Spheres, Somersloops, blue/yellow/purple power slugs, hard-drive drop pods). Supply a type to also get the full coordinate list (metres) for that one kind, each with its stable identity (`guid` or `schematic`, plus `id`). These are fixed world placements, not what a particular save has collected.',
      inputSchema: { type: collectibleKind.optional() },
    },
    async ({ type }): Promise<ToolResult> => {
      const result = world.listCollectibles(type);
      // Keep identity (guid / schematic / id) so the foreman can store a keyed collectible.
      const collectibles = result.collectibles?.map((c) => ({
        ...c,
        x: cmToMetres(c.x),
        y: cmToMetres(c.y),
        z: cmToMetres(c.z),
      }));
      return ok({ ...result, collectibles });
    },
  );

  server.registerTool(
    'nearest_collectibles',
    {
      title: 'Nearest collectibles',
      description:
        'The collectibles closest to a world location, nearest-first, each with its coordinates (metres), straight-line distance (metres), a compass bearing (N/NE/E/…) from the origin, and its stable identity — `guid` (GUID-keyed kinds) or `schematic` (customizer helmet/tapes) plus `id`. Filter by type; cap with n (default 10). Pass the pioneer location (metres, from the save) as the coord to answer "what can I grab near me?". Store the identity on an explore-order waypoint so collection can be reconciled on save re-upload.',
      inputSchema: {
        coord,
        type: collectibleKind.optional(),
        n: z.number().int().positive().optional(),
      },
    },
    async ({ coord: origin, type, n }): Promise<ToolResult> => {
      const hits = world.nearestCollectibles(toCm(origin), type, n);
      return ok({
        collectibles: hits.map((h) => ({ ...placeInMetres(h, origin), biome: biomeOf(world, h) })),
      });
    },
  );

  server.registerTool(
    'resolve_collectibles',
    {
      title: 'Resolve collectibles by id',
      description:
        "Resolve collectibles by their stable `id` (as returned by nearest_collectibles / list_collectibles) to their canonical world facts: kind, coordinates (metres), identity (guid or schematic) and — for hard-drive pods — the `unlock` COST (power/items needed to open the pod). Use this at explore-order authoring so each waypoint collectible carries accurate, server-verified facts (never a guessed or omitted pod cost). Any id that isn't a known collectible is returned in `unresolved` — fix those before issuing. Coordinates only; no save state.",
      inputSchema: { ids: z.array(z.string()).min(1) },
    },
    async ({ ids }): Promise<ToolResult> => {
      const { resolved, unresolved } = world.resolveCollectibles(ids);
      return ok({
        resolved: resolved.map((c) => ({
          ...c,
          x: cmToMetres(c.x),
          y: cmToMetres(c.y),
          z: cmToMetres(c.z),
        })),
        unresolved,
      });
    },
  );

  server.registerTool(
    'nearest_resource_nodes',
    {
      title: 'Nearest resource nodes',
      description:
        'The resource extraction points closest to a world location, nearest-first, each with resource type, purity (impure/normal/pure), coordinates (metres), distance (metres) and a compass bearing (N/NE/E/…) from the origin. Covers ore/fluid nodes, fracking satellites and cores, and geothermal geysers. Filter by resource (name or class, e.g. "Iron Ore") and/or purity; cap with n (default 10). Pass the pioneer location in metres.',
      inputSchema: {
        coord,
        resource: z.string().optional(),
        purity: z.enum(['impure', 'normal', 'pure']).optional(),
        n: z.number().int().positive().optional(),
      },
    },
    async ({ coord: origin, resource, purity, n }): Promise<ToolResult> => {
      const hits = world.nearestResourceNodes(toCm(origin), { resource, purity, n });
      return ok({
        nodes: hits.map((h) => ({ ...placeInMetres(h, origin), biome: biomeOf(world, h) })),
      });
    },
  );

  server.registerTool(
    'list_parts',
    {
      title: 'List loose crash-site parts',
      description:
        'World summary of the loose manufactured parts strewn around crash sites (free high-tier items like Computers, Heavy Modular Frames, Motors) — per item, the number of pickups and the total quantity across the whole map. Filter by item (name or class, e.g. "Computer"). These are fixed world placements (the corrected 1.2 loot), not what a particular save has collected.',
      inputSchema: { item: z.string().optional() },
    },
    async ({ item }): Promise<ToolResult> => ok(world.listParts(item)),
  );

  server.registerTool(
    'nearest_parts',
    {
      title: 'Nearest loose crash-site parts',
      description:
        'The loose crash-site parts closest to a world location, nearest-first, each with the item, amount, coordinates (metres), straight-line distance (metres) and a compass bearing (N/NE/E/…) from the origin. Filter by item (name or class, e.g. "Heavy Modular Frame"); cap with n (default 10). Pass the pioneer location (metres, from the save) to answer "where can I grab a part I cannot craft yet?". Fixed world placements — to exclude ones already grabbed, use the save-game tool instead.',
      inputSchema: {
        coord,
        item: z.string().optional(),
        n: z.number().int().positive().optional(),
      },
    },
    async ({ coord: origin, item, n }): Promise<ToolResult> => {
      const hits = world.nearestParts(toCm(origin), item, n);
      return ok({
        parts: hits.map((h) => ({ ...placeInMetres(h, origin), biome: biomeOf(world, h) })),
      });
    },
  );

  server.registerTool(
    'describe_location',
    {
      title: 'Describe a world location by biome',
      description:
        'Name the biome a world location (metres) falls in — or the nearest biome for a coastal/cave point — plus the rough direction within it, so you can phrase a position as "the north-west of the Grass Fields" instead of raw coordinates. Returns { biome, within (N/NE/… from the biome centre), contained (true when inside the biome), distanceMetres (0 when inside, else metres to its edge), isStartingLocation }. Pass the pioneer location, a work-order location, or a collectible/resource coordinate (metres).',
      inputSchema: { coord },
    },
    async ({ coord: origin }): Promise<ToolResult> => {
      const cm = toCm(origin);
      const hit = world.biomeAt(cm);
      if (hit === null) {
        return ok({ biome: null });
      }
      return ok({
        biome: hit.name,
        within: compassBearing(hit.centroid, cm), // direction from the biome centre to the point
        contained: hit.contained,
        distanceMetres: cmToMetres(hit.distance),
        isStartingLocation: hit.isStartingLocation,
      });
    },
  );
}
