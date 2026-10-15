// Game-channel names (stable, experimental), '~' expansion for paths, and the location of the
// bundled per-channel data directory. Dataset file resolution lives in world/index.ts.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundled-data location and channel helpers.
 *
 * The old `resolveDocsPath` (which located a raw `en-US.json` to parse at runtime)
 * was retired in #162 along with the TypeScript parser. Game data is now produced
 * offline by the C# extractor and loaded from the merged `sf-game-data.json`; the
 * dataset resolution lives in `./world/index.ts` (`resolveDatasetPath`).
 */

/** Satisfactory release channels Foreman bundles game data for. */
export type GameChannel = 'stable' | 'experimental';
export const GAME_CHANNELS: readonly GameChannel[] = ['stable', 'experimental'];

/** Expands a leading `~` to the user's home directory. */
export function expandHome(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

/** Root directory holding the bundled per-channel game data (`<pkg>/data`). */
export function bundledDataDir(): string {
  // This module compiles to either src/ (tsx) or dist/ — both one level under
  // the package root, so the bundled data sits at `../data`.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', 'data');
}
