// Builds the item-to-recipe adjacency maps (producers and consumers per item) from GameData
// once, so relationship queries do not rescan every recipe.

import type { GameData, Recipe } from '@foreman/sf-game-data';

/**
 * Precomputed recipe adjacency, built once from `GameData`. These two maps
 * replace what were formerly PRODUCES/CONSUMES edge traversals — the underlying
 * facts (which recipes make/use an item, and at what per-minute rate) already
 * live on the `Recipe` objects, so the graph is just an item→recipes index over
 * them. Both are keyed by item class name and hold the full `Recipe` objects, so
 * callers read whatever detail (rate, alternate flag, ingredients) they need.
 */
export interface GraphIndex {
  /** Item class name → recipes that produce it (via `recipe.products`). */
  producersByItem: Map<string, Recipe[]>;
  /** Item class name → recipes that consume it (via `recipe.ingredients`). */
  consumersByItem: Map<string, Recipe[]>;
}

export function buildGraphIndex(gameData: GameData): GraphIndex {
  const producersByItem = new Map<string, Recipe[]>();
  const consumersByItem = new Map<string, Recipe[]>();
  const push = (map: Map<string, Recipe[]>, key: string, recipe: Recipe): void => {
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, [recipe]);
    } else {
      existing.push(recipe);
    }
  };
  for (const recipe of Object.values(gameData.recipes)) {
    for (const product of recipe.products) {
      push(producersByItem, product.itemClassName, recipe);
    }
    for (const ingredient of recipe.ingredients) {
      push(consumersByItem, ingredient.itemClassName, recipe);
    }
  }
  return { producersByItem, consumersByItem };
}
