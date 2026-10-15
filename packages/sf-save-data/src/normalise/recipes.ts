// Extracts the unlocked recipes from the recipe manager, flagging alternates by class name.

import { ALTERNATE_RECIPE, AVAILABLE_RECIPES_PROP, RECIPE_MANAGER } from '../constants.js';
import type { RawObject } from '../parser/types.js';
import { classNameFromPath } from './classRef.js';
import type { UnlockedRecipe } from './types.js';
import { arrayField, asString, dig, propMap, type Warnings } from './util.js';

/**
 * Extracts unlocked recipes from `FGRecipeManager.mAvailableRecipes` (an array of
 * recipe class references), flagging alternates by class name.
 */
export function extractRecipes(objects: RawObject[], warnings: Warnings): UnlockedRecipe[] {
  const manager = objects.find((o) => RECIPE_MANAGER.test(o.typePath ?? ''));
  if (manager === undefined) {
    warnings.add('No recipe manager (FGRecipeManager) found in save.');
    return [];
  }
  const recipes: UnlockedRecipe[] = [];
  const seen = new Set<string>();
  for (const ref of arrayField(propMap(manager), AVAILABLE_RECIPES_PROP)) {
    const path = asString(dig(ref, 'pathName'));
    if (path === undefined || path.length === 0) {
      continue;
    }
    const recipeClass = classNameFromPath(path);
    if (seen.has(recipeClass)) {
      continue;
    }
    seen.add(recipeClass);
    recipes.push({
      recipeClass,
      isAlternate: ALTERNATE_RECIPE.test(recipeClass),
    });
  }
  recipes.sort((a, b) => a.recipeClass.localeCompare(b.recipeClass));
  return recipes;
}
