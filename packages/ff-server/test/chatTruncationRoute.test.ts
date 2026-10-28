import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { resolveServerConfig } from '../src/config.js';
import type { AppDeps } from '../src/deps.js';
import { SummaryService } from '../src/llm/summary.js';
import type { LlmProviderFactory } from '../src/llm/provider.js';
import type { LlmTurnResult } from '../src/llm/types.js';
import { ForemanService } from '../src/services/foremanService.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { SaveService } from '../src/services/saveService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { FakeLlmProvider, fakeMcp } from './chatFakes.js';
import { createTestDb, createTestForeman, createTestPlaythrough, type TestDb } from './helpers.js';

// The chat route's answer to a turn the model cut off: an SSE error the client shows, and the
// partial reply saved with a marker. Uses its own app because routes.test.ts is over its size limit.

let db: TestDb;
let server: Server;
let baseUrl: string;
let cookie: string;
let userId: string;
let rounds: LlmTurnResult[] = [];
let playthroughs: PlaythroughService;

beforeAll(async () => {
  db = await createTestDb();
  playthroughs = new PlaythroughService(db.prisma);
  const mcp = fakeMcp();
  const factory: LlmProviderFactory = () => new FakeLlmProvider(rounds);
  const deps: AppDeps = {
    config: resolveServerConfig({}),
    auth: createAuth(db.prisma),
    foremen: new ForemanService(db.prisma),
    playthroughs,
    saves: new SaveService(db.prisma, mcp, '/tmp', new WorkOrderService(db.prisma)),
    workOrders: new WorkOrderService(db.prisma),
    mcp,
    summary: new SummaryService(playthroughs, { historyWindow: 20 }, factory),
    llmProviderFactory: factory,
    systemPromptTemplate: 'Prompt {{PERSONALITY}} {{PIONEER_PROFILE}} {{SESSION_SUMMARY}}',
  };
  server = await new Promise<Server>((resolve) => {
    const listening = buildApp(deps).listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const signUp = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Pioneer', email: 'trunc@example.com', password: 'password1234' }),
  });
  cookie = signUp.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ');
  userId = (await db.prisma.user.findUniqueOrThrow({ where: { email: 'trunc@example.com' } })).id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.cleanup();
});

/** Runs one chat turn against a new playthrough; returns the SSE body and the saved messages. */
async function chat(scripted: LlmTurnResult[]): Promise<{ body: string; saved: string[] }> {
  rounds = scripted;
  const foremanId = await createTestForeman(db.prisma, userId);
  const playthroughId = await createTestPlaythrough(db.prisma, { userId, foremanId });
  const res = await fetch(`${baseUrl}/api/playthroughs/${playthroughId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-anthropic-api-key': 'sk-test' },
    body: JSON.stringify({ message: 'Set up iron plates.' }),
  });
  const body = await res.text();
  const history = await playthroughs.recentMessages(playthroughId, 10);
  return {
    body,
    saved: history
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content),
  };
}

describe('chat route with a truncated turn', () => {
  it('sends an error, no done, and saves the cut-off text with a marker', async () => {
    const { body, saved } = await chat([
      { text: 'First, the iron', toolCalls: [], stopReason: 'truncated' },
    ]);
    expect(body).toContain('event: text');
    expect(body).toContain('event: error');
    expect(body).toMatch(/cut off/i);
    expect(body).not.toContain('event: done');
    expect(body).not.toContain('[Reply cut off');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^First, the iron\n\n\[Reply cut off/);
  });

  it('saves a marker that names a cut-off tool call', async () => {
    const { body, saved } = await chat([
      {
        text: '',
        toolCalls: [{ id: 't1', name: 'create_work_order', arguments: {} }],
        stopReason: 'truncated',
      },
    ]);
    expect(body).toContain('event: error');
    expect(body).not.toContain('event: work_order');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain('create_work_order');
  });

  it('still sends done and saves the plain text for a normal stop', async () => {
    const { body, saved } = await chat([{ text: 'All set.', toolCalls: [], stopReason: 'stop' }]);
    expect(body).toContain('event: done');
    expect(body).not.toContain('event: error');
    expect(saved).toEqual(['All set.']);
  });
});
