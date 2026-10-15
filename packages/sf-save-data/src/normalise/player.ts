// Extracts the pioneer's location, HUB location and personal inventory from the player pawn.

import { HUB_BUILDING, PLAYER_CHARACTER, PLAYER_INVENTORY_PROP } from '../constants.js';
import type { RawObject } from '../parser/types.js';
import { decodeInventoryComponent } from './inventories.js';
import type { Inventory, PlayerState } from './types.js';
import { propMap, refField, translation, type Warnings } from './util.js';

/**
 * Extracts the pioneer's location, HUB location, and personal inventory. The
 * player pawn (`Char_Player_C`) carries the world transform and an `mInventory`
 * reference to its inventory component, which we resolve via the instance index.
 */
export function extractPlayer(
  objects: RawObject[],
  byInstance: Map<string, RawObject>,
  warnings: Warnings,
): PlayerState {
  const hub = objects.find((o) => HUB_BUILDING.test(o.typePath ?? ''));
  const hubLocation = hub === undefined ? undefined : translation(hub);

  const player = objects.find((o) => PLAYER_CHARACTER.test(o.typePath ?? ''));
  if (player === undefined) {
    warnings.add('No player character (Char_Player) found in save.');
    return { location: undefined, hubLocation, inventory: [] };
  }

  let inventory: Inventory = [];
  const inventoryRef = refField(propMap(player), PLAYER_INVENTORY_PROP);
  if (inventoryRef !== undefined) {
    const component = byInstance.get(inventoryRef);
    if (component === undefined) {
      warnings.add(`Player inventory component '${inventoryRef}' not found in save.`);
    } else {
      inventory = decodeInventoryComponent(component);
    }
  }

  return { location: translation(player), hubLocation, inventory };
}
