// Extracts collected pickup and looted drop-pod GUIDs from the scannable subsystem, in the format
// the world-locations dataset uses.

import { FG_SCANNABLE_SUBSYSTEM } from '../constants.js';
import type { RawObject } from '../parser/types.js';
import { asArray, dig, propMap } from './util.js';

/**
 * The collected-collectible GUIDs the pioneer has gathered, read from
 * `FGScannableSubsystem`. `collectedPickupGuids` covers spheres/sloops/slugs
 * (the subsystem's `mDestroyedPickups`); `lootedDropPodGuids` covers hard-drive
 * pods (`mLootedDropPods`). Each GUID is 32 uppercase hex chars, matching the
 * `guid` field of the world-locations dataset — so collected status is exact and
 * per-actor at any progression.
 */
export interface ScannableState {
  collectedPickupGuids: string[];
  lootedDropPodGuids: string[];
}

/** A save FGuid is four uint32s; render as 32 uppercase hex (file order). */
function guidHex(value: unknown): string | undefined {
  const parts = asArray(value);
  if (parts.length !== 4) {
    return undefined;
  }
  let hex = '';
  for (const part of parts) {
    if (typeof part !== 'number') {
      return undefined;
    }
    hex += (part >>> 0).toString(16).padStart(8, '0').toUpperCase();
  }
  return hex;
}

/** GUIDs from a `SetProperty` of FGuid structs (its `values` array). */
function guidSet(bag: Record<string, unknown>, prop: string): string[] {
  const out: string[] = [];
  for (const value of asArray(dig(bag[prop], 'values'))) {
    const hex = guidHex(value);
    if (hex !== undefined) {
      out.push(hex);
    }
  }
  return out;
}

export function extractScannable(objects: RawObject[]): ScannableState {
  const subsystem = objects.find((o) => FG_SCANNABLE_SUBSYSTEM.test(o.typePath ?? ''));
  if (subsystem === undefined) {
    return { collectedPickupGuids: [], lootedDropPodGuids: [] };
  }
  const bag = propMap(subsystem);
  return {
    collectedPickupGuids: guidSet(bag, 'mDestroyedPickups'),
    lootedDropPodGuids: guidSet(bag, 'mLootedDropPods'),
  };
}
