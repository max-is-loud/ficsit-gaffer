// Resolves the server's runtime configuration from environment variables, and derives the
// per-request LLM runtime config from the server defaults and any client override.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveBridgeBinding } from './bridge/config.js';
import type { BridgeBinding } from './bridge/types.js';
import type { LlmRuntimeConfig, ProviderKind } from './llm/types.js';

/**
 * Backend runtime configuration, resolved from the environment. Every value has
 * a sensible default so the server starts for local development with no `.env`.
 * The LLM settings are provider-neutral; the legacy `ANTHROPIC_*` env vars are
 * still honoured when the provider is anthropic (back-compat).
 */
export interface ServerConfig {
  /** HTTP bind host. */
  host: string;
  /** HTTP port. */
  port: number;
  /** Default LLM provider the foreman runs on. */
  providerKind: ProviderKind;
  /** Default model the foreman runs on. */
  model: string;
  /** Upper bound on tokens per chat response. */
  maxTokens: number;
  /** Cheaper model used for background session summarisation. */
  summaryModel: string;
  /** Upper bound on tokens for a summary response. */
  summaryMaxTokens: number;
  /** Base URL override (OpenAI-compatible provider only). */
  baseUrl: string | undefined;
  /**
   * Server-held LLM API key (hosted tier). May be undefined — free-tier clients
   * supply their own key per request via {@link clientKeyHeader}.
   */
  hostedApiKey: string | undefined;
  /** Request header a free-tier client uses to pass its own LLM key. */
  clientKeyHeader: string;
  /** URL of the unified sf-mcp server's Streamable HTTP endpoint (game-data + save tools). */
  mcpUrl: string;
  /** Number of most-recent stored messages sent with each chat request. */
  historyWindow: number;
  /** Resolved absolute path to the foreman system prompt markdown file. */
  systemPromptPath: string;
  /**
   * Directory where uploaded playthrough `.sav` files are stored, one per
   * playthrough (`<saveDataDir>/<playthroughId>.sav`). In Docker this is a volume
   * shared with the save-game MCP so it can read the file by the same absolute
   * path the server injects.
   */
  saveDataDir: string;
  /**
   * Optional live-bridge binding (one receiver world → one playthrough). Holds a
   * credential: never include it in health/config responses, logs or prompts.
   */
  bridge: BridgeBinding | undefined;
}

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8724;
const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_SUMMARY_MAX_TOKENS = 512;
const DEFAULT_CLIENT_KEY_HEADER = 'x-anthropic-api-key';
const DEFAULT_MCP_URL = 'http://127.0.0.1:8723/mcp';
const DEFAULT_HISTORY_WINDOW = 20;

/** Default chat model per provider (overridable via env or the UI). */
export function defaultModelFor(provider: ProviderKind): string {
  return provider === 'openai' ? 'gpt-4.1' : 'claude-sonnet-4-6';
}

/** Default cheap summary model per provider. */
export function defaultSummaryModelFor(provider: ProviderKind): string {
  return provider === 'openai' ? 'gpt-4.1-mini' : 'claude-haiku-4-5';
}

function parseProvider(raw: string | undefined): ProviderKind | undefined {
  const value = raw?.trim().toLowerCase();
  if (value === 'openai' || value === 'anthropic') {
    return value;
  }
  return undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw?.trim() ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * Locates the foreman system prompt. Priority: SYSTEM_PROMPT_PATH env override,
 * then the copy in the server package (`packages/ff-server/SYSTEM_PROMPT.md`, also
 * what the Docker image copies in). A legacy repo-root location is kept as a
 * last-resort fallback. Returns the first that exists, else the package path so
 * the caller's read error is explicit.
 */
export function resolveSystemPromptPath(env: NodeJS.ProcessEnv = process.env): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/ or src/ → package root is one up; workspace root is three up.
  const packageRoot = path.resolve(here, '..');
  const candidates = [
    env['SYSTEM_PROMPT_PATH']?.trim(),
    path.join(packageRoot, 'SYSTEM_PROMPT.md'),
    path.resolve(packageRoot, '..', '..', 'SYSTEM_PROMPT.md'), // legacy repo-root fallback
  ].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1] ?? path.join(packageRoot, 'SYSTEM_PROMPT.md');
}

