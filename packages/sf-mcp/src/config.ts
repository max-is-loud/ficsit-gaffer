// Environment-driven configuration for the sf-mcp server: transport (stdio or HTTP), bind address
// and saves directory, plus resolving SAVE_FILE_PATH; game-data dataset resolution lives in
// @foreman/sf-game-data.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Server transport + save-source configuration for the unified `sf-mcp` server
 * (game-data graph tools + save-game tools on one port). Bundled game-data /
 * dataset resolution lives in `@foreman/sf-game-data` (see `loadDataset` /
 * `resolveDatasetPath`); this file owns the network-transport half and the
 * save-file resolution.
 */

/** Which transport the server should expose. */
export type TransportKind = 'stdio' | 'http';

export interface ServerConfig {
  transport: TransportKind;
  /** HTTP bind host (only meaningful when transport is 'http'). */
  host: string;
  /** HTTP port (only meaningful when transport is 'http'). */
  port: number;
  /**
   * Directory that host-injected `savePath` arguments must live under (the
   * shared saves volume). Tool calls may only read saves inside it; undefined
   * disables per-request saves (only `SAVE_FILE_PATH` is served).
   */
  saveDataDir: string | undefined;
}

const DEFAULT_HTTP_HOST = '0.0.0.0';
const DEFAULT_HTTP_PORT = 8723;

/**
 * Resolves transport configuration from the environment. Defaults to stdio
 * (what Claude Desktop spawns). Set `MCP_TRANSPORT=http` to listen on a network
 * port instead; tune it with `MCP_HTTP_HOST` and `MCP_HTTP_PORT`.
 */
export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const transport: TransportKind =
    env['MCP_TRANSPORT']?.trim().toLowerCase() === 'http' ? 'http' : 'stdio';
  const host = env['MCP_HTTP_HOST']?.trim() || DEFAULT_HTTP_HOST;
  const parsedPort = Number.parseInt(env['MCP_HTTP_PORT']?.trim() ?? '', 10);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_HTTP_PORT;
  const rawSaveDir = env['SAVE_DATA_DIR']?.trim();
  const saveDataDir =
    rawSaveDir !== undefined && rawSaveDir.length > 0
      ? path.resolve(expandHome(rawSaveDir))
      : undefined;
  return { transport, host, port, saveDataDir };
}

/** Non-internal IPv4 addresses of this machine, for echoing a reachable URL. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        out.push(net.address);
      }
    }
  }
  return out;
}

/** Expands a leading `~` to the user's home directory. */
export function expandHome(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

/** Result of resolving the save-file path from the environment. */
export interface SavePathResolution {
  path?: string;
  warning?: string;
}

/**
 * Resolves the save file to read from `SAVE_FILE_PATH` (a leading `~` is
 * expanded). If the variable is unset or the file is missing, returns a warning
 * and no path — the server then starts with no save loaded rather than crashing.
 */
export function resolveSavePath(env: NodeJS.ProcessEnv = process.env): SavePathResolution {
  const raw = env['SAVE_FILE_PATH']?.trim();
  if (raw === undefined || raw === '') {
    return {
      warning:
        'SAVE_FILE_PATH is not set — starting with no save loaded. Tools will return empty results.',
    };
  }
  const resolved = expandHome(raw);
  if (!fs.existsSync(resolved)) {
    return { warning: `SAVE_FILE_PATH is set to '${resolved}' but no file exists there.` };
  }
  return { path: resolved };
}
