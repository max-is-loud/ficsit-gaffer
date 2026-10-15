// An McpGateway that merges the tools of several MCP servers behind one interface and routes each
// tool call to the server that owns it.

import { logger } from '../logger.js';
import type {
  McpGateway,
  ToolCallContext,
  ToolDefinition,
  ToolInvocationResult,
} from './client.js';

/**
 * Fans the foreman's tool calls out across several MCP servers (e.g. game-data
 * + save-game), presenting them as one gateway. `gameVersion` comes from the
 * primary (game-data) server. `listTools` merges every server's tools — the
 * primary wins on a name clash — and records which server owns each name so
 * `callTool` can route to it.
 *
 * A server that is unreachable contributes no tools and is simply skipped; the
 * foreman degrades gracefully (e.g. no save loaded → no player-relative
 * opportunities) rather than failing the whole turn.
 */
export class McpAggregateGateway implements McpGateway {
  private routes = new Map<string, McpGateway>();

  public constructor(
    private readonly primary: McpGateway,
    private readonly secondaries: McpGateway[],
  ) {}

  public get gameVersion(): string {
    return this.primary.gameVersion;
  }

  public get gameBuild(): number | undefined {
    return this.primary.gameBuild;
  }

  public async listTools(): Promise<ToolDefinition[]> {
    const gateways = [this.primary, ...this.secondaries];
    const listings = await Promise.all(
      gateways.map(async (gateway) => {
        try {
          return { gateway, tools: await gateway.listTools() };
        } catch (error) {
          logger.warn('An MCP server could not be listed; skipping its tools.', error);
          return { gateway, tools: [] as ToolDefinition[] };
        }
      }),
    );

    const routes = new Map<string, McpGateway>();
    const merged: ToolDefinition[] = [];
    for (const { gateway, tools } of listings) {
      for (const tool of tools) {
        if (routes.has(tool.name)) {
          continue; // first server wins on a name clash (primary listed first)
        }
        routes.set(tool.name, gateway);
        merged.push(tool);
      }
    }
    this.routes = routes;
    return merged;
  }

  public async callTool(
    name: string,
    args: Record<string, unknown>,
    context?: ToolCallContext,
  ): Promise<ToolInvocationResult> {
    // Routes are populated by listTools, which the chat loop calls each turn
    // before dispatching tool calls. Refresh lazily if we have not listed yet.
    if (this.routes.size === 0) {
      await this.listTools();
    }
    const gateway = this.routes.get(name) ?? this.primary;
    // Save-game tools live on a secondary server. Inject the host's savePath so
    // the call reads the active playthrough's save, overriding any model-supplied
    // value. The primary (game-data) server never gets a savePath.
    const routedArgs =
      gateway !== this.primary && context?.savePath !== undefined
        ? { ...args, savePath: context.savePath }
        : args;
    return gateway.callTool(name, routedArgs, context);
  }
}
