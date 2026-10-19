// Builds the game-data index the save tools join against (display names, recipes, buildings,
// schematics, fluid classes, Project Assembly phases) from the merged dataset, and the single
// class-name-to-display-name resolution rule.

import {
  loadGameData,
  type Building,
  type ProjectAssemblyPhase,
  type Recipe,
  type Schematic,
} from '@foreman/sf-game-data';
import { humaniseClassName } from '@foreman/sf-present';

import { logger } from './logger.js';

/**
 * The slice of parsed game data the save MCP joins against: a `className →
 * displayName` map (for upgrading inventory/recipe/building names from the
 * humanised fallback), plus recipes and buildings keyed by class (for theoretical
 * production rates, build power and extraction rates). Empty when no game data is
 * available.
 */
export interface GameDataIndex {
  displayNames: Map<string, string>;
  recipes: Record<string, Recipe>;
  buildings: Record<string, Building>;
  /** Class names of fluid (liquid/gas) items + resources — seeds the head-lift gate. Optional for test literals. */
  fluids?: Set<string>;
  /** Project Assembly / Space Elevator phase deliverable costs (#172). Optional for test literals / pre-#172 datasets. */
  projectAssemblyPhases?: ProjectAssemblyPhase[];
  /** Schematics keyed by class, for what each unlocks. Optional for test literals. */
  schematics?: Record<string, Schematic>;
}

/**
 * Loads the game-data index from `@foreman/sf-game-data`'s merged dataset —
 * pre-extracted `gameData` in the bundled `sf-game-data.json` (or a custom file via
 * SF_GAME_DATA_PATH), no longer a runtime `en-US.json` parse (#161). Best-effort:
 * `loadGameData` never throws and degrades to empty game data, so this returns an
 * empty index (humanised fallback, no rates) when no data is available.
 *
 * Note: MAM/milestone *schematics* are not in the parsed game data, so those keep
 * the humanised fallback.
 */
export function loadGameDataIndex(): GameDataIndex {
  const { gameData, warning } = loadGameData();
  if (warning !== undefined) {
    logger.warn(warning);
  }
  const displayNames = new Map<string, string>();
  for (const entry of [
    ...Object.values(gameData.items),
    ...Object.values(gameData.resources),
    ...Object.values(gameData.recipes),
    ...Object.values(gameData.buildings),
  ]) {
    // Skip entries with no authored name: the neutral data emits '' rather than a
    // humanised fallback, so callers resolving `get(c) ?? humanise(c)` only see a
    // real authored name here (and humanise the rest at the edge).
    if (entry.displayName) {
      displayNames.set(entry.className, entry.displayName);
    }
  }
  const fluids = new Set<string>();
  for (const item of [...Object.values(gameData.items), ...Object.values(gameData.resources)]) {
    if (item.form === 'liquid' || item.form === 'gas') {
      fluids.add(item.className);
    }
  }
  logger.info(`Loaded ${displayNames.size} display names from game data (${gameData.version}).`);
  return {
    displayNames,
    recipes: gameData.recipes,
    buildings: gameData.buildings,
    fluids,
    projectAssemblyPhases: gameData.projectAssemblyPhases ?? [],
    schematics: gameData.schematics,
  };
}

/**
 * A `className → displayName` map (covers items, resources, recipes and buildings).
 * Thin wrapper over {@link loadGameDataIndex} for callers that only need names.
 */
export function loadDisplayNames(): Map<string, string> {
  return loadGameDataIndex().displayNames;
}

/** Resolves a raw class name to a display name. */
export type NameResolver = (className: string) => string;

/**
 * The single edge name-resolution rule: the game-data authored name, falling back
 * to a humanised class name. The neutral data libs emit raw class names only, so
 * every display name surfaced by the MCP tools is resolved here.
 */
export function makeNameResolver(game: GameDataIndex): NameResolver {
  return (className) => game.displayNames.get(className) ?? humaniseClassName(className);
}
