// get_live_buildables: live production buildings and their configuration from
// the linked world. The model passes only query options in the Pioneer's terms
// (building and recipe names, metres); names resolve exactly through game data
// before anything is sent, and identities and credentials never come from the
// model.

import { z } from 'zod';

import type { NameResolution } from '../../bridge/gameNames.js';
import { BridgeQueryError, type BuildablesQuery } from '../../bridge/types.js';
import { logger } from '../../logger.js';
import type { ToolDefinition, ToolInvocationResult } from '../../mcp/client.js';
import { formatBuildables } from './buildablesFormat.js';
import { failure, liveError } from './freshness.js';
import type { LiveStateService, LiveTool } from './service.js';

export const LIVE_BUILDABLES_TOOL = 'get_live_buildables';

const CATEGORIES = ['manufacturer', 'extractor', 'generator', 'storage'] as const;
const GROUPS = ['category', 'building', 'recipe'] as const;
// The receiver groups by class name; the model speaks of buildings.
const GROUP_KEYS = { category: 'category', building: 'class', recipe: 'recipe' } as const;
const CM_PER_METRE = 100;

const argumentsSchema = z
  .strictObject({
    category: z.enum(CATEGORIES).optional(),
    building: z.string().min(1).max(128).optional(),
    recipe: z.string().min(1).max(128).optional(),
    groupBy: z.enum(GROUPS).optional(),
    nearestTo: z.strictObject({ x: z.number(), y: z.number(), z: z.number() }).optional(),
    includeRows: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .refine(
    (args) =>
      args.cursor === undefined || (args.includeRows === true && args.nearestTo === undefined),
    { message: 'cursor requires includeRows: true and no nearestTo' },
  );
type Arguments = z.infer<typeof argumentsSchema>;

const DEFINITION: ToolDefinition = {
  name: LIVE_BUILDABLES_TOOL,
  description:
    'Live production buildings (manufacturers, extractors, generators, storage) in the dedicated-server world linked to this playthrough, as last committed by the bridge receiver, with each one’s configuration: recipe, clock speed, Power Shards, Somersloops, paused; extractor resource and purity; generator fuel. Configuration only — NOT whether a machine is running, power or production rates — and not uploaded save data. Call it again for every claim about current buildings. Returns exact totals by default; filter by category, building or recipe name, group counts with groupBy, set includeRows for rows (paginated: default 50, max 100; pass nextCursor to continue), or set nearestTo (metres) for the nearest rows first.',
  inputSchema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: [...CATEGORIES] },
      building: { type: 'string', description: 'Building display name, e.g. "Smelter" (exact).' },
      recipe: {
        type: 'string',
        description:
          'Recipe display name, e.g. "Iron Ingot" or "Alternate: Pure Iron Ingot" (exact).',
      },
      groupBy: { type: 'string', enum: [...GROUPS], description: 'Return counts per group.' },
      nearestTo: {
        type: 'object',
        description: 'World location in metres; rows come back nearest first, with distanceMetres.',
        properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
        required: ['x', 'y', 'z'],
        additionalProperties: false,
      },
      includeRows: {
        type: 'boolean',
        description: 'Return rows as well as totals (default false).',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Rows per page (default 50).',
      },
      cursor: {
        type: 'string',
        description: 'nextCursor from the previous page of the same listing (not with nearestTo).',
      },
    },
    additionalProperties: false,
  },
};

function unresolved(kind: string, name: string, resolution: NameResolution): string | undefined {
  if (resolution.ok) {
    return undefined;
  }
  const list = resolution.candidates.join('; ');
  return resolution.reason === 'ambiguous'
    ? `"${name}" matches more than one ${kind}: ${list}. Ask which one, or use the exact name.`
    : `No ${kind} is named "${name}".${list === '' ? '' : ` Did you mean: ${list}?`}`;
}

/** Builds the receiver query, or explains which name could not be resolved. */
function toQuery(args: Arguments, service: LiveStateService): BuildablesQuery | string {
  const filter: NonNullable<BuildablesQuery['filter']> = {};
  if (args.category !== undefined) {
    filter.category = args.category;
  }
  for (const [kind, name, key, resolve] of [
    ['building', args.building, 'className', service.names.resolveBuilding],
    ['recipe', args.recipe, 'recipeName', service.names.resolveRecipe],
  ] as const) {
    if (name !== undefined) {
      const resolution = resolve(name);
      const problem = unresolved(kind, name, resolution);
      if (problem !== undefined || !resolution.ok) {
        return problem ?? '';
      }
      filter[key] = resolution.className;
    }
  }
  const { nearestTo: at, groupBy, includeRows, limit, cursor } = args;
  return {
    filter,
    ...(groupBy !== undefined ? { groupBy: GROUP_KEYS[groupBy] } : {}),
    ...(at !== undefined
      ? {
          from: [at.x, at.y, at.z].map((metre) => metre * CM_PER_METRE) as [number, number, number],
        }
      : {}),
    ...(includeRows !== undefined ? { includeRows } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  };
}

async function handle(
  args: Record<string, unknown>,
  service: LiveStateService,
): Promise<ToolInvocationResult> {
  const parsed = argumentsSchema.safeParse(args);
  if (!parsed.success) {
    return liveError(
      'Invalid arguments: use only category, building, recipe, groupBy (category|building|recipe), nearestTo {x,y,z} in metres, includeRows, limit (1–100) and cursor (with includeRows: true, not with nearestTo).',
    );
  }
  const query = toQuery(parsed.data, service);
  if (typeof query === 'string') {
    return liveError(query);
  }
  try {
    const state = await service.client.query(query);
    const shape = {
      includeRows: query.includeRows === true,
      ...(query.groupBy ? { groupBy: query.groupBy } : {}),
    };
    return { text: formatBuildables(state, shape, service.names), isError: false };
  } catch (caught) {
    if (caught instanceof BridgeQueryError) {
      logger.warn(`Live buildables query failed: ${caught.code} (${caught.detail})`);
      return failure(caught.code);
    }
    // Only the error class is logged: an unexpected message could carry request detail.
    logger.error(
      `Unexpected live buildables query failure: ${caught instanceof Error ? caught.name : typeof caught}`,
    );
    return failure('unavailable');
  }
}

export const buildablesTool: LiveTool = { definition: DEFINITION, handle };
