// normaliseSave: turns a parsed RawSave into the SaveState model by indexing every object once and
// delegating to the per-domain extractors in this directory.

import type { RawObject, RawSave } from '../parser/types.js';
import { extractCreativeMode, extractGameSettings } from './gameSettings.js';
import { extractPlayer } from './player.js';
import { extractProduction } from './production.js';
import { extractRecipes } from './recipes.js';
import { extractScannable } from './scannable.js';
import { extractProgression } from './schematics.js';
import { extractStorage } from './storage.js';
import { extractTopology } from './topology.js';
import type { SaveState } from './types.js';
import { Warnings } from './util.js';

export { emptySaveState } from './types.js';
export type { SaveState } from './types.js';
export { ownerOf } from './topology.js';

/**
 * Converts a parsed save into the clean `SaveState` model. Walks every
 * World-Partition sublevel once — indexing objects by instance name — then
 * delegates to the per-domain normalisers. Never throws: bad entries are skipped
 * and recorded in `warnings`, so a partial parse still yields a usable state.
 *
 * The result carries raw class names only; resolving them to display names is the
 * consumer's job at the edge (`sf-mcp`), keeping this library game-data-agnostic.
 */
export function normaliseSave(
  raw: RawSave,
  parsedAt: string,
): { state: SaveState; warnings: string[] } {
  const warnings = new Warnings();

  const objects: RawObject[] = [];
  const byInstance = new Map<string, RawObject>();

  for (const level of Object.values(raw.levels ?? {})) {
    for (const obj of level?.objects ?? []) {
      objects.push(obj);
      if (obj.instanceName !== undefined) {
        byInstance.set(obj.instanceName, obj);
      }
    }
  }

  const progression = extractProgression(objects, warnings);
  const scannable = extractScannable(objects);
  const gameSettings = extractGameSettings(objects, warnings);

  // Collected loose crash-site parts are recorded per-sublevel in `collectables`
  // (the collected/removed-actor list), by path name — NOT in mDestroyedPickups. We
  // keep the instance-name tail of each FGItemPickup_Spawnable ref so the save MCP can
  // drop already-grabbed parts from the world dataset (matched on lootPickups[].id).
  const collectedLootIds: string[] = [];
  for (const level of Object.values(raw.levels ?? {})) {
    for (const ref of level?.collectables ?? []) {
      const path = ref.pathName ?? '';
      if (!path.includes('ItemPickup_Spawnable')) {
        continue;
      }
      const name = path.split('.').pop();
      if (name !== undefined && name !== '') {
        collectedLootIds.push(name);
      }
    }
  }

  const state: SaveState = {
    version: detectVersion(raw),
    saveName: detectSaveName(raw),
    sessionName: raw.header?.sessionName,
    mapName: raw.header?.mapName,
    buildVersion: raw.header?.buildVersion,
    saveVersion: raw.header?.saveVersion,
    playDurationSeconds: raw.header?.playDurationSeconds,
    parsedAt,
    player: extractPlayer(objects, byInstance, warnings),
    storage: extractStorage(objects, byInstance, warnings),
    recipes: extractRecipes(objects, warnings),
    production: extractProduction(objects, warnings),
    topology: extractTopology(objects, warnings),
    milestones: progression.milestones,
    mamResearch: progression.mamResearch,
    assemblyPhase: progression.assemblyPhase,
    advancedGameSettings: gameSettings.advancedGameSettings,
    resourceNodeOverrides: gameSettings.resourceNodeOverrides,
    creativeMode: extractCreativeMode(objects, raw.header?.creativeModeEnabled ?? false),
    collectedPickupGuids: scannable.collectedPickupGuids,
    lootedDropPodGuids: scannable.lootedDropPodGuids,
    collectedLootIds,
    warnings: warnings.all(),
  };

  return { state, warnings: warnings.all() };
}

function detectVersion(raw: RawSave): string {
  const build = raw.header?.buildVersion;
  const save = raw.header?.saveVersion;
  if (build === undefined && save === undefined) {
    return 'unknown';
  }
  return `build ${build ?? '?'} (save ${save ?? '?'})`;
}

function detectSaveName(raw: RawSave): string {
  return raw.header?.sessionName ?? raw.header?.saveName ?? 'unknown';
}
