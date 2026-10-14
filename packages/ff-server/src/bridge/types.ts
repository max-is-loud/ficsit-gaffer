/**
 * Live bridge types. These mirror the receiver's read-only query contract
 * (`integrations/foreman-bridge/receiver/docs/query-v1.md`); the receiver lives
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

export interface ConstructorQuery {
  includeLocations?: boolean;
  limit?: number;
  cursor?: string;
}

export type StateStatus = 'fresh' | 'last_known' | 'unavailable';
export type StateReason =
  'recent_sync' | 'stale' | 'resynchronizing' | 'receiver_restarted' | 'no_baseline';

export interface ConstructorLocation {
  entityId: string;
  /** Unreal world location `[X, Y, Z]` in centimetres. */
  position: [number, number, number];
}

export interface ConstructorState {
  protocol: 1;
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
  totalCount: number | null;
  locations: ConstructorLocation[];
  coordinateSystem: 'unreal_cm';
  returnedCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface BridgeClient {
  query(query: ConstructorQuery): Promise<ConstructorState>;
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
