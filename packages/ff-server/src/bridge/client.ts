// HTTPS client for the live bridge receiver's read-only buildables query. It validates each
// response against the v2 contract (responseSchema.ts) and the configured binding, and turns
// every failure into a classified BridgeQueryError.

import { request } from 'node:https';

import { inconsistency, stateSchema } from './responseSchema.js';
import {
  BridgeQueryError,
  type BridgeBinding,
  type BridgeClient,
  type BuildablesQuery,
  type BuildablesState,
} from './types.js';

/** One deadline for the whole request: connect, TLS, headers and body. */
export const BRIDGE_REQUEST_TIMEOUT_MS = 5000;
export const BRIDGE_RESPONSE_LIMIT_BYTES = 256 * 1024;
const QUERY_PATH = 'query/v2/buildables';
const QUERY_KEYS = ['filter', 'groupBy', 'from', 'includeRows', 'limit', 'cursor'] as const;

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
function requestBody(query: BuildablesQuery): string {
  const body: Record<string, unknown> = {};
  for (const key of QUERY_KEYS) {
    if (query[key] !== undefined) {
      body[key] = query[key];
    }
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

  function send(query: BuildablesQuery): Promise<Buffer> {
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
    async query(query: BuildablesQuery): Promise<BuildablesState> {
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
      const state = parsed.data as BuildablesState;
      const problem = inconsistency(state, binding, query);
      if (problem !== undefined) {
        throw new BridgeQueryError('invalid_response', problem);
      }
      return state;
    },
  };
}
