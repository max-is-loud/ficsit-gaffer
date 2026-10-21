import { describe, expect, it } from 'vitest';

import { summariseSave, type SaveViews } from '../src/query/saveSummary.js';
import type { MilestoneSummary } from '../src/query/selectors.js';

const progress: MilestoneSummary = {
  milestonesByTier: [],
  tutorials: [],
  other: [],
  mamResearch: [],
  projectAssembly: [],
};

function views(milestones: MilestoneSummary): SaveViews {
  return {
    meta: { saveName: 'Codex', version: 'build 1 (save 2)' },
    player: { itemCount: 0, inventory: [] },
    progress: milestones,
    recipes: { total: 0, standardCount: 0, alternateCount: 0, standard: [], alternates: [] },
    power: {
      circuits: [],
      generators: [],
      generatorCount: 0,
      totalCapacityMW: 0,
      totalConsumptionMW: 0,
      note: '',
    },
    production: { producerCount: 0, extractorCount: 0, estimatedPowerMW: 0, items: [], note: '' },
    storage: { containerCount: 0, containers: [], dimensionalDepot: [] },
    nearbyResources: [],
    unlocks: { buildings: [], partRecipes: [] },
  };
}

describe('summariseSave on a Creative Mode save', () => {
  it('carries the creative progression flags into the summary', () => {
    const creative = {
      startingTier: 5,
      unlockAllResearch: true,
      unlockAllShop: true,
      unlockInstantAltRecipes: false,
      noUnlockCost: true,
    };
    expect(summariseSave(views({ ...progress, creative })).progress.creative).toEqual(creative);
  });

  it('carries no creative field for a non-creative save', () => {
    expect(summariseSave(views(progress)).progress).not.toHaveProperty('creative');
  });
});
