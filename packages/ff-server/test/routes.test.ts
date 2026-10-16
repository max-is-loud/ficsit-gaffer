import { emptyGameData } from '@foreman/sf-game-data';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { resolveServerConfig } from '../src/config.js';
import type { BridgeClient, BuildablesQuery } from '../src/bridge/types.js';
import type { AppDeps } from '../src/deps.js';
import type { McpGateway } from '../src/mcp/client.js';
import { SummaryService } from '../src/llm/summary.js';
import type { LlmProvider, LlmProviderFactory } from '../src/llm/provider.js';
import { ForemanService } from '../src/services/foremanService.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { SaveService } from '../src/services/saveService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { LIVE_BUILDABLES_TOOL, type LiveStateService } from '../src/tools/liveStateTools.js';
import { createGameNames } from '../src/bridge/gameNames.js';
import { createTestDb, createTestForeman, createTestPlaythrough, type TestDb } from './helpers.js';

let saveDir: string;

let db: TestDb;
let server: Server;
let baseUrl: string;
// Hoisted so a test can spy on it to assert the effective history window.
let playthroughs: PlaythroughService;
// Cookie for the default signed-in user; threaded through every request.
let cookie: string;

// The single playthrough the live bridge is bound to; created directly in the db.
const LINKED_ID = `live-linked-${randomUUID()}`;
const LIVE_TOKEN = 'route-test-query-token-0123456789abcdef';
const liveCalls: BuildablesQuery[] = [];
const liveClient: BridgeClient = {
  query: async (query) => {
    liveCalls.push(query);
    return {
      protocol: 2,
      serverId: '00000001-0000-4000-8000-000000000001',
      worldId: '00000002-0000-4000-8000-000000000001',
      revision: '0000000a-0000-4000-8000-000000000001',
      epoch: '00000003-0000-4000-8000-000000000001',
      status: 'fresh',
      reason: 'recent_sync',
      lastSyncAt: 1_760_000_000_000,
      evaluatedAt: 1_760_000_001_000,
      totalCount: 2,
      rows: [],
      coordinateSystem: 'unreal_cm',
      returnedCount: 0,
      hasMore: false,
      nextCursor: null,
    };
  },
};
const liveState: LiveStateService = {
  client: liveClient,
  names: createGameNames(emptyGameData('test')),
  binding: {
    url: 'https://receiver.example:9443/',
    queryToken: LIVE_TOKEN,
    serverId: '00000001-0000-4000-8000-000000000001',
    worldId: '00000002-0000-4000-8000-000000000001',
    playthroughId: LINKED_ID,
  },
};
/** Per-request provider; tests may swap it to script tool calls. */
let makeProvider: () => LlmProvider = () => ({
  runTurn: async () => ({ text: '', toolCalls: [], stopReason: 'stop' }),
  complete: async () => '',
});

const stubMcp: McpGateway = {
  gameVersion: '1.2.3.0',
  listTools: async () => [],
  callTool: async () => ({ text: '', isError: false }),
};

const workOrderBody = {
  title: 'Iron Plate Line',
  goal: 'Make 20 plates per minute.',
  buildSteps: [{ title: 'Place constructors' }],
  expectedOutputs: [{ kind: 'item', item: 'Iron Plate', perMinute: 20 }],
};

/** Joins a response's Set-Cookie headers into a single Cookie request header. */
function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** Creates an account and returns its session cookie. */
async function signUp(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test Pioneer', email, password: 'password1234' }),
  });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

function authHeaders(c: string = cookie): Record<string, string> {
  return { 'content-type': 'application/json', cookie: c };
}

