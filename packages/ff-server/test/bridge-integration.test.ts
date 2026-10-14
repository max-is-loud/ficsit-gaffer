import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import type { Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBridgeClient } from '../src/bridge/client.js';
import type { BridgeBinding } from '../src/bridge/types.js';
import { handleLiveStateTool, type LiveStateService } from '../src/tools/liveStateTools.js';

/**
 * Drives the REAL receiver (HTTPS ingestion + read-only query, disposable SQLite
 * and TLS) into the real backend client and live tool. The receiver sits outside
 * the npm workspace and needs Node >= 24 (node:sqlite); this is protocol traffic,
 * not evidence of the real game or web-chat path.
 */
const receiverRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../integrations/foreman-bridge/receiver',
);
const nodeMajor = Number(process.versions.node.split('.')[0]);

interface Row {
  entityId: string;
  actorPath: string;
  classPath: string;
  transform: { position: number[]; rotation: number[]; scale: number[] };
  player: null;
}
interface ReceiverStore {
  close(): void;
}
interface Clock {
  utcNow(): number;
  monotonicNow(): number;
}

function row(position: [number, number, number]): Row {
  const entityId = randomUUID();
  return {
    entityId,
    actorPath: `/Game/Constructor_${entityId}`,
    classPath: '/Game/Build_ConstructorMk1',
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
    player: null,
  };
}

