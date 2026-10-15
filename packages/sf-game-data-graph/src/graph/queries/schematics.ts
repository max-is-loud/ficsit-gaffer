// Schematic queries: list milestones and MAM nodes (filterable by tier or search text) with unlock
// counts, and fetch one schematic in full.

import type { Schematic } from '@foreman/sf-game-data';
import type { QueryContext } from '../context.js';

export interface SchematicSummary {
  className: string;
  displayName: string;
  type: Schematic['type'];
  tier: number;
  unlocks: { recipes: number; buildings: number; items: number };
}

function summarise(schematic: Schematic): SchematicSummary {
  return {
    className: schematic.className,
    displayName: schematic.displayName,
    type: schematic.type,
    tier: schematic.tier,
    unlocks: {
      recipes: schematic.unlocksRecipes.length,
      buildings: schematic.unlocksBuildings.length,
      items: schematic.unlocksItems.length,
    },
  };
}

/**
 * All milestones/MAM nodes etc., optionally filtered to a single `tier` and/or a
 * case-insensitive `search` substring matched against display name and class name.
 */
export function listSchematics(
  ctx: QueryContext,
  opts?: { tier?: number; search?: string },
): SchematicSummary[] {
  const search = opts?.search?.trim().toLowerCase();
  return Object.values(ctx.gameData.schematics)
    .filter((schematic) => opts?.tier === undefined || schematic.tier === opts.tier)
    .filter((schematic) => {
      if (search === undefined || search === '') {
        return true;
      }
      return `${schematic.displayName} ${schematic.className}`.toLowerCase().includes(search);
    })
    .map(summarise)
    .sort((a, b) => a.tier - b.tier || a.displayName.localeCompare(b.displayName));
}

/** A single schematic with its full unlock list, display names resolved. */
export function getSchematic(ctx: QueryContext, name: string): Schematic | undefined {
  const className = ctx.resolver.resolveSchematic(name);
  if (className === undefined) {
    return undefined;
  }
  return ctx.gameData.schematics[className];
}
