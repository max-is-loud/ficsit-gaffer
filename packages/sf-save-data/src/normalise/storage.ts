// Extracts storage containers (location and contents) and the dimensional depot from a save.

import {
  CENTRAL_STORAGE_SUBSYSTEM,
  INVENTORY_STACKS_PROP,
  STORAGE_BUILDING,
} from '../constants.js';
import type { RawObject } from '../parser/types.js';
import { classNameFromPath } from './classRef.js';
import { decodeInventoryComponent, decodeStoredItems } from './inventories.js';
import type { Inventory, StorageContainer } from './types.js';
import { propMap, translation, type Warnings } from './util.js';

export interface StorageResult {
  containers: StorageContainer[];
  dimensionalDepot: Inventory;
}

/**
 * Extracts storage containers (with location + contents) and the dimensional
 * depot. A container's inventory lives in a child component referenced from its
 * `components` list; we resolve the first component that carries inventory stacks.
 */
export function extractStorage(
  objects: RawObject[],
  byInstance: Map<string, RawObject>,
  warnings: Warnings,
): StorageResult {
  const containers: StorageContainer[] = [];
  for (const obj of objects) {
    if (!STORAGE_BUILDING.test(obj.typePath ?? '')) {
      continue;
    }
    const buildingClass = classNameFromPath(obj.typePath ?? obj.instanceName ?? '');
    const instanceName = obj.instanceName;
    if (instanceName === undefined) {
      // A container with no instance name can't be a graph node nor be joined to topology.
      warnings.add(`Storage container ${buildingClass} has no instance name; skipping.`);
      continue;
    }
    containers.push({
      instanceName,
      buildingClass,
      location: translation(obj),
      inventory: resolveContainerInventory(obj, byInstance),
    });
  }

  const subsystem = objects.find((o) => CENTRAL_STORAGE_SUBSYSTEM.test(o.typePath ?? ''));
  let dimensionalDepot: Inventory = [];
  if (subsystem === undefined) {
    warnings.add('No central storage subsystem (dimensional depot) found in save.');
  } else {
    dimensionalDepot = decodeStoredItems(subsystem);
  }

  return { containers, dimensionalDepot };
}

function resolveContainerInventory(
  container: RawObject,
  byInstance: Map<string, RawObject>,
): Inventory {
  for (const ref of container.components ?? []) {
    const component = byInstance.get(ref.pathName);
    if (component !== undefined && INVENTORY_STACKS_PROP in propMap(component)) {
      return decodeInventoryComponent(component);
    }
  }
  return [];
}
