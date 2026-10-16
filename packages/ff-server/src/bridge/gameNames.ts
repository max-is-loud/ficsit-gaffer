// Display-name resolution for the live tools, backed by sf-game-data. The
// receiver speaks class paths and class names; the model and the Pioneer
// speak display names ("Smelter", "Alternate: Pure Iron Ingot"). Matching is
// exact (case-insensitive) — never fuzzy — so a wrong guess can't silently
// filter the wrong machines.

import type { GameData } from '@foreman/sf-game-data';

export type NameResolution =
  | { ok: true; className: string }
  | { ok: false; reason: 'unknown' | 'ambiguous'; candidates: string[] };

export interface DisplayName {
  name: string;
  /** True when game data has no entry (a mod or a newer game build). */
  unresolved: boolean;
}

export interface GameNames {
  resolveBuilding(name: string): NameResolution;
  resolveRecipe(name: string): NameResolution;
  /** Accepts a class path or a bare class name. */
  displayName(pathOrClassName: string): DisplayName;
}

const MAX_CANDIDATES = 5;

interface Named {
  className: string;
  displayName: string;
}

/** The final `.`-separated segment of a class path. */
export function classNameOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1);
}

/** Unknown-name hints: display names containing the query, prefix matches first. */
function hints(entries: readonly Named[], query: string): string[] {
  const unique = [...new Set(entries.map((entry) => entry.displayName))];
  const containing = unique.filter((name) => name.toLowerCase().includes(query));
  const rank = (name: string): number => (name.toLowerCase().startsWith(query) ? 0 : 1);
  return containing
    .sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))
    .slice(0, MAX_CANDIDATES);
}

function resolver(entries: readonly Named[]): (name: string) => NameResolution {
  return (name) => {
    const query = name.trim().toLowerCase();
    const matches = entries.filter(
      (entry) =>
        entry.displayName.toLowerCase() === query || entry.className.toLowerCase() === query,
    );
    if (matches.length === 1 && matches[0] !== undefined) {
      return { ok: true, className: matches[0].className };
    }
    if (matches.length > 1) {
      const candidates = matches.map((entry) => `${entry.displayName} (${entry.className})`).sort();
      return { ok: false, reason: 'ambiguous', candidates };
    }
    return { ok: false, reason: 'unknown', candidates: query === '' ? [] : hints(entries, query) };
  };
}

export function createGameNames(gameData: GameData): GameNames {
  const buildings = Object.values(gameData.buildings);
  const recipes = Object.values(gameData.recipes);
  const byClassName = new Map<string, string>();
  for (const entry of [
    ...Object.values(gameData.items),
    ...Object.values(gameData.resources),
    ...recipes,
    ...buildings,
  ]) {
    byClassName.set(entry.className, entry.displayName);
  }
  return {
    resolveBuilding: resolver(buildings),
    resolveRecipe: resolver(recipes),
    displayName(pathOrClassName) {
      const className = classNameOf(pathOrClassName);
      const name = byClassName.get(className);
      return name === undefined
        ? { name: className, unresolved: true }
        : { name, unresolved: false };
    },
  };
}
