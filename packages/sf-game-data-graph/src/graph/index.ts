// GraphDB, the in-memory query facade that wires GameData, the resolver and the adjacency index
// to the per-domain query functions in queries/, plus the initGraph factory.

import type { GameData, Item, Recipe, Schematic } from '@foreman/sf-game-data';
import type { QueryContext } from './context.js';
import { buildGraphIndex } from './indexes.js';
import { Resolver } from './resolve.js';
import {
  getItem,
  listItems,
  whatConsumes,
  type ItemSummary,
  type WhatConsumesResult,
} from './queries/items.js';
import {
  compareAlternates,
  getRecipe,
  listRecipes,
  recipesFor,
  type RecipeSummary,
  type RecipesForResult,
} from './queries/recipes.js';
import {
  buildableWith,
  fullProductionLine,
  ingredientTree,
  totalRawInputs,
  type BuildableItem,
  type FullProductionLineOptions,
  type TotalRawInputsResult,
} from './queries/production.js';
import { getSchematic, listSchematics, type SchematicSummary } from './queries/schematics.js';
import {
  getBuilding,
  listBuildings,
  listPowerGenerators,
  type BuildingSummary,
  type BuildingView,
  type GeneratorSummary,
} from './queries/buildings.js';
import type {
  AlternateComparison,
  FullProductionLineResult,
  IngredientTreeResult,
  RecipeView,
} from './types.js';

/**
 * The graph query facade. Wraps the parsed `GameData` and exposes one method per
 * MCP tool. Relationship queries read two precomputed item→recipe adjacency maps
 * (`buildGraphIndex`); rich detail objects (full recipes, items, schematics) are
 * served straight from `GameData`, which already has the fully-resolved nested
 * shape. Everything is in-memory — there is no database.
 */
export class GraphDB implements QueryContext {
  public readonly version: string;
  public readonly build?: number;
  public readonly resolver: Resolver;
  public readonly producersByItem: Map<string, Recipe[]>;
  public readonly consumersByItem: Map<string, Recipe[]>;

  constructor(public readonly gameData: GameData) {
    this.version = gameData.version;
    this.build = gameData.build;
    this.resolver = new Resolver(gameData);
    const index = buildGraphIndex(gameData);
    this.producersByItem = index.producersByItem;
    this.consumersByItem = index.consumersByItem;
  }

  public getItem(name: string): Item | undefined {
    return getItem(this, name);
  }

  public listItems(opts?: { search?: string }): ItemSummary[] {
    return listItems(this, opts);
  }

  public whatConsumes(name: string): Promise<WhatConsumesResult | undefined> {
    return whatConsumes(this, name);
  }

  public getRecipe(name: string): RecipeView | undefined {
    return getRecipe(this, name);
  }

  public listRecipes(opts?: { search?: string }): RecipeSummary[] {
    return listRecipes(this, opts);
  }

  public recipesFor(name: string): Promise<RecipesForResult | undefined> {
    return recipesFor(this, name);
  }

  public compareAlternates(name: string): Promise<AlternateComparison | undefined> {
    return compareAlternates(this, name);
  }

  public ingredientTree(
    item: string,
    targetPerMinute: number,
    recipeChoices?: Record<string, string>,
  ): Promise<IngredientTreeResult | undefined> {
    return ingredientTree(this, item, targetPerMinute, recipeChoices);
  }

  public totalRawInputs(
    item: string,
    targetPerMinute: number,
  ): Promise<TotalRawInputsResult | undefined> {
    return totalRawInputs(this, item, targetPerMinute);
  }

  public fullProductionLine(
    item: string,
    targetPerMinute: number,
    recipeChoices?: Record<string, string>,
    options?: FullProductionLineOptions,
  ): Promise<FullProductionLineResult | undefined> {
    return fullProductionLine(this, item, targetPerMinute, recipeChoices, options);
  }

  public buildableWith(resources: string[]): Promise<BuildableItem[]> {
    return buildableWith(this, resources);
  }

  public listSchematics(opts?: { tier?: number; search?: string }): SchematicSummary[] {
    return listSchematics(this, opts);
  }

  public getSchematic(name: string): Schematic | undefined {
    return getSchematic(this, name);
  }

  public getBuilding(name: string): BuildingView | undefined {
    return getBuilding(this, name);
  }

  public listBuildings(opts?: { search?: string; category?: string }): BuildingSummary[] {
    return listBuildings(this, opts);
  }

  public listPowerGenerators(): GeneratorSummary[] {
    return listPowerGenerators(this);
  }
}

/**
 * Builds the in-memory query facade from `GameData`. Async for call-site
 * stability (it was formerly an async Kùzu load); the build itself is synchronous
 * and near-instant.
 */
export async function initGraph(gameData: GameData): Promise<GraphDB> {
  return new GraphDB(gameData);
}
