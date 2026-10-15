// The server-local live-bridge tool: advertises it only to the bound playthrough, queries the
// receiver for Constructor observations and formats the result, with its status caveats, for the
// model.

import { z } from 'zod';

import {
  BridgeQueryError,
  type BridgeBinding,
  type BridgeClient,
  type ConstructorQuery,
  type ConstructorState,
} from '../bridge/types.js';
import { logger } from '../logger.js';
import type { ToolDefinition, ToolInvocationResult } from '../mcp/client.js';

/** The configured binding plus its receiver client, assembled once at startup. */
export interface LiveStateService {
  binding: BridgeBinding;
  client: BridgeClient;
}

export const LIVE_CONSTRUCTOR_TOOL = 'get_live_constructor_state';

/** True when `name` is the server-local live tool (reserved against MCP collisions). */
export function isLiveStateTool(name: string): boolean {
  return name === LIVE_CONSTRUCTOR_TOOL;
}

/** The trusted, route-authorised playthrough must be the one the operator bound. */
function linked(
  playthroughId: string,
  service: LiveStateService | undefined,
): service is LiveStateService {
  return service !== undefined && service.binding.playthroughId === playthroughId;
}

// Model-facing arguments are query options only: identities, addresses and
// credentials come from the trusted binding and cannot be supplied here.
const argumentsSchema = z
  .strictObject({
    includeLocations: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .refine((args) => args.cursor === undefined || args.includeLocations === true, {
    message: 'cursor requires includeLocations: true',
  });

const DEFINITION: ToolDefinition = {
  name: LIVE_CONSTRUCTOR_TOOL,
  description:
    'Live Constructor observations from the dedicated-server world linked to this playthrough, as last ' +
    'committed by the Foreman bridge receiver. Reports ONLY Constructor machines that exist (exact total) ' +
    'and their recorded world positions — not recipes, power, production rates or whether a machine is ' +
    'working, and not uploaded save data. Call it again for every claim about current Constructors. ' +
    'Count-only by default; set includeLocations for positions (paginated: default 50, max 100 per call; ' +
    'pass nextCursor to continue).',
  inputSchema: {
    type: 'object',
    properties: {
      includeLocations: {
        type: 'boolean',
        description: 'Return recorded positions as well as the exact total (default false).',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Locations per page (default 50, max 100). Ignored without includeLocations.',
      },
      cursor: {
        type: 'string',
        description:
          'nextCursor from the previous page of the same listing; needs includeLocations.',
      },
    },
    additionalProperties: false,
  },
};

/** The live tool, advertised only to the playthrough the operator bound. */
export function liveStateToolDefinitions(
  playthroughId: string,
  service?: LiveStateService,
): ToolDefinition[] {
  return linked(playthroughId, service) ? [DEFINITION] : [];
}

function error(text: string): ToolInvocationResult {
  return { text, isError: true };
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const metres = (cm: number): number => Math.round(cm) / 100;

function statusGuidance(state: ConstructorState): string {
  switch (state.reason) {
    case 'recent_sync':
      return 'Recently synchronised: the receiver accepted game updates less than 15 s before evaluatedAt. This is what the receiver knows, not a guarantee the game has not changed since.';
    case 'stale':
      return 'LAST-KNOWN state: no successful synchronisation for 15 s or more. Say so and give lastSyncAt.';
    case 'resynchronizing':
      return 'LAST-KNOWN state: the game is resending a full snapshot; this is the previous committed state. Say so and give lastSyncAt.';
    case 'receiver_restarted':
      return 'LAST-KNOWN state: the receiver restarted and has not yet re-synchronised with the game. Say so and give lastSyncAt.';
    case 'no_baseline':
      return 'UNAVAILABLE: no complete baseline has been received from the game yet. The Constructor count is unknown, not zero.';
  }
}

function countGuidance(state: ConstructorState, includeLocations: boolean): string {
  if (state.totalCount === null) {
    return 'Do not state a Constructor count.';
  }
  if (!includeLocations) {
    return `Exactly ${state.totalCount} Constructors exist in this state. No positions were requested.`;
  }
  if (state.hasMore) {
    return `Exactly ${state.totalCount} Constructors exist; this page lists ${state.returnedCount} of ${state.totalCount} positions. The location list is partial — say so, or fetch the next page with nextCursor.`;
  }
  return `Exactly ${state.totalCount} Constructors exist; the location list is complete for this state.`;
}

function format(state: ConstructorState, includeLocations: boolean): string {
  return JSON.stringify({
    source: 'live_bridge_receiver',
    status: state.status,
    reason: state.reason,
    guidance: `${statusGuidance(state)} ${countGuidance(state, includeLocations)}`,
    lastSyncAt: iso(state.lastSyncAt),
    evaluatedAt: iso(state.evaluatedAt),
    revision: state.revision,
    totalConstructors: state.totalCount ?? 'unknown',
    locationsIncluded: includeLocations,
    ...(includeLocations
      ? {
          returnedLocations: state.returnedCount,
          locationsComplete: !state.hasMore,
          nextCursor: state.nextCursor,
          coordinates:
            'Unreal world [X, Y, Z]: positionCm in centimetres as recorded; positionMetres = cm / 100 (the unit the game-data world tools take). Coordinates do not name a base or the pioneer’s location.',
          locations: state.locations.map((location) => ({
            entityId: location.entityId,
            positionCm: location.position,
            positionMetres: location.position.map(metres),
          })),
        }
      : {}),
  });
}

function failure(code: BridgeQueryError['code']): ToolInvocationResult {
  switch (code) {
    case 'state_changed':
      return error(
        'The live Constructor state changed between pages. Restart from the first page (omit cursor); never combine pages from different states.',
      );
    case 'invalid_query':
      return error(
        'The receiver rejected that query (usually a cursor it did not issue). Restart the listing without a cursor.',
      );
    case 'unavailable':
    case 'invalid_response':
      return error(
        'Live Constructor observations are unavailable right now (the receiver could not be reached or did not answer correctly). Do not state a current Constructor count from live data. Other tools and ordinary chat are unaffected; the pioneer can ask again later.',
      );
  }
}

/**
 * Runs the live tool for the route-authorised playthrough. Refuses (without
 * contacting the receiver) unless that playthrough is the bound one — even if the
 * model calls the tool unadvertised — and forwards only validated query options.
 */
export async function handleLiveStateTool(
  playthroughId: string,
  args: Record<string, unknown>,
  service?: LiveStateService,
): Promise<ToolInvocationResult> {
  if (!linked(playthroughId, service)) {
    return error('Live Constructor observations are not linked to this playthrough.');
  }
  const parsed = argumentsSchema.safeParse(args);
  if (!parsed.success) {
    return error(
      'Invalid arguments: only includeLocations (boolean), limit (integer 1–100) and cursor (string, with includeLocations: true) are accepted.',
    );
  }
  const query: ConstructorQuery = {};
  if (parsed.data.includeLocations !== undefined) {
    query.includeLocations = parsed.data.includeLocations;
  }
  if (parsed.data.limit !== undefined) {
    query.limit = parsed.data.limit;
  }
  if (parsed.data.cursor !== undefined) {
    query.cursor = parsed.data.cursor;
  }
  try {
    const state = await service.client.query(query);
    return { text: format(state, query.includeLocations === true), isError: false };
  } catch (caught) {
    if (caught instanceof BridgeQueryError) {
      logger.warn(
        `Live Constructor query failed for playthrough '${playthroughId}': ${caught.code} (${caught.detail})`,
      );
      return failure(caught.code);
    }
    // Only the error class is logged: an unexpected message could carry request detail.
    logger.error(
      `Unexpected live Constructor query failure for playthrough '${playthroughId}': ${caught instanceof Error ? caught.name : typeof caught}`,
    );
    return failure('unavailable');
  }
}