describe.skipIf(nodeMajor < 24)('live bridge end-to-end over the real receiver', () => {
  let dir: string;
  let ca: Buffer;
  let server: Server;
  let store: ReceiverStore;
  let port: number;
  let utc = Date.UTC(2026, 9, 14, 12, 0, 0);
  let mono = 1_000;
  const clock: Clock = { utcNow: () => utc, monotonicNow: () => mono };
  const advance = (ms: number): void => {
    utc += ms;
    mono += ms;
  };
  const producerToken = randomBytes(32).toString('hex');
  const queryToken = randomBytes(32).toString('hex');
  const serverId = randomUUID();
  const worldId = randomUUID();
  const context: Record<string, unknown> = { protocol: 1, serverId, worldId, epoch: randomUUID() };
  let seq = 0;
  let snapshotDigest: (chunks: Uint8Array[]) => string;
  let live: LiveStateService;

  function post(
    route: string,
    body: unknown,
    token = producerToken,
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: route,
          method: 'POST',
          ca,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }
  const envelope = (extra: Record<string, unknown>): Record<string, unknown> => ({
    ...context,
    requestId: randomUUID(),
    ...extra,
  });
  async function ingest(
    route: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await post(route, body);
    expect(response.status).toBe(200);
    return response.body as Record<string, unknown>;
  }
  async function exchange(events: unknown[]): Promise<void> {
    await ingest('/v1/exchange', envelope({ events, commandResults: [] }));
  }
  async function tool(
    args: Record<string, unknown> = {},
  ): Promise<{ isError: boolean; body: Record<string, unknown>; text: string }> {
    const result = await handleLiveStateTool('linked-playthrough', args, live);
    return {
      isError: result.isError,
      text: result.text,
      body: result.isError ? {} : (JSON.parse(result.text) as Record<string, unknown>),
    };
  }

  async function startReceiver(databasePath: string): Promise<void> {
    const { openStore } = (await import(path.join(receiverRoot, 'src/store.mjs'))) as {
      openStore(p: string, o: { clock: Clock }): ReceiverStore;
    };
    const { createReceiver } = (await import(path.join(receiverRoot, 'src/server.mjs'))) as {
      createReceiver(config: Record<string, unknown>, s: ReceiverStore): Server;
    };
    store = openStore(databasePath, { clock });
    server = createReceiver(
      {
        token: producerToken,
        queryToken,
        serverId,
        worldId,
        cert: readFileSync(path.join(dir, 'server.pem')),
        key: readFileSync(path.join(dir, 'server-key.pem')),
        host: '127.0.0.1',
        port: 0,
        requestTimeoutMs: 2000,
      },
      store,
    );
    server.listen(port ?? 0, '127.0.0.1');
    await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
  }
  async function stopReceiver(): Promise<void> {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'ff-bridge-e2e-'));
    execFileSync('bash', [path.join(receiverRoot, 'scripts/make-test-cert.sh'), dir, '127.0.0.1'], {
      stdio: 'pipe',
    });
    ca = readFileSync(path.join(dir, 'ca.pem'));
    ({ snapshotDigest } = (await import(path.join(receiverRoot, 'src/protocol.mjs'))) as {
      snapshotDigest(chunks: Uint8Array[]): string;
    });
    await startReceiver(path.join(dir, 'receiver.db'));
    const binding: BridgeBinding = {
      url: `https://127.0.0.1:${port}/`,
      queryToken,
      serverId,
      worldId,
      playthroughId: 'linked-playthrough',
    };
    live = { binding, client: createBridgeClient(binding, { ca }) };
  });
  afterAll(async () => {
    await stopReceiver().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it('follows baseline, placement, removal, staleness, recovery and outage', async () => {
    // Before any snapshot: unknown, not zero.
    let state = await tool();
    expect(state.body).toMatchObject({
      status: 'unavailable',
      reason: 'no_baseline',
      totalConstructors: 'unknown',
    });

    // Baseline N = 2 via hello + one-chunk snapshot.
    const hello = await ingest(
      '/v1/hello',
      (({ connectionId: _c, ...rest }) => rest)(
        envelope({
          latestSeq: '0',
          oldestRetainedSeq: '0',
          provenance: {
            gameVersion: '1',
            smlVersion: '1',
            bridgeVersion: '1',
            starterCommit: 'a'.repeat(40),
            bridgeSourceSha256: 'b'.repeat(64),
          },
        }),
      ),
    );
    context.connectionId = hello.connectionId;
    const a = row([100000, -50000, 200]);
    const b = row([100600, -50000, 200]);
    const rows = [a, b].sort((x, y) => (x.entityId < y.entityId ? -1 : 1));
    const data = rows.map((r) => `${JSON.stringify(r)}\n`).join('');
    const snapshotId = randomUUID();
    await ingest('/v1/snapshot/chunk', envelope({ snapshotId, chunkIndex: 0, data }));
    await ingest(
      '/v1/snapshot/commit',
      envelope({
        snapshotId,
        watermark: '0',
        chunkCount: 1,
        rowCount: 2,
        sha256: snapshotDigest([Buffer.from(data)]),
      }),
    );
    state = await tool({ includeLocations: true });
    expect(state.body).toMatchObject({
      status: 'fresh',
      totalConstructors: 2,
      returnedLocations: 2,
      locationsComplete: true,
    });

    // Place -> N + 1, with the recorded position.
    const c = row([-12345, 67890, 300]);
    seq += 1;
    await exchange([
      {
        seq: String(seq),
        type: 'constructor.upsert',
        entityId: c.entityId,
        row: c,
        origin: 'placed',
      },
    ]);
    state = await tool({ includeLocations: true });
    expect(state.body.totalConstructors).toBe(3);
    expect(state.body.locations).toContainEqual({
      entityId: c.entityId,
      positionCm: [-12345, 67890, 300],
      positionMetres: [-123.45, 678.9, 3],
    });

    // Pagination: exact total independent of the page, explicit partial flag.
    state = await tool({ includeLocations: true, limit: 1 });
    expect(state.body).toMatchObject({
      totalConstructors: 3,
      returnedLocations: 1,
      locationsComplete: false,
    });
    const cursor = state.body.nextCursor as string;

    // Remove -> N, and the old cursor is now classified as state-changed.
    seq += 1;
    await exchange([
      { seq: String(seq), type: 'constructor.remove', entityId: a.entityId, origin: 'placed' },
    ]);
    expect((await tool()).body.totalConstructors).toBe(2);
    const changed = await tool({ includeLocations: true, cursor });
    expect(changed.isError).toBe(true);
    expect(changed.text).toMatch(/changed between pages/);
    const forged = await tool({ includeLocations: true, cursor: 'not-a-receiver-cursor' });
    expect(forged.isError).toBe(true);
    expect(forged.text).toMatch(/without a cursor/);

    // Stale at exactly 15 000 ms without synchronisation; queries do not refresh it.
    const syncedAt = new Date(utc).toISOString();
    advance(14_999);
    expect((await tool()).body.status).toBe('fresh');
    advance(1);
    state = await tool();
    expect(state.body).toMatchObject({
      status: 'last_known',
      reason: 'stale',
      lastSyncAt: syncedAt,
      totalConstructors: 2,
    });
    expect((await tool()).body.status).toBe('last_known');

    // An accepted idle exchange restores freshness.
    await exchange([]);
    expect((await tool()).body).toMatchObject({
      status: 'fresh',
      lastSyncAt: new Date(utc).toISOString(),
    });

    // The read-only credential cannot ingest.
    expect(
      (await post('/v1/exchange', envelope({ events: [], commandResults: [] }), queryToken)).status,
    ).toBe(401);

    // Receiver restart: persisted state is last known until synchronisation resumes.
    await stopReceiver();
    const outage = await tool();
    expect(outage.isError).toBe(true);
    expect(outage.text).toMatch(/unavailable/i);
    await startReceiver(path.join(dir, 'receiver.db'));
    state = await tool();
    expect(state.body).toMatchObject({
      status: 'last_known',
      reason: 'receiver_restarted',
      totalConstructors: 2,
    });
    const resumed = await ingest(
      '/v1/hello',
      (({ connectionId: _c, ...rest }) => rest)(
        envelope({
          latestSeq: String(seq),
          oldestRetainedSeq: String(seq),
          provenance: {
            gameVersion: '1',
            smlVersion: '1',
            bridgeVersion: '1',
            starterCommit: 'a'.repeat(40),
            bridgeSourceSha256: 'b'.repeat(64),
          },
        }),
      ),
    );
    expect(resumed.mode).toBe('resume');
    context.connectionId = resumed.connectionId;
    expect((await tool()).body.reason).toBe('receiver_restarted');
    await exchange([]);
    expect((await tool()).body).toMatchObject({ status: 'fresh', totalConstructors: 2 });
  });
});
