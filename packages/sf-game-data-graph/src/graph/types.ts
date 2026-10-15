// Result shapes returned by the recipe and production queries: recipe views, ingredient trees,
// full-production-line costings and alternate-recipe comparisons. Types only; no logic.

import type { IngredientUnit } from '@foreman/sf-game-data';

/** A single ingredient/product line as returned by recipe queries. */
export interface IngredientView {
  item: string;
  itemClassName: string;
  amount: number;
  perMinute: number;
  unit: IngredientUnit;
}

export interface RecipeView {
  className: string;
  displayName: string;
  isAlternate: boolean;
  craftTime: number;
  producedIn: string[];
  ingredients: IngredientView[];
  products: IngredientView[];
  variablePower?: { min: number; max: number };
}

/** One item in a flattened production breakdown (every tier). */
export interface ProductionComponent {
  item: string;
  itemClassName: string;
  perMinute: number;
  unit: IngredientUnit;
  isRaw: boolean;
  /** Recipe used to produce this item; absent for raw resources. */
  recipe?: string;
  machine?: string;
  machineCount?: number;
}

export interface IngredientTreeResult {
  item: string;
  itemClassName: string;
  targetPerMinute: number;
  unit: IngredientUnit;
  recipe: string;
  machine?: string;
  machineCount?: number;
  /** Flat list of every input across all tiers, aggregated by item. */
  components: ProductionComponent[];
  warnings: string[];
}

export interface RawInput {
  item: string;
  itemClassName: string;
  perMinute: number;
  unit: IngredientUnit;
}

/** A line of a build cost (item × amount). */
export interface CostLine {
  item: string;
  itemClassName: string;
  amount: number;
}

export interface ProductionMachineCost {
  building: string;
  recipe: string;
  /** Whole machines to build (ceil of the exact count). */
  count: number;
  /** Exact (fractional) machines the rate needs, for reference. */
  exactCount: number;
  buildCost: CostLine[];
}

export interface ExtractionCost {
  building: string;
  resource: string;
  /** Demand for this raw resource (resource's native unit per minute). */
  ratePerMin: number;
  count: number;
  buildCost: CostLine[];
}

export interface LogisticsCost {
  kind: 'belt' | 'pipe' | 'splitter' | 'merger';
  building: string;
  /** Belt/pipe mark, when applicable. */
  mark?: number;
  /** Parallel lines of that mark needed to carry the flow (belts/pipes). */
  lines?: number;
  /** The item the belt/pipe carries (belts/pipes). */
  forItem?: string;
  count: number;
  /** Always true — logistics figures are estimates (see warnings). */
  estimated: true;
  buildCost: CostLine[];
}

export interface FullProductionLineResult {
  item: string;
  itemClassName: string;
  targetPerMinute: number;
  unit: IngredientUnit;
  recipe: string;
  productionMachines: ProductionMachineCost[];
  extraction: ExtractionCost[];
  logistics: LogisticsCost[];
  /** Aggregated shopping list across every machine above (logistics estimated). */
  totalBuildCost: CostLine[];
  assumptions: { minerMark: number; purity: string; beltMetresPerLink: number };
  warnings: string[];
}

export interface AlternateComparisonRow {
  recipe: string;
  className: string;
  isAlternate: boolean;
  machine: string | null;
  craftTime: number;
  outputPerMinute: number;
  ingredients: IngredientView[];
}

export interface AlternateComparison {
  item: string;
  itemClassName: string;
  recipes: AlternateComparisonRow[];
}
