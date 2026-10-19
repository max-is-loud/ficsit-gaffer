import { describe, expect, it } from 'vitest';

import type { Building, Recipe, Schematic } from '@foreman/sf-game-data';
import { emptySaveState } from '@foreman/sf-save-data';

import type { GameDataIndex } from '../src/gameData.js';
import { unlockedNames } from '../src/query/unlocks.js';

const building = (className: string, displayName: string, category: string): Building =>
  ({ className, displayName, description: '', category, powerConsumption: 0 }) as Building;

const recipe = (
  className: string,
  displayName: string,
  producedIn: string[],
  isAlternate = false,
): Recipe => ({ className, displayName, isAlternate, producedIn }) as unknown as Recipe;

const schematic = (className: string, unlocksBuildings: string[]): Schematic => ({
  className,
  displayName: className,
  type: 'milestone',
  tier: 1,
  cost: [],
  unlocksRecipes: [],
  unlocksBuildings,
  unlocksItems: [],
});

const game: GameDataIndex = {
  displayNames: new Map(),
  buildings: {
    Build_SmelterMk1_C: building('Build_SmelterMk1_C', 'Smelter', 'Manufacturer'),
    Build_ConveyorBeltMk1_C: building(
      'Build_ConveyorBeltMk1_C',
      'Conveyor Belt Mk.1',
      'ConveyorBelt',
    ),
    Build_Foundation_C: building('Build_Foundation_C', 'Foundation (1 m)', 'FoundationLightweight'),
    Build_Constructor_C: building('Build_Constructor_C', 'Constructor', 'Manufacturer'),
  },
  recipes: {
    Recipe_IronPlate_C: recipe('Recipe_IronPlate_C', 'Iron Plate', ['Constructor']),
    Recipe_IngotIron_C: recipe('Recipe_IngotIron_C', 'Iron Ingot', ['Smelter']),
    Recipe_Chainsaw_C: recipe('Recipe_Chainsaw_C', 'Chainsaw', []),
    Recipe_Alternate_Wire_C: recipe('Recipe_Alternate_Wire_C', 'Iron Wire', ['Constructor'], true),
  },
  schematics: {
    Schematic_Start_C: schematic('Schematic_Start_C', ['Build_SmelterMk1_C', 'Build_Foundation_C']),
    Schematic_1_1_C: schematic('Schematic_1_1_C', [
      'Build_ConveyorBeltMk1_C',
      'Build_SmelterMk1_C',
    ]),
    Schematic_2_1_C: schematic('Schematic_2_1_C', ['Build_Constructor_C']),
  },
};

function state() {
  const save = emptySaveState('v', 'Fixture', '2026-10-18T00:00:00.000Z');
  save.milestones = [
    { schematicClass: 'Schematic_Start_C', kind: 'other' },
    { schematicClass: 'Schematic_1_1_C', tier: 1, kind: 'milestone' },
    { schematicClass: 'Schematic_Unknown_C', kind: 'other' },
  ];
  save.recipes = [
    { recipeClass: 'Recipe_IronPlate_C', isAlternate: false },
    { recipeClass: 'Recipe_IngotIron_C', isAlternate: false },
    { recipeClass: 'Recipe_Chainsaw_C', isAlternate: false },
    { recipeClass: 'Recipe_Alternate_Wire_C', isAlternate: true },
    { recipeClass: 'Recipe_Foundation_C', isAlternate: false },
  ];
  return save;
}

describe('unlockedNames', () => {
  it("lists the factory buildings the save's schematics unlock, sorted and de-duplicated", () => {
    expect(unlockedNames(state(), game).buildings).toEqual(['Conveyor Belt Mk.1', 'Smelter']);
  });

  it('lists standard machine recipes, leaving out alternates, equipment and build-gun recipes', () => {
    expect(unlockedNames(state(), game).partRecipes).toEqual(['Iron Ingot', 'Iron Plate']);
  });

  it('lists no buildings when the game data has no schematics', () => {
    expect(unlockedNames(state(), { ...game, schematics: undefined }).buildings).toEqual([]);
  });
});
