// Parser-layer entry point: only emptyGameData, the empty GameData fallback used when no dataset
// resolves. The GameData types are in types.ts.

import type { GameData } from './types.js';

/**
 * An empty `GameData`, used as the fallback when no dataset resolves.
 *
 * The hand-written `en-US.json` parser that used to live here was retired in #162:
 * game data is now produced offline by the C# extractor (`sf-game-data-extractor`)
 * and loaded from the merged `sf-game-data.json` via `loadGameData`/`loadDataset`.
 * Only the `GameData` types (`./types.js`) and this fallback remain.
 */
export function emptyGameData(version: string, build?: number): GameData {
  return {
    version,
    build,
    parsedAt: new Date().toISOString(),
    items: {},
    resources: {},
    recipes: {},
    buildings: {},
    schematics: {},
    projectAssemblyPhases: [],
  };
}
