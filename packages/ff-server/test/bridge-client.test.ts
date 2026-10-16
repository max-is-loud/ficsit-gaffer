import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  BRIDGE_REQUEST_TIMEOUT_MS,
  BRIDGE_RESPONSE_LIMIT_BYTES,
  createBridgeClient,
} from '../src/bridge/client.js';
import {
  BridgeQueryError,
  type BridgeBinding,
  type BuildableRow,
  type BuildablesState,
} from '../src/bridge/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const certScript = path.resolve(
  here,
  '../../../integrations/foreman-bridge/receiver/scripts/make-test-cert.sh',
);
const SERVER_ID = '00000001-0000-4000-8000-000000000001';
const WORLD_ID = '00000002-0000-4000-8000-000000000001';
const TOKEN = 'T'.repeat(40) + '_secret_query_token';
const ENTITY_A = '00000009-0000-4000-8000-00000000000a';
const ENTITY_B = '00000009-0000-4000-8000-00000000000b';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

let dir: string;
let ca: Buffer;
let cert: Buffer;
let key: Buffer;
const servers: Server[] = [];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ff-bridge-tls-'));
  execFileSync('bash', [certScript, dir, '127.0.0.1'], { stdio: 'pipe' });
  ca = readFileSync(path.join(dir, 'ca.pem'));
  cert = readFileSync(path.join(dir, 'server.pem'));
  key = readFileSync(path.join(dir, 'server-key.pem'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

interface Fixture {
  port: number;
  requests: { method?: string; url?: string; headers: IncomingMessage['headers']; body: string }[];
  closed: () => number;
}

async function serve(handler: Handler): Promise<Fixture> {
  const requests: Fixture['requests'] = [];
  let closed = 0;
  const server = createServer({ cert, key }, (req, res) => {
    const chunks: Buffer[] = [];
    res.on('close', () => {
      closed += 1;
    });
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, requests, closed: () => closed };
}

function binding(port: number, host = '127.0.0.1'): BridgeBinding {
  return {
    url: `https://${host}:${port}/`,
    queryToken: TOKEN,
    serverId: SERVER_ID,
    worldId: WORLD_ID,
    playthroughId: 'p1',
  };
}

const SMELTER =
  '/Game/FactoryGame/Buildable/Factory/SmelterMk1/Build_SmelterMk1.Build_SmelterMk1_C';
const BOX =
  '/Game/FactoryGame/Buildable/Factory/StorageContainerMk1/Build_StorageContainerMk1.Build_StorageContainerMk1_C';
const ROW_A: BuildableRow = {
  entityId: ENTITY_A,
  category: 'manufacturer',
  classPath: SMELTER,
  position: [100, -200.5, 300],
  config: {
    recipe: '/Game/FactoryGame/Recipes/Smelter/Recipe_IngotIron.Recipe_IngotIron_C',
    clockSpeed: 1,
    productionBoost: 1,
    powerShards: 0,
    somersloops: 0,
    paused: false,
  },
};
const ROW_B: BuildableRow = {
  entityId: ENTITY_B,
  category: 'storage',
  classPath: BOX,
  position: [1, 2, 3],
  config: {},
};

function state(overrides: Partial<BuildablesState> = {}): BuildablesState {
  return {
    protocol: 2,
    serverId: SERVER_ID,
    worldId: WORLD_ID,
    revision: '0000000a-0000-4000-8000-000000000001',
    epoch: '00000003-0000-4000-8000-000000000001',
    status: 'fresh',
    reason: 'recent_sync',
    lastSyncAt: 1_760_000_000_000,
    evaluatedAt: 1_760_000_004_000,
    totalCount: 7,
    rows: [ROW_A, ROW_B],
    coordinateSystem: 'unreal_cm',
    returnedCount: 2,
    hasMore: true,
    nextCursor: 'opaque-cursor_1',
    ...overrides,
  };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length });
  res.end(bytes);
}

async function rejection(promise: Promise<unknown>): Promise<BridgeQueryError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BridgeQueryError);
    return error as BridgeQueryError;
  }
  throw new Error('expected the query to be rejected');
}

