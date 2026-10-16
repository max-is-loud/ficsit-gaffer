import { loadGameData } from '@foreman/sf-game-data';
import { describe, expect, it } from 'vitest';

import { createGameNames } from '../src/bridge/gameNames.js';

const names = createGameNames(loadGameData({}).gameData);

describe('createGameNames', () => {
  it('resolves a building by display name or class name, ignoring case', () => {
    expect(names.resolveBuilding('Smelter')).toEqual({ ok: true, className: 'Build_SmelterMk1_C' });
    expect(names.resolveBuilding('build_smeltermk1_c')).toEqual({
      ok: true,
      className: 'Build_SmelterMk1_C',
    });
  });

  it('resolves an alternate recipe by its display name', () => {
    expect(names.resolveRecipe('Alternate: Pure Iron Ingot')).toEqual({
      ok: true,
      className: 'Recipe_Alternate_PureIronIngot_C',
    });
  });

  it('ambiguous recipe lists candidates', () => {
    const result = names.resolveRecipe('Turbo Rifle Ammo');
    expect(result).toMatchObject({ ok: false, reason: 'ambiguous' });
    expect(result.ok ? [] : result.candidates).toEqual([
      'Turbo Rifle Ammo (Recipe_CartridgeChaos_C)',
      'Turbo Rifle Ammo (Recipe_CartridgeChaos_Packaged_C)',
    ]);
  });

  it('reports an unknown name with up to five containing candidates', () => {
    const result = names.resolveRecipe('Iron');
    expect(result).toMatchObject({ ok: false, reason: 'unknown' });
    const candidates = result.ok ? [] : result.candidates;
    expect(candidates.length).toBeLessThanOrEqual(5);
    expect(candidates).toContain('Iron Ingot');
    expect(names.resolveBuilding('Zeppelin')).toEqual({
      ok: false,
      reason: 'unknown',
      candidates: [],
    });
  });

  it('names a class path from buildings, recipes, items and resources', () => {
    expect(names.displayName('/Game/X/Build_SmelterMk1.Build_SmelterMk1_C')).toEqual({
      name: 'Smelter',
      unresolved: false,
    });
    expect(names.displayName('/Game/X/Recipe_IngotIron.Recipe_IngotIron_C').name).toBe(
      'Iron Ingot',
    );
    expect(names.displayName('/Game/X/Desc_OreIron.Desc_OreIron_C').name).toBe('Iron Ore');
    expect(names.displayName('Desc_Coal_C').name).toBe('Coal');
  });

  it('unknown path is unresolved', () => {
    expect(names.displayName('/Game/Mod/Build_Thing.Build_Thing_C')).toEqual({
      name: 'Build_Thing_C',
      unresolved: true,
    });
  });
});
