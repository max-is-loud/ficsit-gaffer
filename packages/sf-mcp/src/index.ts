#!/usr/bin/env node
// Entry point for the unified sf-mcp server: loads the game-data dataset and graph and the save
// store registry, then serves the game-data and save tools over stdio, or over HTTP via http.ts
// when MCP_TRANSPORT=http.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadDataset, WorldQueries } from '@foreman/sf-game-data';
import type { GameData } from '@foreman/sf-game-data';
import { initGraph } from '@foreman/sf-game-data-graph';

import { resolveSavePath, resolveServerConfig, type ServerConfig } from './config.js';
import { startHttpServer } from './http.js';
import { logger } from './logger.js';
import { SaveStoreRegistry } from './store/registry.js';
import { SaveStore } from './store/saveStore.js';
import { registerGameDataTools } from './tools/gameData.js';
import { registerSaveTools } from './tools/save.js';

const SERVER_NAME = 'foreman-sf-mcp';
const SERVER_VERSION = '0.1.0';

/** Loads `.env` from the package dir and the workspace root (cwd-independent). */
function loadEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/ or src/ → package root is one up; workspace root is three up.
  dotenv.config({ path: path.resolve(here, '..', '.env') });
  dotenv.config({ path: path.resolve(here, '..', '..', '..', '.env') });
  dotenv.config(); // also honour a .env in the current working directory
}

/** Echoes what game data was loaded and from where, so startup is self-explanatory. */
function logStartupSummary(gameData: GameData, datasetPath: string | undefined): void {
  logger.info(`Game data source: ${datasetPath ?? '(none — running with an empty dataset)'}`);
  logger.info(
    `Game version: ${gameData.version} | ` +
      `items=${count(gameData.items)} resources=${count(gameData.resources)} ` +
      `recipes=${count(gameData.recipes)} buildings=${count(gameData.buildings)} ` +
      `schematics=${count(gameData.schematics)}`,
  );
}

function count(record: Record<string, unknown>): number {
  return Object.keys(record).length;
}

/** Builds the per-save store registry from the save config (legacy default + LRU). */
function buildRegistry(config: ServerConfig): SaveStoreRegistry {
  const { path: savePath, warning } = resolveSavePath();
  if (warning !== undefined) {
    logger.warn(warning);
  }
  const defaultStore = new SaveStore(savePath);
  logger.info(`Default save source: ${savePath ?? '(none — running with an empty state)'}`);
  if (config.saveDataDir !== undefined) {
    logger.info(`Per-playthrough saves served from: ${config.saveDataDir}`);
  }
  return new SaveStoreRegistry(defaultStore, config.saveDataDir);
}

async function main(): Promise<void> {
  loadEnv();

  // Game-data half: load the merged dataset (#161) — pre-extracted gameData +
  // world locations from one sf-game-data.json — then build the in-memory
  // production graph and the spatial query layer from it.
  const { gameData, world, path: datasetPath, warning: datasetWarning } = loadDataset();
  if (datasetWarning !== undefined) {
    logger.warn(datasetWarning);
  }
  const graph = await initGraph(gameData);
  logStartupSummary(gameData, datasetPath);
  logger.info(
    `World locations: collectibles=${world.collectibles.length} resourceNodes=${world.resourceNodes.length}`,
  );
  const worldQueries = new WorldQueries(world, gameData);

  // Save-game half: resolve the default save + the per-playthrough save store
  // registry (the host injects each call's savePath; the registry LRU-caches them).
  const config = resolveServerConfig();
  const registry = buildRegistry(config);

  if (config.transport === 'http') {
    await startHttpServer(
      graph,
      worldQueries,
      registry,
      config.host,
      config.port,
      SERVER_NAME,
      SERVER_VERSION,
    );
    return;
  }

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerGameDataTools(server, graph, worldQueries);
  registerSaveTools(server, registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Transport: stdio (no network port — the client talks over stdin/stdout).');
}

main().catch((error: unknown) => {
  logger.error('Fatal error during startup:', error);
  process.exit(1);
});
