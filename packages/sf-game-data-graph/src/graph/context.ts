// Shared query plumbing: the QueryContext every query function takes, plus item lookup,
// display-name, unit and rounding helpers used across the query modules.

import type { GameData, IngredientUnit, Item } from '@foreman/sf-game-data';
import type { GraphIndex } from './indexes.js';
import type { Resolver } from './resolve.js';

/** Everything a query function needs. Implemented by `GraphDB`. */
export interface QueryContext extends GraphIndex {
  gameData: GameData;
  resolver: Resolver;
  version: string;
  /** Satisfactory build/CL number the data was extracted from, if known. */
  build?: number;
}

/** Looks up an item (or resource) by class name across the combined sets. */
export function itemByClass(gameData: GameData, className: string): Item | undefined {
  return gameData.items[className] ?? gameData.resources[className];
}

export function unitForItem(gameData: GameData, className: string): IngredientUnit {
  const item = itemByClass(gameData, className);
  if (item !== undefined && (item.form === 'liquid' || item.form === 'gas')) {
    return 'm³';
  }
  return 'items';
}

/**
 * The item's authored display name, falling back to the raw class name (not a
 * humanised form — humanising is the edge's job, and this label is surfaced
 * directly in graph tool output with no edge re-resolution).
 */
export function displayForItem(gameData: GameData, className: string): string {
  return itemByClass(gameData, className)?.displayName || className;
}

/** Display name of the first machine a recipe runs in, if any. */
export function machineForRecipe(gameData: GameData, recipeClassName: string): string | undefined {
  return gameData.recipes[recipeClassName]?.producedIn[0];
}

/** Rounds to 4 decimal places to suppress floating-point noise in answers. */
export function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
