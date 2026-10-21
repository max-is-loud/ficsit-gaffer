// Streamable HTTP transport for the unified MCP server: a stateless POST /mcp endpoint that
// registers every tool per request, plus a /health route reporting game-data and save identity.
// Server wiring lives in index.ts.

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type { GraphDB } from '@foreman/sf-game-data-graph';
import { lanAddresses } from './config.js';
import { logger } from './logger.js';
import type { SaveStoreRegistry } from './store/registry.js';

const MCP_ENDPOINT = '/mcp';

/** What the HTTP server needs: a tool registrar plus the graph and saves /health reports on. */
export interface HttpServerOptions {
  /** Registers every tool on a fresh server; called once per request (stateless mode). */
  registerTools: (server: McpServer) => void;
  graph: GraphDB;
  registry: SaveStoreRegistry;
  host: string;
  port: number;
  serverName: string;
  serverVersion: string;
}

/**
 * Starts the unified MCP server over Streamable HTTP in **stateless** mode: each
 * POST gets a fresh McpServer + transport, with every tool registered by
 * `registerTools` against the shared (already-loaded) data, so there is no
 * per-session bookkeeping. GET/DELETE are not supported.
 *
 * Security note: no authentication is applied. Do not expose this beyond a
 * trusted localhost/LAN without putting an auth layer in front of it.
 */
export async function startHttpServer(options: HttpServerOptions): Promise<void> {
  const { registerTools, graph, registry, host, port } = options;
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.post(MCP_ENDPOINT, async (req, res) => {
    const server = new McpServer({ name: options.serverName, version: options.serverVersion });
    registerTools(server);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('HTTP request handling failed:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: express.Request, res: express.Response): void => {
    res
      .status(405)
      .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  };
  app.get(MCP_ENDPOINT, methodNotAllowed);
  app.delete(MCP_ENDPOINT, methodNotAllowed);

  // The backend reads game-data version + build from here (to stamp work orders),
  // so /health reports the graph identity; the loaded save name is included too.
  app.get('/health', (_req, res) => {
    const store = registry.resolve();
    res.json({
      status: 'ok',
      version: graph.version,
      build: graph.build,
      saveName: store.saveName,
    });
  });

  await new Promise<void>((resolve) => {
    app.listen(port, host, () => {
      logger.info(`Listening on http://${host}:${port}${MCP_ENDPOINT} (health: /health)`);
      if (host === '0.0.0.0' || host === '::') {
        for (const address of lanAddresses()) {
          logger.info(`  reachable at http://${address}:${port}${MCP_ENDPOINT}`);
        }
      }
      logger.warn('HTTP transport has no authentication — keep it on a trusted network only.');
      resolve();
    });
  });
}
