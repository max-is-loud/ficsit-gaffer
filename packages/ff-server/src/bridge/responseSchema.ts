// Runtime contract for the receiver's /query/v2/buildables response: a strict
// zod schema (each row's configuration must match its category exactly) plus
// cross-field consistency rules the schema cannot express, kept as a table of
// named checks.

import { z } from 'zod';

import type { BridgeBinding, BuildablesQuery, BuildablesState } from './types.js';

export const MAX_ROWS = 100;
export const DEFAULT_LIMIT = 50;

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const timestamp = z.number().int().nonnegative();
const path = z.string().min(1).max(4096).nullable();
const number = z.number().nullable();
const count = z.number().int().nonnegative().max(4294967295).nullable();
const flag = z.boolean().nullable();
const position = z.tuple([z.number(), z.number(), z.number()]);
const common = {
  entityId: id,
  classPath: z.string().min(1).max(4096),
  position,
  distanceMetres: z.number().nonnegative().optional(),
};

const row = z.discriminatedUnion('category', [
  z.strictObject({
    ...common,
    category: z.literal('manufacturer'),
    config: z.strictObject({
      recipe: path,
      clockSpeed: number,
      productionBoost: number,
      powerShards: count,
      somersloops: count,
      paused: flag,
    }),
  }),
  z.strictObject({
    ...common,
    category: z.literal('extractor'),
    config: z.strictObject({
      resource: path,
      purity: z.enum(['impure', 'normal', 'pure']).nullable(),
      node: path,
      clockSpeed: number,
      powerShards: count,
      paused: flag,
    }),
  }),
  z.strictObject({
    ...common,
    category: z.literal('generator'),
    config: z.strictObject({ fuel: path, clockSpeed: number, powerShards: count, paused: flag }),
  }),
  z.strictObject({ ...common, category: z.literal('storage'), config: z.strictObject({}) }),
]);

export const stateSchema = z.strictObject({
  protocol: z.literal(2),
  serverId: id,
  worldId: id,
  revision: id.nullable(),
  epoch: id.nullable(),
  status: z.enum(['fresh', 'last_known', 'unavailable']),
  reason: z.enum(['recent_sync', 'stale', 'resynchronizing', 'receiver_restarted', 'no_baseline']),
  lastSyncAt: timestamp.nullable(),
  evaluatedAt: timestamp,
  totalCount: z.number().int().nonnegative().nullable(),
  groups: z
    .array(
      z.strictObject({
        key: z.string().min(1).max(4096).nullable(),
        count: z.number().int().positive(),
      }),
    )
    .optional(),
  rows: z.array(row).max(MAX_ROWS),
  coordinateSystem: z.literal('unreal_cm'),
  returnedCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextCursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,1024}$/)
    .nullable(),
});

interface Context {
  state: BuildablesState;
  binding: BridgeBinding;
  query: BuildablesQuery;
}

function pageFlagsWrong({ state, query }: Context): boolean {
  if (state.returnedCount !== state.rows.length) {
    return true;
  }
  // A distance page has no continuation; an id-ordered page has one exactly when more exist.
  return query.from !== undefined
    ? state.nextCursor !== null
    : state.hasMore !== (state.nextCursor !== null);
}

function unavailableShapeWrong({ state }: Context): boolean {
  if (state.status !== 'unavailable') {
    return false;
  }
  const nulls = [state.revision, state.epoch, state.lastSyncAt, state.totalCount];
  return (
    state.reason !== 'no_baseline' ||
    nulls.some((value) => value !== null) ||
    state.rows.length > 0 ||
    state.hasMore
  );
}

function committedShapeWrong({ state }: Context): boolean {
  if (state.status === 'unavailable') {
    return false;
  }
  return state.revision === null || state.epoch === null || state.totalCount === null;
}

/** Ordered named checks; the first that fails names the inconsistency. */
const RULES: readonly [string, (context: Context) => boolean][] = [
  [
    'identity_mismatch',
    ({ state, binding }) =>
      state.serverId !== binding.serverId || state.worldId !== binding.worldId,
  ],
  ['page_flags', pageFlagsWrong],
  [
    'duplicate_entity',
    ({ state }) =>
      new Set(state.rows.map((buildable) => buildable.entityId)).size !== state.rows.length,
  ],
  [
    'unrequested_rows',
    ({ state, query }) => query.includeRows !== true && (state.rows.length > 0 || state.hasMore),
  ],
  [
    'unrequested_groups',
    ({ state, query }) => (state.groups !== undefined) !== (query.groupBy !== undefined),
  ],
  ['page_limit', ({ state, query }) => state.rows.length > (query.limit ?? DEFAULT_LIMIT)],
  ['unavailable_shape', unavailableShapeWrong],
  ['committed_shape', committedShapeWrong],
  ['count_bound', ({ state }) => state.totalCount !== null && state.rows.length > state.totalCount],
  [
    'fresh_shape',
    ({ state }) =>
      state.status === 'fresh' && (state.reason !== 'recent_sync' || state.lastSyncAt === null),
  ],
  [
    'last_known_shape',
    ({ state }) =>
      state.status === 'last_known' &&
      (state.reason === 'recent_sync' || state.reason === 'no_baseline'),
  ],
];

/** Returns the first broken rule's label, or undefined when the state is consistent. */
export function inconsistency(
  state: BuildablesState,
  binding: BridgeBinding,
  query: BuildablesQuery,
): string | undefined {
  const context = { state, binding, query };
  return RULES.find(([, broken]) => broken(context))?.[0];
}
