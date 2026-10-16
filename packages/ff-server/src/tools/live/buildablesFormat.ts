// Turns a receiver BuildablesState into the model-facing JSON for
// get_live_buildables: display names instead of class paths, configuration
// in the Pioneer's units (clock speed as a percentage), explicit "unknown"
// and "no recipe", and guidance on what the numbers do and do not mean.

import type { GameNames } from '../../bridge/gameNames.js';
import type {
  BuildableRow,
  BuildablesGroupBy,
  BuildablesState,
  ExtractorConfig,
  GeneratorConfig,
  ManufacturerConfig,
} from '../../bridge/types.js';
import { iso, metres, statusGuidance } from './freshness.js';

const UNKNOWN = 'unknown';
const NO_RECIPE = 'no recipe';

function named(names: GameNames, path: string): string {
  const { name, unresolved } = names.displayName(path);
  return unresolved ? `${name} (not in game data)` : name;
}
const known = <T>(value: T | null): T | string => value ?? UNKNOWN;
const percent = (clock: number | null): number | string =>
  clock === null ? UNKNOWN : Math.round(clock * 1000) / 10;
const item = (names: GameNames, path: string | null): string =>
  path === null ? UNKNOWN : named(names, path);

type Configuration = Record<string, unknown>;
const CONFIGURATION: Record<
  BuildableRow['category'],
  (row: BuildableRow, names: GameNames) => Configuration
> = {
  manufacturer: ({ config }, names) => {
    const made = config as ManufacturerConfig;
    return {
      recipe: made.recipe === null ? NO_RECIPE : named(names, made.recipe),
      clockSpeedPercent: percent(made.clockSpeed),
      productionBoost: known(made.productionBoost),
      powerShards: known(made.powerShards),
      somersloops: known(made.somersloops),
      paused: known(made.paused),
    };
  },
  extractor: ({ config }, names) => {
    const mined = config as ExtractorConfig;
    return {
      resource: item(names, mined.resource),
      purity: known(mined.purity),
      clockSpeedPercent: percent(mined.clockSpeed),
      powerShards: known(mined.powerShards),
      paused: known(mined.paused),
    };
  },
  generator: ({ config }, names) => {
    const burned = config as GeneratorConfig;
    return {
      fuel: item(names, burned.fuel),
      clockSpeedPercent: percent(burned.clockSpeed),
      powerShards: known(burned.powerShards),
      paused: known(burned.paused),
    };
  },
  storage: () => ({}),
};

function formatRow(row: BuildableRow, names: GameNames): Record<string, unknown> {
  return {
    entityId: row.entityId,
    building: named(names, row.classPath),
    category: row.category,
    configuration: CONFIGURATION[row.category](row, names),
    positionCm: row.position,
    positionMetres: row.position.map(metres),
    ...(row.distanceMetres !== undefined ? { distanceMetres: row.distanceMetres } : {}),
  };
}

function groupName(groupBy: BuildablesGroupBy, key: string | null, names: GameNames): string {
  if (key === null) {
    return NO_RECIPE;
  }
  return groupBy === 'category' ? key : named(names, key);
}

function countGuidance(state: BuildablesState, includeRows: boolean): string {
  if (state.totalCount === null) {
    return 'Do not state a count.';
  }
  const total = `Exactly ${state.totalCount} matching buildables exist in this state.`;
  if (!includeRows) {
    return `${total} No rows were requested.`;
  }
  if (state.hasMore) {
    return `${total} This page lists ${state.returnedCount} of ${state.totalCount}. The list is partial — say so${state.nextCursor === null ? '' : ', or fetch the next page with nextCursor'}.`;
  }
  return `${total} The list is complete for this state.`;
}

const ACTIVITY =
  'Configuration is not activity: a recipe set and not paused does not mean the machine is running or producing.';
const COORDINATES =
  'Unreal world [X, Y, Z]: positionCm in centimetres as recorded; positionMetres = cm / 100 (the unit the game-data world tools take). Coordinates do not name a base.';

export function formatBuildables(
  state: BuildablesState,
  query: { includeRows: boolean; groupBy?: BuildablesGroupBy },
  names: GameNames,
): string {
  const { includeRows, groupBy } = query;
  return JSON.stringify({
    source: 'live_bridge_receiver',
    status: state.status,
    reason: state.reason,
    guidance: `${statusGuidance(state.reason)} ${countGuidance(state, includeRows)} ${ACTIVITY}`,
    lastSyncAt: iso(state.lastSyncAt),
    evaluatedAt: iso(state.evaluatedAt),
    revision: state.revision,
    totalBuildables: state.totalCount ?? 'unknown',
    ...(groupBy !== undefined && state.groups !== undefined
      ? {
          groups: state.groups.map(({ key, count }) => ({
            name: groupName(groupBy, key, names),
            count,
          })),
        }
      : {}),
    rowsIncluded: includeRows,
    ...(includeRows
      ? {
          returnedRows: state.returnedCount,
          rowsComplete: !state.hasMore,
          nextCursor: state.nextCursor,
          coordinates: COORDINATES,
          rows: state.rows.map((row) => formatRow(row, names)),
        }
      : {}),
  });
}
