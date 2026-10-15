// Loads the merged sf-game-data.json (game data plus world locations) from SF_GAME_DATA_PATH or the
// bundled channel, degrading to empty data with a warning rather than throwing. Also re-exports the
// world-location types.

import fs from 'node:fs';
import path from 'node:path';

import { GAME_CHANNELS, bundledDataDir, expandHome, type GameChannel } from '../config.js';
import { emptyGameData } from '../parser/index.js';
import type { GameData } from '../parser/types.js';
import type { Biome, WorldLocations, WorldLocationsResolution } from './types.js';

export type {
  Biome,
  WorldLocations,
  WorldLocationsResolution,
  Collectible,
  ResourceNode,
  LootPickup,
  UnlockCost,
  CollectibleKind,
  ResourceNodeKind,
  Purity,
} from './types.js';

const DATASET_FILENAME = 'sf-game-data.json';
const BIOMES_FILENAME = 'biomes.json';
const DEFAULT_CHANNEL: GameChannel = 'stable';

/** An empty dataset, used when none is resolvable so callers never crash. */
export function emptyWorldLocations(version = 'unknown'): WorldLocations {
  return {
    gameVersion: version,
    build: 0,
    source: 'none',
    counts: {},
    collectibles: [],
    resourceNodes: [],
    lootPickups: [],
    biomes: [],
  };
}

/** Path to a channel's bundled dataset file (whether or not it exists). */
export function channelWorldLocationsPath(dataDir: string, channel: GameChannel): string {
  return path.join(dataDir, channel, DATASET_FILENAME);
}

interface DatasetPathResolution {
  path?: string;
  /** Set on a successful bundled-channel resolve ("Using bundled …") or a bad SF_GAME_DATA_PATH. */
  warning?: string;
}

/**
 * Resolves the merged dataset file (`sf-game-data.json`), shared by the game-data
 * and world loaders:
 *   1. SF_GAME_DATA_PATH — full path to a dataset file.
 *   2. Bundled channel under `<sf-game-data>/data/<channel>/`, selected by
 *      SATISFACTORY_GAME_CHANNEL (default `stable`, falling back to the other).
 * Returns no path when nothing resolves; the caller phrases the empty-data warning.
 */
function resolveDatasetPath(env: NodeJS.ProcessEnv, dataDir: string): DatasetPathResolution {
  const direct = env['SF_GAME_DATA_PATH']?.trim();
  if (direct !== undefined && direct !== '') {
    const resolved = expandHome(direct);
    if (fs.existsSync(resolved)) {
      return { path: resolved };
    }
    return { warning: `SF_GAME_DATA_PATH is set to '${resolved}' but no file exists there.` };
  }

  const rawChannel = env['SATISFACTORY_GAME_CHANNEL']?.trim().toLowerCase();
  const requested = GAME_CHANNELS.find((channel) => channel === rawChannel) ?? DEFAULT_CHANNEL;
  const preference: GameChannel[] = [requested, ...GAME_CHANNELS.filter((c) => c !== requested)];
  for (const channel of preference) {
    const candidate = channelWorldLocationsPath(dataDir, channel);
    if (fs.existsSync(candidate)) {
      const note = channel === requested ? '' : ` (requested '${requested}' has no dataset)`;
      return { path: candidate, warning: `Using bundled ${channel} dataset${note}.` };
    }
  }
  return {};
}

/** Reads and JSON-parses a dataset file; returns a warning instead of throwing. */
function readParsed(filePath: string): { parsed?: unknown; warning?: string } {
  try {
    return { parsed: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { warning: `Failed to read dataset at '${filePath}': ${detail}.` };
  }
}

/** Structural guard for a bundled biome record. */
function isBiome(v: unknown): v is Biome {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const c = v as Record<string, unknown>;
  return typeof c['name'] === 'string' && Array.isArray(c['polygons']);
}

/**
 * Loads the bundled, build-independent biome regions (`biomes.json`) — hand-traced
 * surface polygons (#239), kept separate from the extractor-produced dataset so a
 * re-extraction can't wipe them. Missing/malformed degrades to `[]`.
 */
function loadBiomes(dataDir: string): Biome[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, BIOMES_FILENAME), 'utf8')) as {
      biomes?: unknown;
    };
    // The bundled name may carry line breaks for the map label; collapse them so the canonical
    // name the game-data tools surface (describe_location, list_biomes, biome tags) stays clean.
    return Array.isArray(parsed.biomes)
      ? parsed.biomes
          .filter(isBiome)
          .map((b) => ({ ...b, name: b.name.replace(/\s*[\r\n]+\s*/g, ' ').trim() }))
      : [];
  } catch {
    return [];
  }
}

/** Joins defined warning fragments into one string (or undefined when none). */
function joinWarnings(...parts: (string | undefined)[]): string | undefined {
  const present = parts.filter((p): p is string => p !== undefined && p !== '');
  return present.length > 0 ? present.join(' ') : undefined;
}

/** Structural guard — confirms the two location arrays are present. */
function isWorldLocations(value: unknown): value is WorldLocations {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate['collectibles']) && Array.isArray(candidate['resourceNodes']);
}

/** Structural guard — confirms a parsed `gameData` object with the core maps. */
function isGameData(value: unknown): value is GameData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    typeof c['items'] === 'object' &&
    c['items'] !== null &&
    typeof c['recipes'] === 'object' &&
    c['recipes'] !== null &&
    typeof c['buildings'] === 'object' &&
    c['buildings'] !== null
  );
}

