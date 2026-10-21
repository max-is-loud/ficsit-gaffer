// What a save has unlocked, as names the foreman can use directly: the factory buildings its
// purchased schematics grant and the machine recipes it can run. The save summary lists them so the
// foreman need not fetch the full milestone and recipe views to know what is buildable.

import type { SaveState } from '@foreman/sf-save-data';

import type { GameDataIndex } from '../gameData.js';

/**
 * Building categories that are decoration or structure rather than factory equipment. A deny list,
 * so a category new to the game data is listed rather than silently dropped.
 */
const COSMETIC_CATEGORIES = new Set([
  'Beam',
  'BarrierCorner',
  'CornerWall',
  'CornerWallLightweight',
  'Door',
  'Floodlight',
  'FoundationLightweight',
  'Jumppad',
  'Ladder',
  'LightSource',
  'LightsControlPanel',
  'PillarLightweight',
  'RampLightweight',
  'Stair',
  'Walkway',
  'WalkwayLightweight',
  'Wall',
  'WallLightweight',
  'WidgetSign',
]);

/** Unlocked factory buildings and machine recipes, each by display name, sorted and de-duplicated. */
export interface UnlockedNames {
  buildings: string[];
  /** Standard (non-alternate) recipes made in a machine; build-gun and workshop recipes excluded. */
  partRecipes: string[];
}

const sortedUnique = (names: string[]): string[] =>
  [...new Set(names)].sort((left, right) => left.localeCompare(right));

function unlockedBuildings(state: SaveState, game: GameDataIndex): string[] {
  const names: string[] = [];
  for (const milestone of state.milestones) {
    const schematic = game.schematics?.[milestone.schematicClass];
    for (const buildingClass of schematic?.unlocksBuildings ?? []) {
      const building = game.buildings[buildingClass];
      if (building?.displayName && !COSMETIC_CATEGORIES.has(building.category)) {
        names.push(building.displayName);
      }
    }
  }
  return sortedUnique(names);
}

function unlockedPartRecipes(state: SaveState, game: GameDataIndex): string[] {
  const names: string[] = [];
  for (const unlocked of state.recipes) {
    const recipe = game.recipes[unlocked.recipeClass];
    if (recipe !== undefined && !recipe.isAlternate && recipe.producedIn.length > 0) {
      names.push(recipe.displayName);
    }
  }
  return sortedUnique(names);
}

/**
 * The save's unlocked buildings (from its purchased schematics) and machine recipes. Empty lists
 * when the game data has no schematics or recipes. Creative-mode blanket unlocks are not expanded.
 */
export function unlockedNames(state: SaveState, game: GameDataIndex): UnlockedNames {
  return {
    buildings: unlockedBuildings(state, game),
    partRecipes: unlockedPartRecipes(state, game),
  };
}
