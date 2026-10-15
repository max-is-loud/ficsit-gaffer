// HTTPS client for the live bridge receiver's read-only Constructor query. It validates each
// response against a strict schema and the configured binding, and turns every failure into a
// classified BridgeQueryError.

import { request } from 'node:https';

import { z } from 'zod';

import {
  BridgeQueryError,
  type BridgeBinding,
  type BridgeClient,
  type ConstructorQuery,
  type ConstructorState,
} from './types.js';

/** One deadline for the whole request: connect, TLS, headers and body. */
export const BRIDGE_REQUEST_TIMEOUT_MS = 5000;
export const BRIDGE_RESPONSE_LIMIT_BYTES = 256 * 1024;
const QUERY_PATH = 'query/v1/constructors';
const MAX_LOCATIONS = 100;
const DEFAULT_LIMIT = 50;

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const timestamp = z.number().int().nonnegative();
const stateSchema = z.strictObject({
  protocol: z.literal(1),
  serverId: id,
  worldId: id,
  revision: id.nullable(),
  epoch: id.nullable(),
  status: z.enum(['fresh', 'last_known', 'unavailable']),
  reason: z.enum(['recent_sync', 'stale', 'resynchronizing', 'receiver_restarted', 'no_baseline']),
  lastSyncAt: timestamp.nullable(),
  evaluatedAt: timestamp,
  totalCount: z.number().int().nonnegative().nullable(),
  locations: z
    .array(
      z.strictObject({ entityId: id, position: z.tuple([z.number(), z.number(), z.number()]) }),
    )
    .max(MAX_LOCATIONS),
  coordinateSystem: z.literal('unreal_cm'),
  returnedCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextCursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,1024}$/)
    .nullable(),
});

/** Cross-field rules the schema alone cannot express. Returns a detail label or undefined. */
function inconsistency(
  state: ConstructorState,
  binding: BridgeBinding,
  query: ConstructorQuery,
): string | undefined {
  if (state.serverId !== binding.serverId || state.worldId !== binding.worldId) {
    return 'identity_mismatch';
  }
  if (
    state.returnedCount !== state.locations.length ||
    state.hasMore !== (state.nextCursor !== null)
  ) {
    return 'page_flags';
  }
  if (
    new Set(state.locations.map((location) => location.entityId)).size !== state.locations.length
  ) {
    return 'duplicate_entity';
  }
  if (query.includeLocations !== true && (state.locations.length > 0 || state.hasMore)) {
    return 'unrequested_locations';
  }
  if (state.locations.length > (query.limit ?? DEFAULT_LIMIT)) {
    return 'page_limit';
  }
  if (state.status === 'unavailable') {
    const empty =
      state.reason === 'no_baseline' &&
      state.revision === null &&
      state.epoch === null &&
      state.lastSyncAt === null &&
      state.totalCount === null &&
      state.locations.length === 0 &&
      !state.hasMore;
    return empty ? undefined : 'unavailable_shape';
  }
  if (state.revision === null || state.epoch === null || state.totalCount === null) {
    return 'committed_shape';
  }
  if (state.locations.length > state.totalCount) {
    return 'count_bound';
  }
  if (state.status === 'fresh' && (state.reason !== 'recent_sync' || state.lastSyncAt === null)) {
    return 'fresh_shape';
  }
  if (
    state.status === 'last_known' &&
    (state.reason === 'recent_sync' || state.reason === 'no_baseline')
  ) {
    return 'last_known_shape';
  }
  return undefined;
}

function classifyStatus(status: number): BridgeQueryError {
  if (status === 409) {
    return new BridgeQueryError('state_changed', 'http_409');
  }
  if (status === 400) {
    return new BridgeQueryError('invalid_query', 'http_400');
  }
  // Redirects are never followed: a credential must not reach another endpoint.
  return new BridgeQueryError('unavailable', `http_${status}`);
}

/** Only known query fields are forwarded; the client never adds identities. */
function requestBody(query: ConstructorQuery): string {
  const body: ConstructorQuery = {};
  if (query.includeLocations !== undefined) {
    body.includeLocations = query.includeLocations;
  }
  if (query.limit !== undefined) {
    body.limit = query.limit;
  }
  if (query.cursor !== undefined) {
    body.cursor = query.cursor;
  }
  return JSON.stringify(body);
}

export interface BridgeClientOptions {
  /** Extra trusted CA for the receiver; otherwise Node's store (incl. NODE_EXTRA_CA_CERTS). */
  ca?: string | Buffer;
  /** Total request deadline; defaults to {@link BRIDGE_REQUEST_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * A bounded HTTPS client for the receiver's read-only query. TLS is always
 * verified, redirects are never followed, one deadline covers the whole
 * exchange, the body is capped while streaming, and every failure is a
 * classified {@link BridgeQueryError}. There are no automatic retries.
 */
export function createBridgeClient(
  binding: BridgeBinding,
  options: BridgeClientOptions = {},
): BridgeClient {
  const target = new URL(QUERY_PATH, binding.url);
  const timeoutMs = options.timeoutMs ?? BRIDGE_REQUEST_TIMEOUT_MS;

  function send(query: ConstructorQuery): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const body = Buffer.from(requestBody(query));
      let settled = false;
      const fail = (error: BridgeQueryError): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          req.destroy();
          reject(error);
        }
      };
      const req = request(
        target,
        {
          method: 'POST',
          agent: false,
          ...(options.ca !== undefined ? { ca: options.ca } : {}),
          headers: {
            authorization: `Bearer ${binding.queryToken}`,
            'content-type': 'application/json',
            'content-length': body.length,
            accept: 'application/json',
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status !== 200) {
            res.resume();
            fail(classifyStatus(status));
            return;
          }
          const declared = Number(res.headers['content-length'] ?? 0);
          if (declared > BRIDGE_RESPONSE_LIMIT_BYTES) {
            fail(new BridgeQueryError('invalid_response', 'response_too_large'));
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          res.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > BRIDGE_RESPONSE_LIMIT_BYTES) {
              fail(new BridgeQueryError('invalid_response', 'response_too_large'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(Buffer.concat(chunks, length));
            }
          });
          res.on('error', () => fail(new BridgeQueryError('unavailable', 'response_stream')));
        },
      );
      const timer = setTimeout(
        () => fail(new BridgeQueryError('unavailable', 'timeout')),
        timeoutMs,
      );
      // Transport/TLS errors carry local detail (hostnames, cert text); keep only the class.
      req.on('error', () => fail(new BridgeQueryError('unavailable', 'transport')));
      req.end(body);
    });
  }

  return {
    async query(query: ConstructorQuery): Promise<ConstructorState> {
      const bytes = await send(query);
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        throw new BridgeQueryError('invalid_response', 'json');
      }
      const parsed = stateSchema.safeParse(value);
      if (!parsed.success) {
        throw new BridgeQueryError('invalid_response', 'schema');
      }
      const state = parsed.data as ConstructorState;
      const problem = inconsistency(state, binding, query);
      if (problem !== undefined) {
        throw new BridgeQueryError('invalid_response', problem);
      }
      return state;
    },
  };
}