/** The combined dataset (parsed game data + world locations) from one merged file. */
export interface DatasetResolution {
  gameData: GameData;
  world: WorldLocations;
  path?: string;
  warning?: string;
}

/**
 * Loads the merged dataset (`sf-game-data.json`) once and returns both the parsed
 * `gameData` and the `world` locations. Both halves are produced by the offline
 * extractor (#160); the runtime no longer parses `en-US.json`. Never throws —
 * a missing/malformed file degrades each half to empty with a warning.
 */
export function loadDataset(
  env: NodeJS.ProcessEnv = process.env,
  dataDir: string = bundledDataDir(),
): DatasetResolution {
  const { path: filePath, warning: resolveWarning } = resolveDatasetPath(env, dataDir);
  if (filePath === undefined) {
    return {
      gameData: emptyGameData('unknown'),
      world: emptyWorldLocations(),
      warning: joinWarnings(
        resolveWarning,
        `No dataset available: set SF_GAME_DATA_PATH or add one under packages/sf-game-data/data/{${GAME_CHANNELS.join(',')}}/${DATASET_FILENAME}.`,
      ),
    };
  }

  const { parsed, warning: readWarning } = readParsed(filePath);
  if (parsed === undefined) {
    return {
      gameData: emptyGameData('unknown'),
      world: emptyWorldLocations(),
      path: filePath,
      warning: joinWarnings(resolveWarning, readWarning),
    };
  }

  const rawGameData = (parsed as Record<string, unknown>)['gameData'];
  const world = isWorldLocations(parsed)
    ? ({
        ...parsed,
        lootPickups: parsed.lootPickups ?? [],
        biomes: loadBiomes(dataDir),
      } as WorldLocations)
    : undefined;
  const gameData = isGameData(rawGameData) ? rawGameData : undefined;

  return {
    gameData: gameData ?? emptyGameData('unknown'),
    world: world ?? emptyWorldLocations(),
    path: filePath,
    warning: joinWarnings(
      resolveWarning,
      world === undefined ? `Dataset at '${filePath}' has no world locations.` : undefined,
      gameData === undefined ? `Dataset at '${filePath}' has no gameData.` : undefined,
    ),
  };
}

/**
 * Loads only the world-location half of the merged dataset. Warns about
 * world-specific problems (missing/malformed), not absent gameData.
 */
export function loadWorldLocations(
  env: NodeJS.ProcessEnv = process.env,
  dataDir: string = bundledDataDir(),
): WorldLocationsResolution {
  const { path: filePath, warning: resolveWarning } = resolveDatasetPath(env, dataDir);
  if (filePath === undefined) {
    return {
      world: emptyWorldLocations(),
      warning: joinWarnings(
        resolveWarning,
        `No world-location dataset available: set SF_GAME_DATA_PATH or add one under packages/sf-game-data/data/{${GAME_CHANNELS.join(',')}}/${DATASET_FILENAME}. World-location tools will return empty results.`,
      ),
    };
  }
  const { parsed, warning: readWarning } = readParsed(filePath);
  if (parsed === undefined) {
    return {
      world: emptyWorldLocations(),
      path: filePath,
      warning: joinWarnings(resolveWarning, `${readWarning} Using an empty dataset.`),
    };
  }
  if (!isWorldLocations(parsed)) {
    return {
      world: emptyWorldLocations(),
      path: filePath,
      warning: joinWarnings(
        resolveWarning,
        `World-location dataset at '${filePath}' is malformed; using an empty dataset.`,
      ),
    };
  }
  // Tolerate datasets predating lootPickups: default the array so callers needn't guard.
  // Biomes come from a separate bundled file, attached here (#239).
  const world: WorldLocations = {
    ...parsed,
    lootPickups: parsed.lootPickups ?? [],
    biomes: loadBiomes(dataDir),
  };
  return { world, path: filePath, warning: resolveWarning };
}

/** Resolution of the parsed game data half of the merged dataset. */
export interface GameDataResolution {
  gameData: GameData;
  path?: string;
  warning?: string;
}

/**
 * Loads the parsed `gameData` from the merged dataset (`sf-game-data.json`),
 * replacing the old runtime `en-US.json` parse. Warns about gameData-specific
 * problems (missing/malformed), not absent world locations.
 */
export function loadGameData(
  env: NodeJS.ProcessEnv = process.env,
  dataDir: string = bundledDataDir(),
): GameDataResolution {
  const { path: filePath, warning: resolveWarning } = resolveDatasetPath(env, dataDir);
  if (filePath === undefined) {
    return {
      gameData: emptyGameData('unknown'),
      warning: joinWarnings(
        resolveWarning,
        `No game data available: set SF_GAME_DATA_PATH or add a dataset under packages/sf-game-data/data/{${GAME_CHANNELS.join(',')}}/${DATASET_FILENAME}. Starting with empty game data.`,
      ),
    };
  }
  const { parsed, warning: readWarning } = readParsed(filePath);
  if (parsed === undefined) {
    return {
      gameData: emptyGameData('unknown'),
      path: filePath,
      warning: joinWarnings(resolveWarning, `${readWarning} Using empty game data.`),
    };
  }
  const rawGameData = (parsed as Record<string, unknown>)['gameData'];
  if (!isGameData(rawGameData)) {
    return {
      gameData: emptyGameData('unknown'),
      path: filePath,
      warning: joinWarnings(
        resolveWarning,
        `Dataset at '${filePath}' has no 'gameData'; using empty game data.`,
      ),
    };
  }
  return { gameData: rawGameData, path: filePath, warning: resolveWarning };
}