/**
 * Resolves the saves directory. An explicit `SAVE_DATA_DIR` wins; otherwise it
 * sits next to a `file:` SQLite database (same data volume, survives restarts),
 * mirroring the auth-secret placement, falling back to `./saves`.
 */
export function resolveSaveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['SAVE_DATA_DIR']?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return path.resolve(explicit);
  }
  const url = env['DATABASE_URL']?.trim() ?? '';
  if (url.startsWith('file:')) {
    const dbPath = url.slice('file:'.length);
    return path.join(path.dirname(path.resolve(dbPath)), 'saves');
  }
  return path.resolve(process.cwd(), 'saves');
}

/** Resolves all backend configuration from the environment. */
export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const providerKind = parseProvider(env['LLM_PROVIDER']) ?? 'anthropic';
  const hostedApiKey = firstNonEmpty(
    env['LLM_API_KEY'],
    providerKind === 'anthropic' ? env['ANTHROPIC_API_KEY'] : env['OPENAI_API_KEY'],
  );
  return {
    host: env['HOST']?.trim() || DEFAULT_HOST,
    port: parsePositiveInt(env['PORT'], DEFAULT_PORT),
    providerKind,
    model: firstNonEmpty(env['LLM_MODEL'], env['ANTHROPIC_MODEL']) ?? defaultModelFor(providerKind),
    maxTokens: parsePositiveInt(
      env['LLM_MAX_TOKENS'],
      parsePositiveInt(env['ANTHROPIC_MAX_TOKENS'], DEFAULT_MAX_TOKENS),
    ),
    summaryModel:
      firstNonEmpty(env['LLM_SUMMARY_MODEL'], env['ANTHROPIC_SUMMARY_MODEL']) ??
      defaultSummaryModelFor(providerKind),
    summaryMaxTokens: parsePositiveInt(
      env['LLM_SUMMARY_MAX_TOKENS'],
      parsePositiveInt(env['ANTHROPIC_SUMMARY_MAX_TOKENS'], DEFAULT_SUMMARY_MAX_TOKENS),
    ),
    baseUrl: firstNonEmpty(env['LLM_BASE_URL']),
    hostedApiKey,
    clientKeyHeader: (env['CLIENT_KEY_HEADER']?.trim() || DEFAULT_CLIENT_KEY_HEADER).toLowerCase(),
    mcpUrl: env['MCP_URL']?.trim() || DEFAULT_MCP_URL,
    historyWindow: parsePositiveInt(env['HISTORY_WINDOW'], DEFAULT_HISTORY_WINDOW),
    systemPromptPath: resolveSystemPromptPath(env),
    saveDataDir: resolveSaveDataDir(env),
    bridge: resolveBridgeBinding(env),
  };
}

/** A per-request client override of the provider/model/base URL. */
export interface LlmOverride {
  provider?: string;
  model?: string;
  baseUrl?: string;
}

/** The runtime config using the server's own defaults + a resolved key. */
export function serverLlmConfig(config: ServerConfig, apiKey: string): LlmRuntimeConfig {
  return {
    providerKind: config.providerKind,
    model: config.model,
    summaryModel: config.summaryModel,
    maxTokens: config.maxTokens,
    summaryMaxTokens: config.summaryMaxTokens,
    apiKey,
    baseUrl: config.baseUrl,
  };
}

/**
 * The runtime config for a request that supplied its own key, applying the
 * client's provider/model/base-URL override on top of the server defaults. When
 * the client switches provider, models fall back to that provider's defaults so
 * a mismatched server model is never used.
 */
export function clientLlmConfig(
  config: ServerConfig,
  override: LlmOverride,
  apiKey: string,
): LlmRuntimeConfig {
  const providerKind = parseProvider(override.provider) ?? config.providerKind;
  const sameAsServer = providerKind === config.providerKind;
  const model =
    firstNonEmpty(override.model) ?? (sameAsServer ? config.model : defaultModelFor(providerKind));
  const summaryModel = sameAsServer ? config.summaryModel : defaultSummaryModelFor(providerKind);
  const baseUrl = firstNonEmpty(override.baseUrl) ?? (sameAsServer ? config.baseUrl : undefined);
  return {
    providerKind,
    model,
    summaryModel,
    maxTokens: config.maxTokens,
    summaryMaxTokens: config.summaryMaxTokens,
    apiKey,
    baseUrl,
  };
}