beforeAll(async () => {
  db = await createTestDb();
  saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-saves-test-'));
  playthroughs = new PlaythroughService(db.prisma);
  const stubFactory: LlmProviderFactory = () => makeProvider();
  const deps: AppDeps = {
    config: resolveServerConfig({}),
    auth: createAuth(db.prisma),
    foremen: new ForemanService(db.prisma),
    playthroughs,
    saves: new SaveService(db.prisma, stubMcp, saveDir, new WorkOrderService(db.prisma)),
    workOrders: new WorkOrderService(db.prisma),
    mcp: stubMcp,
    summary: new SummaryService(playthroughs, { historyWindow: 20 }, stubFactory),
    llmProviderFactory: stubFactory,
    systemPromptTemplate: 'Prompt {{PERSONALITY}} {{PIONEER_PROFILE}} {{SESSION_SUMMARY}}',
    liveState,
  };
  const app = buildApp(deps);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cookie = await signUp('default@example.com');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.cleanup();
  fs.rmSync(saveDir, { recursive: true, force: true });
});

/** Creates a foreman for the caller, returning its id. */
async function createForeman(
  c: string = cookie,
  body: unknown = { name: 'ADA', personality: 'Calm' },
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/foremen`, {
    method: 'POST',
    headers: authHeaders(c),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Creates a playthrough for the caller, minting a foreman first unless given. */
async function createPlaythrough(
  body: Record<string, unknown> = {},
  c: string = cookie,
): Promise<{ id: string }> {
  const foremanId = (body.foremanId as string | undefined) ?? (await createForeman(c));
  const res = await fetch(`${baseUrl}/api/playthroughs`, {
    method: 'POST',
    headers: authHeaders(c),
    body: JSON.stringify({ foremanId, ...body }),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string }>;
}

describe('HTTP routes', () => {
  it('reports health without authentication', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; gameVersion: string };
    expect(body.status).toBe('ok');
    expect(body.gameVersion).toBe('1.2.3.0');
  });

  it('rejects unauthenticated API access with 401', async () => {
    const res = await fetch(`${baseUrl}/api/playthroughs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('creates a foreman and lists it', async () => {
    const id = await createForeman();
    const list = await fetch(`${baseUrl}/api/foremen`, { headers: authHeaders() });
    expect(list.status).toBe(200);
    const foremen = (await list.json()) as { id: string }[];
    expect(foremen.some((f) => f.id === id)).toBe(true);
  });

  it('creates and updates a playthrough', async () => {
    const playthrough = await createPlaythrough({ name: 'Iron World' });
    const res = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ pioneerProfile: 'Veteran' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { name: string; pioneerProfile: string };
    expect(updated.name).toBe('Iron World');
    expect(updated.pioneerProfile).toBe('Veteran');
  });

  it('rejects an empty playthrough update', async () => {
    const playthrough = await createPlaythrough();
    const res = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects creating a playthrough with another user's foreman", async () => {
    const otherCookie = await signUp('foreman-owner@example.com');
    const foreignForeman = await createForeman(otherCookie);
    const res = await fetch(`${baseUrl}/api/playthroughs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ foremanId: foreignForeman }),
    });
    expect(res.status).toBe(403);
  });

  it("forbids access to another user's playthrough with 403", async () => {
    const playthrough = await createPlaythrough();
    const otherCookie = await signUp('intruder@example.com');
    const res = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}`, {
      headers: authHeaders(otherCookie),
    });
    expect(res.status).toBe(403);
  });

  it('claims a pre-accounts anonymous playthrough on first login', async () => {
    // A playthrough left behind before accounts existed has a null owner; it
    // still needs a foreman, so seed an anonymous one alongside it.
    const foremanId = await createTestForeman(db.prisma, null);
    const anon = await db.prisma.playthrough.create({
      data: { id: 'anon-claim-1', foremanId },
    });
    const claim = await fetch(`${baseUrl}/api/playthroughs/${anon.id}/claim`, {
      method: 'POST',
      headers: authHeaders(),
    });
    expect(claim.status).toBe(200);
    // Now owned: a plain read succeeds.
    const read = await fetch(`${baseUrl}/api/playthroughs/${anon.id}`, { headers: authHeaders() });
    expect(read.status).toBe(200);
  });

  it('refuses to claim a playthrough owned by another user with 403', async () => {
    const playthrough = await createPlaythrough();
    const otherCookie = await signUp('claimant@example.com');
    const claim = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/claim`, {
      method: 'POST',
      headers: authHeaders(otherCookie),
    });
    expect(claim.status).toBe(403);
  });

  it('creates a new order, lists it, then starts it to become active', async () => {
    const playthrough = await createPlaythrough();
    const create = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/work-orders`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(workOrderBody),
    });
    expect(create.status).toBe(201);
    const order = (await create.json()) as {
      id: string;
      sequenceNumber: number;
      version: string;
      state: string;
    };
    expect(order.sequenceNumber).toBe(1);
    expect(order.version).toBe('1.2.3.0');
    expect(order.state).toBe('new');

    const list = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/work-orders`, {
      headers: authHeaders(),
    });
    expect(((await list.json()) as unknown[]).length).toBe(1);

    const start = await fetch(
      `${baseUrl}/api/playthroughs/${playthrough.id}/work-orders/${order.id}/transitions`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'Start', actor: 'Pioneer' }),
      },
    );
    expect(start.status).toBe(200);

    const active = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/work-orders/active`, {
      headers: authHeaders(),
    });
    expect(active.status).toBe(200);
    expect(((await active.json()) as { state: string }).state).toBe('active');
  });

  it('does not supersede the previous order on a second create (one active max)', async () => {
    const playthrough = await createPlaythrough();
    const post = async (title: string): Promise<{ id: string }> => {
      const res = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/work-orders`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ...workOrderBody, title }),
      });
      return res.json() as Promise<{ id: string }>;
    };
    const first = await post('First');
    await fetch(
      `${baseUrl}/api/playthroughs/${playthrough.id}/work-orders/${first.id}/transitions`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'Start', actor: 'Pioneer' }),
      },
    );
    await post('Second');

    // First is still active (not superseded); Second sits in `new`.
    const active = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/work-orders/active`, {
      headers: authHeaders(),
    });
    expect(((await active.json()) as { title: string }).title).toBe('First');
    const list = (await (
      await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/work-orders`, {
        headers: authHeaders(),
      })
    ).json()) as {
      state: string;
    }[];
    expect(list).toHaveLength(2);
    expect(list.filter((o) => o.state === 'active')).toHaveLength(1);
  });

  it('404s the active endpoint when nothing is active', async () => {
    const playthrough = await createPlaythrough();
    const res = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/work-orders/active`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it('404s work orders for an unknown playthrough', async () => {
    const res = await fetch(`${baseUrl}/api/playthroughs/does-not-exist/work-orders`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it('returns an empty message history for a fresh playthrough', async () => {
    const playthrough = await createPlaythrough();
    const res = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/messages`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it('uploads a save, attaches it, and stores the file', async () => {
    const playthrough = await createPlaythrough();
    const form = new FormData();
    form.append('save', new Blob([new Uint8Array([1, 2, 3, 4])]), 'MyWorld.sav');
    const upload = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/save`, {
      method: 'POST',
      headers: { cookie }, // no content-type: fetch sets the multipart boundary
      body: form,
    });
    expect(upload.status).toBe(201);
    const result = (await upload.json()) as {
      save: { fileName: string; sizeBytes: number };
      warnings: unknown[];
    };
    expect(result.save.fileName).toBe('MyWorld.sav');
    expect(result.save.sizeBytes).toBe(4);
    // No game-data build wired in this test's fake MCP, so no version warning.
    expect(result.warnings).toEqual([]);
    // The bytes landed on the data volume under the per-version layout.
    expect(fs.existsSync(path.join(saveDir, playthrough.id, `${result.save.id}.sav`))).toBe(true);
    const fetched = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}`, {
      headers: authHeaders(),
    });
    expect((await fetched.json()) as { save?: unknown }).toHaveProperty('save');
  });

  it('rejects a save upload with no file', async () => {
    const playthrough = await createPlaythrough();
    const res = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/save`, {
      method: 'POST',
      headers: { cookie },
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it('rejects creating a playthrough with a path-traversal id', async () => {
    // A client may supply the id (to claim a pre-accounts playthrough); a crafted
    // one must not be accepted, since the id becomes part of an on-disk save path.
    const foremanId = await createForeman();
    const res = await fetch(`${baseUrl}/api/playthroughs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ id: '../../../../tmp/evil', foremanId }),
    });
    expect(res.status).toBe(400);
  });

  it('save path resolution refuses to escape the data directory', () => {
    const saves = new SaveService(db.prisma, stubMcp, saveDir, new WorkOrderService(db.prisma));
    // Sound ids resolve to a per-playthrough, per-save file inside the data dir.
    expect(saves.savePathFor('abc123', 'save1')).toBe(path.join(saveDir, 'abc123', 'save1.sav'));
    // Traversal / separators in either segment are rejected before any fs access.
    for (const bad of ['../escape', '../../etc/passwd', 'a/b']) {
      expect(() => saves.savePathFor(bad, 'save1')).toThrow(/unsafe save (dir|path)/i);
      expect(() => saves.savePathFor('abc123', bad)).toThrow(/unsafe save path/i);
    }
  });

  it('deletes a playthrough and its work orders', async () => {
    const playthrough = await createPlaythrough();
    await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/work-orders`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(workOrderBody),
    });
    const del = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(del.status).toBe(204);
    const read = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}`, {
      headers: authHeaders(),
    });
    expect(read.status).toBe(404);
  });

  it("forbids deleting another user's playthrough", async () => {
    const playthrough = await createPlaythrough();
    const otherCookie = await signUp('deleter@example.com');
    const res = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}`, {
      method: 'DELETE',
      headers: authHeaders(otherCookie),
    });
    expect(res.status).toBe(403);
  });
});

describe('chat history window (BYOK)', () => {
  const KEY_HEADER = 'x-anthropic-api-key';

  /** POSTs a chat turn and returns the window passed to recentMessages. */
  async function chatWindow(
    playthroughId: string,
    body: Record<string, unknown>,
    withKey: boolean,
  ): Promise<number | undefined> {
    let captured: number | undefined;
    const original = playthroughs.recentMessages.bind(playthroughs);
    playthroughs.recentMessages = async (_id: string, window: number) => {
      captured = window;
      return [];
    };
    try {
      const headers = authHeaders();
      if (withKey) {
        headers[KEY_HEADER] = 'sk-test-byok';
      }
      const res = await fetch(`${baseUrl}/api/playthroughs/${playthroughId}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: 'hi', ...body }),
      });
      await res.text(); // drain the SSE stream so the turn (and recentMessages) completes
      return captured;
    } finally {
      playthroughs.recentMessages = original;
    }
  }

  it("honours a BYOK request's history window, and defaults it otherwise", async () => {
    const playthrough = await createPlaythrough();
    // BYOK + explicit window → used verbatim.
    expect(await chatWindow(playthrough.id, { historyWindow: 50 }, true)).toBe(50);
    // BYOK + no window → server default (20).
    expect(await chatWindow(playthrough.id, {}, true)).toBe(20);
  });

  it('rejects a history window beyond the accepted range', async () => {
    const playthrough = await createPlaythrough();
    const res = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/chat`, {
      method: 'POST',
      headers: { ...authHeaders(), [KEY_HEADER]: 'sk-test-byok' },
      body: JSON.stringify({ message: 'hi', historyWindow: 9999 }),
    });
    expect(res.status).toBe(400);
  });

  it('ignores the history window without a client key (subscription uses the default)', async () => {
    // No hosted key is configured here, so a keyless chat is rejected before any
    // window is read — the body value can only take effect inside the BYOK branch.
    const playthrough = await createPlaythrough();
    const res = await fetch(`${baseUrl}/api/playthroughs/${playthrough.id}/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message: 'hi', historyWindow: 50 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('live tool authorization', () => {
  const KEY_HEADER = 'x-anthropic-api-key';

  /** A provider that calls the live tool once, then answers. */
  function liveProvider(): LlmProvider {
    let turn = 0;
    return {
      runTurn: async () => {
        turn += 1;
        return turn === 1
          ? {
              text: '',
              toolCalls: [{ id: 'l1', name: LIVE_BUILDABLES_TOOL, arguments: {} }],
              stopReason: 'tool_use',
            }
          : { text: 'Answered.', toolCalls: [], stopReason: 'stop' };
      },
      complete: async () => '',
    };
  }

  async function chat(playthroughId: string, c: string): Promise<{ status: number; body: string }> {
    const original = makeProvider;
    makeProvider = liveProvider;
    try {
      const res = await fetch(`${baseUrl}/api/playthroughs/${playthroughId}/chat`, {
        method: 'POST',
        headers: { ...authHeaders(c), [KEY_HEADER]: 'sk-test-byok' },
        body: JSON.stringify({ message: 'How many constructors?' }),
      });
      return { status: res.status, body: await res.text() };
    } finally {
      makeProvider = original;
    }
  }

  async function userIdFor(email: string): Promise<string> {
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
    return user.id;
  }

  it('lets only the owner of the linked playthrough reach the receiver', async () => {
    const ownerCookie = await signUp('live-owner@example.com');
    await createTestPlaythrough(db.prisma, {
      id: LINKED_ID,
      userId: await userIdFor('live-owner@example.com'),
    });
    const before = liveCalls.length;

    const owner = await chat(LINKED_ID, ownerCookie);
    expect(owner.status).toBe(200);
    expect(owner.body).toContain(LIVE_BUILDABLES_TOOL);
    expect(liveCalls.length).toBe(before + 1);

    const intruder = await chat(LINKED_ID, await signUp('live-intruder@example.com'));
    expect(intruder.status).toBe(403);
    expect(liveCalls.length).toBe(before + 1);

    // The owner's other, unlinked playthrough gets no live access either.
    const unlinked = await createPlaythrough({}, ownerCookie);
    const other = await chat(unlinked.id, ownerCookie);
    expect(other.status).toBe(200);
    expect(liveCalls.length).toBe(before + 1);

    // Once deleted, the linked id cannot be used or re-created by anyone.
    const del = await fetch(`${baseUrl}/api/playthroughs/${LINKED_ID}`, {
      method: 'DELETE',
      headers: authHeaders(ownerCookie),
    });
    expect(del.status).toBe(204);
    expect((await chat(LINKED_ID, ownerCookie)).status).toBe(404);
    const foremanId = await createForeman();
    const recreate = await fetch(`${baseUrl}/api/playthroughs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ id: LINKED_ID, foremanId }),
    });
    expect(recreate.status).toBe(409);
    expect(liveCalls.length).toBe(before + 1);
  });

  it('refuses to let anyone claim an unowned linked playthrough', async () => {
    // Runs after the linked playthrough was deleted above: an operator mistake
    // leaves an anonymous (pre-accounts) row under the linked id.
    await createTestPlaythrough(db.prisma, { id: LINKED_ID, userId: null });
    const claimer = await signUp('live-claimer@example.com');
    const claim = await fetch(`${baseUrl}/api/playthroughs/${LINKED_ID}/claim`, {
      method: 'POST',
      headers: authHeaders(claimer),
    });
    expect(claim.status).toBe(403);
    const before = liveCalls.length;
    expect((await chat(LINKED_ID, claimer)).status).toBe(403);
    expect(liveCalls.length).toBe(before);
  });

  it('never serialises the private binding in public responses', async () => {
    const body = await (await fetch(`${baseUrl}/health`)).text();
    expect(body).not.toContain(LIVE_TOKEN);
    expect(body).not.toContain(liveState.binding.worldId);
    expect(body).not.toContain('receiver.example');
  });
});
