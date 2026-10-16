// Registry of the server-local live-bridge tools: advertises them only to the
// playthrough the operator bound, refuses any other playthrough before the
// receiver is contacted, and dispatches by tool name. Each tool lives in
// tools/live/; adding one is an entry in LIVE_TOOLS.

import type { ToolDefinition, ToolInvocationResult } from '../mcp/client.js';
import { buildablesTool } from './live/buildablesTool.js';
import { liveError } from './live/freshness.js';
import type { LiveStateService, LiveTool } from './live/service.js';

export { LIVE_BUILDABLES_TOOL } from './live/buildablesTool.js';
export type { LiveStateService, LiveTool } from './live/service.js';

export const LIVE_TOOLS: readonly LiveTool[] = [buildablesTool];

/** True when `name` is a server-local live tool (reserved against MCP collisions). */
export function isLiveStateTool(name: string): boolean {
  return LIVE_TOOLS.some((tool) => tool.definition.name === name);
}

/** The trusted, route-authorised playthrough must be the one the operator bound. */
function linked(
  playthroughId: string,
  service: LiveStateService | undefined,
): service is LiveStateService {
  return service !== undefined && service.binding.playthroughId === playthroughId;
}

/** The live tools, advertised only to the playthrough the operator bound. */
export function liveStateToolDefinitions(
  playthroughId: string,
  service?: LiveStateService,
): ToolDefinition[] {
  return linked(playthroughId, service) ? LIVE_TOOLS.map((tool) => tool.definition) : [];
}

/**
 * Runs a live tool for the route-authorised playthrough. Refuses (without
 * contacting the receiver) unless that playthrough is the bound one — even if
 * the model calls the tool unadvertised.
 */
export async function handleLiveStateTool(
  name: string,
  playthroughId: string,
  args: Record<string, unknown>,
  service?: LiveStateService,
): Promise<ToolInvocationResult> {
  const tool = LIVE_TOOLS.find((candidate) => candidate.definition.name === name);
  if (tool === undefined || !linked(playthroughId, service)) {
    return liveError('Live factory observations are not linked to this playthrough.');
  }
  return tool.handle(args, service);
}
