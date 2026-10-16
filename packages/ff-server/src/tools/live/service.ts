// The live-bridge service handed to every live tool: the operator's binding,
// its receiver client and game-data names. Assembled once at start-up.

import type { GameNames } from '../../bridge/gameNames.js';
import type { BridgeBinding, BridgeClient } from '../../bridge/types.js';
import type { ToolDefinition, ToolInvocationResult } from '../../mcp/client.js';

export interface LiveStateService {
  binding: BridgeBinding;
  client: BridgeClient;
  names: GameNames;
}

/** One server-local live tool. New live tools are entries in LIVE_TOOLS, not new branches. */
export interface LiveTool {
  definition: ToolDefinition;
  handle(args: Record<string, unknown>, service: LiveStateService): Promise<ToolInvocationResult>;
}
