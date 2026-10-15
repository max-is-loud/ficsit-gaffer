// The MCP gateway interface the chat loop depends on, and its Streamable HTTP implementation that
// connects to sf-mcp, lists and calls tools, and reads the game data version.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { logger } from '../logger.js';

/** A tool advertised by the MCP server, in the shape we hand to Anthropic. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input (Anthropic `input_schema`). */
  inputSchema: Record<string, unknown>;
}

/** The flattened result of invoking an MCP tool. */
export interface ToolInvocationResult {
  /** Tool output text (MCP text content blocks, concatenated). */
  text: string;
  isError: boolean;
}

/**
 * Host-supplied context for a tool call. The save-game MCP is multi-save aware;
 * the host injects the active playthrough's `savePath` so save-game tools read
 * the right save (the model never supplies it). Ignored by single-save servers.
 */
export interface ToolCallContext {
  savePath?: string;
}

/**
 * The subset of MCP behaviour the chat loop depends on. Defining it as an
 * interface lets tests substitute a fake gateway without a live MCP server.
 */
export interface McpGateway {
  /** Game data version reported by the MCP server (for stamping work orders). */
  readonly gameVersion: string;
  /**
   * Satisfactory build/CL number the loaded game data was extracted from, if the
   * server reported it. Comparable to a save's `buildVersion`. Undefined when
   * unknown (older data, /health unavailable, or a test fake).
   */
  readonly gameBuild?: number;
  listTools(): Promise<ToolDefinition[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    context?: ToolCallContext,
  ): Promise<ToolInvocationResult>;
}

interface RawToolContent {
  type: string;
  text?: string;
}

/**
 * Connects to the Phase 1 MCP server over Streamable HTTP and exposes its tools
 * to the foreman. The game data version is read once from the server's /health
 * endpoint (derived from the MCP URL) so newly-issued work orders can be tagged
 * with the version they were built for.
 */
export class McpHttpClient implements McpGateway {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;
  private cachedTools: ToolDefinition[] | undefined;
  private version = 'unknown';
  private build: number | undefined;

  public constructor(private readonly mcpUrl: string) {}

  public get gameVersion(): string {
    return this.version;
  }

  public get gameBuild(): number | undefined {
    return this.build;
  }

  /** Establishes the MCP session and reads the game data version. Idempotent. */
  public async connect(): Promise<void> {
    await this.ensureClient();
  }

  /**
   * Returns a connected client, opening one if needed. Concurrent callers share
   * a single in-flight connect. A `StreamableHTTPClientTransport` cannot be
   * restarted once started, so each attempt builds a FRESH transport+client and
   * a failed attempt is discarded — letting a later call reconnect cleanly
   * (e.g. after the MCP server finishes booting).
   */
  private async ensureClient(): Promise<Client> {
    if (this.client !== undefined) {
      return this.client;
    }
    if (this.connecting === undefined) {
      this.connecting = this.openClient().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  private async openClient(): Promise<Client> {
    const client = new Client({ name: 'foreman-ff-server', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl));
    try {
      await client.connect(transport);
    } catch (error) {
      // Discard the started-but-unconnected transport so the next attempt is clean.
      await transport.close().catch(() => undefined);
      throw error;
    }
    this.client = client;
    const health = await this.fetchHealth();
    this.version = health.version;
    this.build = health.build;
    logger.info(`Connected to MCP server at ${this.mcpUrl} (game version ${this.version})`);
    return client;
  }

  /** Drops the current client so the next call reconnects with a fresh transport. */
  private reset(): void {
    const client = this.client;
    this.client = undefined;
    if (client !== undefined) {
      void client.close().catch(() => undefined);
    }
  }

  public async listTools(): Promise<ToolDefinition[]> {
    if (this.cachedTools !== undefined) {
      return this.cachedTools;
    }
    const client = await this.ensureClient();
    try {
      const response = await client.listTools();
      this.cachedTools = response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: (tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
      }));
      return this.cachedTools;
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  public async callTool(
    name: string,
    args: Record<string, unknown>,
    context?: ToolCallContext,
  ): Promise<ToolInvocationResult> {
    // The unified sf-mcp server hosts both game-data and save-game tools. Inject
    // the host's active-playthrough savePath when present so save tools read the
    // right save (the model never supplies it); game-data tools ignore the extra
    // arg (their zod schemas strip unknown keys). describe_save passes its own
    // savePath in args directly and supplies no context, so it is unaffected.
    const effectiveArgs =
      context?.savePath !== undefined ? { ...args, savePath: context.savePath } : args;
    try {
      const client = await this.ensureClient();
      const result = await client.callTool({ name, arguments: effectiveArgs });
      const content = Array.isArray(result.content) ? (result.content as RawToolContent[]) : [];
      const text = content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
      return { text: text.length > 0 ? text : '(no output)', isError: result.isError === true };
    } catch (error) {
      logger.error(`MCP tool '${name}' failed:`, error);
      // A transport/protocol failure poisons the connection — reconnect next time.
      this.reset();
      return { text: `Tool '${name}' failed: ${describeError(error)}`, isError: true };
    }
  }

  public async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client !== undefined) {
      await client.close();
    }
  }

  /** Reads version + build from the MCP server's HTTP /health sibling endpoint. */
  private async fetchHealth(): Promise<{ version: string; build: number | undefined }> {
    try {
      const healthUrl = new URL(this.mcpUrl);
      healthUrl.pathname = healthUrl.pathname.replace(/\/mcp\/?$/, '/health');
      const response = await fetch(healthUrl);
      if (!response.ok) {
        return { version: 'unknown', build: undefined };
      }
      const body = (await response.json()) as { version?: unknown; build?: unknown };
      return {
        version: typeof body.version === 'string' ? body.version : 'unknown',
        build: typeof body.build === 'number' ? body.build : undefined,
      };
    } catch (error) {
      logger.warn('Could not read game data version from MCP /health:', describeError(error));
      return { version: 'unknown', build: undefined };
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
