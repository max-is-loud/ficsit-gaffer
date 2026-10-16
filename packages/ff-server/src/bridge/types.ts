/**
 * Live bridge types. These mirror the receiver's read-only query contract
 * (`integrations/foreman-bridge/receiver/docs/query-v2.md`); the receiver lives
 * outside the npm workspace, so the contract is reproduced here and validated at
 * runtime rather than imported.
 */

/**
 * Private operator configuration binding one receiver/server/world to one
 * playthrough. Never serialised to the browser, the model or logs.
 */
export interface BridgeBinding {
  /** Receiver origin with a root path, e.g. `https://receiver.example:9443/`. */
  url: string;
  /** Read-only receiver credential (cannot ingest). */
  queryToken: string;
  serverId: string;
  worldId: string;
  /** The single Foreman playthrough allowed to see this world's observations. */
  playthroughId: string;
}

export type BuildableCategory = 'manufacturer' | 'extractor' | 'generator' | 'storage';
export type Purity = 'impure' | 'normal' | 'pure';

/** Per-category configuration; every field is `null` when the game could not say. */
export interface ManufacturerConfig {
  recipe: string | null;
  /** Current potential: 1 = 100 %. */
  clockSpeed: number | null;
  productionBoost: number | null;
  powerShards: number | null;
  somersloops: number | null;
  paused: boolean | null;
}
export interface ExtractorConfig {
  resource: string | null;
  purity: Purity | null;
  node: string | null;
  clockSpeed: number | null;
  powerShards: number | null;
  paused: boolean | null;
}
export interface GeneratorConfig {
  fuel: string | null;
  clockSpeed: number | null;
  powerShards: number | null;
  paused: boolean | null;
}
export type StorageConfig = Record<string, never>;
export type BuildableConfig =
  ManufacturerConfig | ExtractorConfig | GeneratorConfig | StorageConfig;

export interface BuildableRow {
  entityId: string;
  category: BuildableCategory;
  /** Full Unreal class path; its final `.` segment is the class name. */
  classPath: string;
  /** Unreal world location `[X, Y, Z]` in centimetres. */
  position: [number, number, number];
  config: BuildableConfig;
  /** Distance mode only, rounded to 0.1 m. */
  distanceMetres?: number;
}

export interface BuildablesFilter {
  category?: BuildableCategory;
  /** Exact class name, e.g. `Build_SmelterMk1_C`. */
  className?: string;
  /** Exact recipe class name, e.g. `Recipe_IngotIron_C`. */
  recipeName?: string;
}

export type BuildablesGroupBy = 'category' | 'class' | 'recipe';

export interface BuildablesQuery {
  filter?: BuildablesFilter;
  groupBy?: BuildablesGroupBy;
  /** Centimetres; switches to one distance-sorted page. */
  from?: [number, number, number];
  includeRows?: boolean;
  limit?: number;
  cursor?: string;
}

export type StateStatus = 'fresh' | 'last_known' | 'unavailable';
export type StateReason =
  'recent_sync' | 'stale' | 'resynchronizing' | 'receiver_restarted' | 'no_baseline';

export interface BuildablesState {
  protocol: 2;
  serverId: string;
  worldId: string;
  revision: string | null;
  epoch: string | null;
  status: StateStatus;
  reason: StateReason;
  /** UTC epoch milliseconds of the receiver's last accepted synchronization. */
  lastSyncAt: number | null;
  /** UTC epoch milliseconds when the receiver evaluated `status`. */
  evaluatedAt: number;
  /** Exact count matching the filter. */
  totalCount: number | null;
  /** Present only when the query set `groupBy`; recipe-less buildables group under `null`. */
  groups?: { key: string | null; count: number }[];
  rows: BuildableRow[];
  coordinateSystem: 'unreal_cm';
  returnedCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface BridgeClient {
  query(query: BuildablesQuery): Promise<BuildablesState>;
}

/**
 * `unavailable`: transport, TLS, redirect, timeout or non-success status.
 * `invalid_response`: the receiver answered with something outside the contract.
 * `state_changed`: a continuation cursor's revision is no longer current.
 * `invalid_query`: the receiver rejected the query (e.g. a cursor it did not issue).
 */
export type BridgeQueryErrorCode =
  'unavailable' | 'invalid_response' | 'state_changed' | 'invalid_query';

/** A classified failure. `detail` is a fixed internal label, never remote text. */
export class BridgeQueryError extends Error {
  public readonly code: BridgeQueryErrorCode;
  public readonly detail: string;

  public constructor(code: BridgeQueryErrorCode, detail: string) {
    super(`Live bridge query failed: ${code} (${detail})`);
    this.name = 'BridgeQueryError';
    this.code = code;
    this.detail = detail;
  }
}
