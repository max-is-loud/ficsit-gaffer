// Registers the name-keyed game-data lookup tools (get_item, get_recipe, get_building,
// get_schematic, recipes_for) from one table. Each accepts a single name, or a list resolved in one
// call so the model can batch lookups instead of spending a tool round per name.

import type { GraphDB } from '@foreman/sf-game-data-graph';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { errorResult, notFoundResult, okResult, type ToolResult } from './toolResult.js';

/** Most names one batched call resolves; keeps a single result within a sensible size. */
const MAX_NAMES_PER_CALL = 25;

/** Appended to each description so the model actually batches. */
function batchHint(listArg: string): string {
  return ` Pass \`${listArg}\` to resolve several at once in one call — prefer this over separate calls.`;
}

/** One lookup tool, described as data (code standard 5). */
export interface LookupToolSpec {
  tool: string;
  title: string;
  description: string;
  /** The single-name argument; the list argument is this plus `s`. */
  argName: 'name' | 'item';
  /** Key for a single result; undefined spreads the result object into the response. */
  singularKey?: string;
  /** Key for the list of results in a batched response. */
  pluralKey: string;
  /** Noun in the single-name miss, e.g. `recipe` → `Not found: recipe 'X'`. */
  notFoundLabel: string;
  resolve(graph: GraphDB, name: string): Promise<object | undefined> | object | undefined;
}

export const LOOKUP_TOOLS: LookupToolSpec[] = [
  {
    tool: 'get_item',
    title: 'Get item',
    description:
      'Resolve an item by display name or class name. Returns item details including form (solid/liquid/gas) and sink points.',
    argName: 'name',
    singularKey: 'item',
    pluralKey: 'items',
    notFoundLabel: 'item',
    resolve: (graph, name) => graph.getItem(name),
  },
  {
    tool: 'get_recipe',
    title: 'Get recipe',
    description:
      'Resolve a recipe by display name or class name. Returns the full recipe: ingredients, products, machine and per-minute rates.',
    argName: 'name',
    singularKey: 'recipe',
    pluralKey: 'recipes',
    notFoundLabel: 'recipe',
    resolve: (graph, name) => graph.getRecipe(name),
  },
  {
    tool: 'get_building',
    title: 'Get building',
    description:
      'Resolve a building or machine by display name or class name. Returns power draw (constant, or max for variable-power machines), build cost, and — for power generators — MW output plus every fuel option with per-minute fuel, supplemental (water) and byproduct rates.',
    argName: 'name',
    singularKey: 'building',
    pluralKey: 'buildings',
    notFoundLabel: 'building',
    resolve: (graph, name) => graph.getBuilding(name),
  },
  {
    tool: 'get_schematic',
    title: 'Get schematic',
    description:
      'Resolve a schematic by display name or class name. Returns it with its full unlock list.',
    argName: 'name',
    singularKey: 'schematic',
    pluralKey: 'schematics',
    notFoundLabel: 'schematic',
    resolve: (graph, name) => graph.getSchematic(name),
  },
  {
    tool: 'recipes_for',
    title: 'Recipes for item',
    description:
      'All recipes that produce the named item, including alternates. Flags which recipe is the standard one.',
    argName: 'item',
    pluralKey: 'results',
    notFoundLabel: 'item',
    resolve: (graph, name) => graph.recipesFor(name),
  },
];

/** Resolves a list of names in request order, de-duplicated; misses are reported, not fatal. */
async function resolveMany(
  spec: LookupToolSpec,
  graph: GraphDB,
  names: string[],
): Promise<ToolResult> {
  const found: object[] = [];
  const notFound: string[] = [];
  for (const name of new Set(names)) {
    const result = await spec.resolve(graph, name);
    if (result === undefined) {
      notFound.push(name);
    } else {
      found.push(result);
    }
  }
  // notFound only when something missed: an empty list costs tokens on every call.
  const response = okResult(graph.version, {
    [spec.pluralKey]: found,
    ...(notFound.length > 0 ? { notFound } : {}),
  });
  return found.length === 0 ? { ...response, isError: true } : response;
}

async function resolveOne(spec: LookupToolSpec, graph: GraphDB, name: string): Promise<ToolResult> {
  const result = await spec.resolve(graph, name);
  if (result === undefined) {
    return notFoundResult(graph.version, `${spec.notFoundLabel} '${name}'`);
  }
  return okResult(
    graph.version,
    spec.singularKey === undefined ? result : { [spec.singularKey]: result },
  );
}

/** The handler for one spec: exactly one of the single and list arguments must be given. */
function lookupHandler(
  spec: LookupToolSpec,
  graph: GraphDB,
): (args: Record<string, unknown>) => Promise<ToolResult> {
  const listArg = `${spec.argName}s`;
  return async (args) => {
    const single = args[spec.argName];
    const list = args[listArg];
    if ((single === undefined) === (list === undefined)) {
      return errorResult(graph.version, `Pass either '${spec.argName}' or '${listArg}'.`);
    }
    if (typeof single === 'string') {
      return resolveOne(spec, graph, single);
    }
    return resolveMany(spec, graph, Array.isArray(list) ? list.map(String) : []);
  };
}

/** Registers every {@link LOOKUP_TOOLS} entry against the graph. */
export function registerLookupTools(server: McpServer, graph: GraphDB): void {
  for (const spec of LOOKUP_TOOLS) {
    server.registerTool(
      spec.tool,
      {
        title: spec.title,
        description: spec.description + batchHint(`${spec.argName}s`),
        inputSchema: {
          [spec.argName]: z.string().optional(),
          [`${spec.argName}s`]: z.array(z.string()).min(1).max(MAX_NAMES_PER_CALL).optional(),
        },
      },
      lookupHandler(spec, graph),
    );
  }
}