describe('bridge client limits', () => {
  it('uses a five-second deadline and a 256 KiB response cap', () => {
    expect(BRIDGE_REQUEST_TIMEOUT_MS).toBe(5000);
    expect(BRIDGE_RESPONSE_LIMIT_BYTES).toBe(262144);
  });
});

describe('createBridgeClient', () => {
  it('posts the query with the read-only credential and returns a validated state', async () => {
    const fixture = await serve((_req, res) => json(res, 200, state()));
    const result = await createBridgeClient(binding(fixture.port), { ca }).query({
      includeRows: true,
      limit: 2,
    });
    expect(result).toEqual(state());
    expect(fixture.requests).toHaveLength(1);
    const [request] = fixture.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/query/v2/buildables');
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(request?.body ?? '')).toEqual({ includeRows: true, limit: 2 });
  });

  it('accepts count-only and no-baseline states', async () => {
    const countOnly = state({ rows: [], returnedCount: 0, hasMore: false, nextCursor: null });
    const noBaseline = state({
      revision: null,
      epoch: null,
      status: 'unavailable',
      reason: 'no_baseline',
      lastSyncAt: null,
      totalCount: null,
      rows: [],
      returnedCount: 0,
      hasMore: false,
      nextCursor: null,
    });
    for (const expected of [countOnly, noBaseline]) {
      const fixture = await serve((_req, res) => json(res, 200, expected));
      await expect(createBridgeClient(binding(fixture.port), { ca }).query({})).resolves.toEqual(
        expected,
      );
    }
  });

  it('verifies the certificate chain and hostname', async () => {
    const fixture = await serve((_req, res) => json(res, 200, state()));
    expect((await rejection(createBridgeClient(binding(fixture.port)).query({}))).code).toBe(
      'unavailable',
    );
    expect(
      (await rejection(createBridgeClient(binding(fixture.port, 'localhost'), { ca }).query({})))
        .code,
    ).toBe('unavailable');
    expect(fixture.requests).toHaveLength(0);
  });

  it.each([301, 302, 307, 308])('never follows a %i redirect', async (status) => {
    const sink = await serve((_req, res) => json(res, 200, state()));
    const fixture = await serve((_req, res) => {
      res.writeHead(status, { location: `https://127.0.0.1:${sink.port}/query/v2/buildables` });
      res.end();
    });
    expect(
      (await rejection(createBridgeClient(binding(fixture.port), { ca }).query({}))).code,
    ).toBe('unavailable');
    expect(sink.requests).toHaveLength(0);
  });

  it.each([
    [409, 'state_changed'],
    [400, 'invalid_query'],
    [401, 'unavailable'],
    [404, 'unavailable'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('classifies HTTP %i as %s without remote text or secrets', async (status, code) => {
    const fixture = await serve((_req, res) =>
      json(res, status, { error: 'private stack trace at /srv/secret/receiver.db' }),
    );
    const error = await rejection(createBridgeClient(binding(fixture.port), { ca }).query({}));
    expect(error.code).toBe(code);
    const visible = `${error.message} ${JSON.stringify(error)} ${String(error.stack)}`;
    expect(visible).not.toContain('secret');
    expect(visible).not.toContain(TOKEN);
  });

  const invalid: [string, string | BuildablesState | Record<string, unknown>][] = [
    ['server identity mismatch', state({ serverId: '00000001-0000-4000-8000-000000000002' })],
    ['world identity mismatch', state({ worldId: '00000002-0000-4000-8000-000000000002' })],
    [
      'non-finite coordinate',
      JSON.stringify(state()).replace('"position":[1,2,3]', '"position":[1e400,2,3]'),
    ],
    [
      'short position',
      state({
        rows: [{ ...ROW_A, position: [1, 2] as unknown as [number, number, number] }],
        returnedCount: 1,
      }),
    ],
    ['returned count mismatch', state({ returnedCount: 3 })],
    ['hasMore without cursor', state({ nextCursor: null })],
    ['cursor without hasMore', state({ hasMore: false })],
    ['returned more than total', state({ totalCount: 1 })],
    ['duplicate entity', state({ rows: [ROW_A, { ...ROW_B, entityId: ENTITY_A }] })],
    [
      'unavailable with a count',
      state({ status: 'unavailable', reason: 'no_baseline', totalCount: 0 }),
    ],
    [
      'unavailable with revision',
      state({
        status: 'unavailable',
        reason: 'no_baseline',
        totalCount: null,
        rows: [],
        returnedCount: 0,
        hasMore: false,
        nextCursor: null,
        lastSyncAt: null,
        epoch: null,
      }),
    ],
    ['fresh with stale reason', state({ reason: 'stale' })],
    ['last known with recent reason', state({ status: 'last_known', reason: 'recent_sync' })],
    ['fresh without sync time', state({ lastSyncAt: null })],
    ['committed state without count', state({ totalCount: null })],
    ['negative count', state({ totalCount: -1 })],
    ['unknown field', { ...state(), extra: true }],
    ['missing field', (({ coordinateSystem: _c, ...rest }) => rest)(state())],
    ['wrong protocol', { ...state(), protocol: 1 }],
    [
      'manufacturer config carrying a fuel',
      state({
        rows: [{ ...ROW_A, config: { ...ROW_A.config, fuel: null } } as BuildableRow, ROW_B],
      }),
    ],
    [
      'storage row with a manufacturer config',
      state({ rows: [ROW_A, { ...ROW_B, config: ROW_A.config }] }),
    ],
    [
      'unknown category',
      state({ rows: [ROW_A, { ...ROW_B, category: 'decor' } as unknown as BuildableRow] }),
    ],
    [
      'bad purity',
      state({
        rows: [
          {
            entityId: ENTITY_A,
            category: 'extractor',
            classPath: SMELTER,
            position: [0, 0, 0],
            config: {
              resource: null,
              purity: 'great',
              node: null,
              clockSpeed: 1,
              powerShards: 0,
              paused: false,
            },
          } as unknown as BuildableRow,
          ROW_B,
        ],
      }),
    ],
    ['groups nobody asked for', state({ groups: [{ key: 'manufacturer', count: 1 }] })],
    ['not JSON', '<html>proxy error</html>'],
    ['JSON array', '[]'],
  ];
  it.each(invalid)('rejects %s as an invalid response', async (_label, body) => {
    const fixture = await serve((_req, res) => json(res, 200, body));
    const error = await rejection(
      createBridgeClient(binding(fixture.port), { ca }).query({ includeRows: true }),
    );
    expect(error.code).toBe('invalid_response');
  });

  it('accepts one valid row per category with groups when grouped', async () => {
    const extractor: BuildableRow = {
      entityId: '00000009-0000-4000-8000-00000000000c',
      category: 'extractor',
      classPath: '/Game/Build_MinerMk1.Build_MinerMk1_C',
      position: [0, 0, 0],
      config: {
        resource: null,
        purity: 'pure',
        node: null,
        clockSpeed: 2.5,
        powerShards: 3,
        paused: true,
      },
    };
    const generator: BuildableRow = {
      entityId: '00000009-0000-4000-8000-00000000000d',
      category: 'generator',
      classPath: '/Game/Build_GeneratorCoal.Build_GeneratorCoal_C',
      position: [0, 0, 0],
      config: { fuel: null, clockSpeed: null, powerShards: null, paused: null },
    };
    const expected = state({
      rows: [ROW_A, ROW_B, extractor, generator],
      returnedCount: 4,
      groups: [{ key: null, count: 7 }],
    });
    const fixture = await serve((_req, res) => json(res, 200, expected));
    const query = { includeRows: true, limit: 4, groupBy: 'recipe' as const };
    await expect(createBridgeClient(binding(fixture.port), { ca }).query(query)).resolves.toEqual(
      expected,
    );
    expect(JSON.parse(fixture.requests[0]?.body ?? '')).toEqual(query);
  });

  it('accepts a distance page with more rows and no cursor', async () => {
    const expected = state({
      rows: [
        { ...ROW_A, distanceMetres: 0 },
        { ...ROW_B, distanceMetres: 12.5 },
      ],
      nextCursor: null,
    });
    const fixture = await serve((_req, res) => json(res, 200, expected));
    const query = { includeRows: true, limit: 2, from: [0, 0, 0] as [number, number, number] };
    await expect(createBridgeClient(binding(fixture.port), { ca }).query(query)).resolves.toEqual(
      expected,
    );
    expect(JSON.parse(fixture.requests[0]?.body ?? '')).toEqual(query);
  });

  it('rejects more locations than requested and locations on a count-only query', async () => {
    const fixture = await serve((_req, res) => json(res, 200, state()));
    const client = createBridgeClient(binding(fixture.port), { ca });
    expect((await rejection(client.query({ includeRows: true, limit: 1 }))).code).toBe(
      'invalid_response',
    );
    expect((await rejection(client.query({}))).code).toBe('invalid_response');
  });

  it('rejects invalid UTF-8', async () => {
    const fixture = await serve((_req, res) => {
      const bytes = Buffer.concat([
        Buffer.from('{"protocol":1,"x":"'),
        Buffer.from([0xc0, 0x80]),
        Buffer.from('"}'),
      ]);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': bytes.length });
      res.end(bytes);
    });
    expect(
      (await rejection(createBridgeClient(binding(fixture.port), { ca }).query({}))).code,
    ).toBe('invalid_response');
  });

  it('rejects a declared oversized body without reading it', async () => {
    const fixture = await serve((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': BRIDGE_RESPONSE_LIMIT_BYTES + 1,
      });
      res.write('{');
    });
    expect(
      (await rejection(createBridgeClient(binding(fixture.port), { ca }).query({}))).code,
    ).toBe('invalid_response');
  });

  it('counts streamed bytes, including multibyte characters, and cancels the body', async () => {
    const chars = Math.floor(BRIDGE_RESPONSE_LIMIT_BYTES / 2) + 1; // fewer characters than the cap, more bytes
    const fixture = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(`{"pad":"${'é'.repeat(chars)}`);
    });
    const error = await rejection(createBridgeClient(binding(fixture.port), { ca }).query({}));
    expect(error.code).toBe('invalid_response');
    await expect.poll(() => fixture.closed()).toBe(1);
  });

  it('applies one deadline to slow headers without retrying', async () => {
    const fixture = await serve(() => {
      /* never respond */
    });
    const started = performance.now();
    const error = await rejection(
      createBridgeClient(binding(fixture.port), { ca, timeoutMs: 300 }).query({}),
    );
    expect(error.code).toBe('unavailable');
    expect(performance.now() - started).toBeLessThan(2000);
    expect(fixture.requests).toHaveLength(1);
  });

  it('applies the same deadline to a slow body and cancels it', async () => {
    const fixture = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"protocol":1,');
      const drip = setInterval(() => res.write(' '), 50);
      res.on('close', () => clearInterval(drip));
    });
    const started = performance.now();
    const error = await rejection(
      createBridgeClient(binding(fixture.port), { ca, timeoutMs: 400 }).query({}),
    );
    expect(error.code).toBe('unavailable');
    expect(performance.now() - started).toBeLessThan(2000);
    await expect.poll(() => fixture.closed()).toBe(1);
    expect(fixture.requests).toHaveLength(1);
  });

  it('reports an unreachable receiver as unavailable', async () => {
    const fixture = await serve((_req, res) => json(res, 200, state()));
    const port = fixture.port;
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    expect((await rejection(createBridgeClient(binding(port), { ca }).query({}))).code).toBe(
      'unavailable',
    );
  });
});
