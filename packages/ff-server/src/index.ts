#!/usr/bin/env node
// Server entry point: loads .env, wires the configuration, services and MCP client into AppDeps,
// starts the HTTP listener and shuts down gracefully on SIGTERM and SIGINT.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { buildApp } from './app.js';
import { createBridgeClient } from './bridge/client.js';
import { createAuth } from './auth.js';
import { resolveServerConfig } from './config.js';
import { disconnectDb, prisma } from './db.js';
import type { AppDeps } from './deps.js';
import { logger } from './logger.js';
import { loadSystemPromptTemplate } from './anthropic/systemPrompt.js';
import { createProvider } from './llm/factory.js';
import { SummaryService } from './llm/summary.js';
import { SaveSummaryCache } from './context/saveSummaryCache.js';
import { McpHttpClient } from './mcp/client.js';
import { ForemanService } from './services/foremanService.js';
import { PlaythroughService } from './services/playthroughService.js';
import { SaveService } from './services/saveService.js';
import { WorkOrderService } from './services/workOrderService.js';
import type { LiveStateService } from './tools/liveStateTools.js';

/** Loads `.env` from the package dir, the workspace root, and the cwd. */
function loadEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(here, '..', '.env') });
  dotenv.config({ path: path.resolve(here, '..', '..', '..', '.env') });
  dotenv.config();
}

async function main(): Promise<void> {
  loadEnv();
  const config = resolveServerConfig();

  const systemPromptTemplate = loadSystemPromptTemplate(config.systemPromptPath);
  logger.info(`Loaded system prompt from ${config.systemPromptPath}`);

  // One unified MCP server (sf-mcp) hosts both the game-data graph tools and the
  // save-game tools. The host injects the active playthrough's savePath into each
  // tool call; the save tools read the right save and the game-data tools ignore it.
  const mcp = new McpHttpClient(config.mcpUrl);

  // Attempt an eager connection so the game version is known and tool listing is
  // warm. The server may not be up yet — that is not fatal; tools reconnect on
  // demand the first time the foreman calls one.
  await mcp.connect().catch((error: unknown) => {
    logger.warn(
      `Could not reach MCP server at ${config.mcpUrl} yet — will retry on first use.`,
      error,
    );
  });

  const playthroughs = new PlaythroughService(prisma);
  const workOrders = new WorkOrderService(prisma);

  // Optional live Constructor observations for one operator-bound playthrough.
  // The binding carries a credential: log only the non-secret playthrough id.
  let liveState: LiveStateService | undefined;
  if (config.bridge !== undefined) {
    liveState = { binding: config.bridge, client: createBridgeClient(config.bridge) };
    const linked = await playthroughs.findOwnerId(config.bridge.playthroughId);
    if (linked === undefined || linked.userId === null) {
      logger.warn(
        `Live bridge playthrough '${config.bridge.playthroughId}' does not exist or has no owner; live observations stay unreachable until an owned playthrough with that id exists.`,
      );
    }
    logger.info(
      `Live Constructor bridge enabled for playthrough '${config.bridge.playthroughId}'.`,
    );
  }
  const deps: AppDeps = {
    config,
    auth: createAuth(prisma),
    foremen: new ForemanService(prisma),
    playthroughs,
    saves: new SaveService(prisma, mcp, config.saveDataDir, workOrders),
    saveSummaries: new SaveSummaryCache(mcp),
    workOrders,
    mcp,
    summary: new SummaryService(
      playthroughs,
      { historyWindow: config.historyWindow },
      createProvider,
    ),
    llmProviderFactory: createProvider,
    systemPromptTemplate,
    liveState,
  };

  // Migrate any pre-#76 single-file saves to the per-version layout (idempotent).
  await deps.saves.reconcileStorage().catch((error) => {
    logger.warn('Save storage reconcile failed (will retry next boot):', error);
  });

  const app = buildApp(deps);
  const server = app.listen(config.port, config.host, () => {
    logger.info(`Listening on http://${config.host}:${config.port} (health: /health)`);
    logger.info(
      `LLM: ${config.providerKind} (${config.model})${config.baseUrl !== undefined ? ` @ ${config.baseUrl}` : ''} | ` +
        `MCP: ${config.mcpUrl} | history window: ${config.historyWindow}`,
    );
    if (config.hostedApiKey === undefined) {
      logger.warn(
        `No hosted LLM key set — clients must supply their own via the '${config.clientKeyHeader}' header.`,
      );
    }
  });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}; shutting down.`);
    server.close(() => {
      void Promise.allSettled([mcp.close(), disconnectDb()]).then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error('Fatal error during startup:', error);
  process.exit(1);
});
