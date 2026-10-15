// Decodes inventory data from a save into per-item quantities: inventory components (stacks)
// and the dimensional depot's stored items.

import { INVENTORY_STACKS_PROP, STORED_ITEMS_PROP } from '../constants.js';
import type { RawObject } from '../parser/types.js';
import { classNameFromPath } from './classRef.js';
import type { Inventory } from './types.js';
import { arrayField, asNumber, dig, entryProps, propMap } from './util.js';

/**
 * Decodes an `FGInventoryComponent`'s `mInventoryStacks` into aggregated
 * per-item quantities. Each stack is `{ Item: { value.itemReference.pathName },
 * NumItems: { value } }`; empty slots (no item / zero count) are skipped.
 */
export function decodeInventoryComponent(component: RawObject): Inventory {
  const stacks = arrayField(propMap(component), INVENTORY_STACKS_PROP);
  const totals = new Map<string, number>();
  for (const stack of stacks) {
    const inner = entryProps(stack);
    const path = dig(inner['Item'], 'value', 'itemReference', 'pathName');
    const quantity = asNumber(dig(inner['NumItems'], 'value'));
    addItem(totals, typeof path === 'string' ? path : undefined, quantity);
  }
  return toInventory(totals);
}

/**
 * Decodes the dimensional depot's `FGCentralStorageSubsystem.mStoredItems`, which
 * uses the `ItemAmount` struct shape (`ItemClass` + `Amount`) rather than stacks.
 */
export function decodeStoredItems(subsystem: RawObject): Inventory {
  const items = arrayField(propMap(subsystem), STORED_ITEMS_PROP);
  const totals = new Map<string, number>();
  for (const item of items) {
    const inner = entryProps(item);
    const path = dig(inner['ItemClass'], 'value', 'pathName');
    const amount = asNumber(dig(inner['Amount'], 'value'));
    addItem(totals, typeof path === 'string' ? path : undefined, amount);
  }
  return toInventory(totals);
}

function addItem(
  totals: Map<string, number>,
  path: string | undefined,
  quantity: number | undefined,
): void {
  if (path === undefined || path.length === 0 || quantity === undefined || quantity <= 0) {
    return;
  }
  const itemClass = classNameFromPath(path);
  totals.set(itemClass, (totals.get(itemClass) ?? 0) + quantity);
}

function toInventory(totals: Map<string, number>): Inventory {
  return [...totals.entries()]
    .map(([itemClass, quantity]) => ({ itemClass, quantity }))
    .sort((a, b) => b.quantity - a.quantity);
}
