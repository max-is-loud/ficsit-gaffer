import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

// The effort setting through the chat route: a BYOK override, the server default, validation and
// the same level on every round of a turn. A scripted provider records the requests it receives.

let db: TestDb;
let server: Server;
let baseUrl: string;
let cookie: string;
let userId: string;
let provider: FakeLlmProvider;
let playthroughs: PlaythroughService;

const stop: LlmTurnResult = { text: 'Done.', toolCalls: [], stopReason: 'stop' };

beforeAll(async () => {
  db = await createTestDb();
  playthroughs = new PlaythroughService(db.prisma);
  const mcp = fakeMcp();
  const factory: LlmProviderFactory = () => provider;
  const deps: AppDeps = {
    config: resolveServerConfig({ LLM_API_KEY: 'sk-hosted', LLM_EFFORT: 'medium' }),
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
    body: JSON.stringify({
      name: 'Pioneer',
      email: 'effort@example.com',
      password: 'password1234',
    }),
  });
  cookie = signUp.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ');
  userId = (await db.prisma.user.findUniqueOrThrow({ where: { email: 'effort@example.com' } })).id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.cleanup();
});

beforeEach(() => {
  provider = new FakeLlmProvider([stop]);
});

interface ChatResult {
  status: number;
  body: string;
  savedMessages: number;
}

/** Runs one chat turn on a new playthrough; `key` false uses the server's hosted key. */
async function chat(body: Record<string, unknown>, key: boolean): Promise<ChatResult> {
  const foremanId = await createTestForeman(db.prisma, userId);
  const playthroughId = await createTestPlaythrough(db.prisma, { userId, foremanId });
  const res = await fetch(`${baseUrl}/api/playthroughs/${playthroughId}/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      ...(key ? { 'x-anthropic-api-key': 'sk-client' } : {}),
    },
    body: JSON.stringify({ message: 'Set up iron plates.', ...body }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text,
    savedMessages: (await playthroughs.recentMessages(playthroughId, 10)).length,
  };
}

describe('chat route effort', () => {
  it('passes a BYOK request effort to the provider', async () => {
    const result = await chat({ model: 'claude-opus-5-5', effort: 'xhigh' }, true);
    expect(result.status).toBe(200);
    expect(provider.requests.map((request) => request.effort)).toEqual(['xhigh']);
  });

  it('uses the server default for a hosted request', async () => {
    await chat({}, false);
    expect(provider.requests.map((request) => request.effort)).toEqual(['medium']);
  });

  it('keeps the server default for a BYOK request that does not override it', async () => {
    await chat({}, true);
    expect(provider.requests.map((request) => request.effort)).toEqual(['medium']);
  });

  it('sends no effort when a BYOK request switches to a model the default was not chosen for', async () => {
    await chat({ model: 'claude-haiku-4-5' }, true);
    expect(provider.requests.map((request) => request.effort)).toEqual([undefined]);
  });

  it('rejects a value that is not a level with a 400, before the model is called', async () => {
    const result = await chat({ effort: 'extreme' }, true);
    expect(result.status).toBe(400);
    expect(provider.requests).toHaveLength(0);
  });

  it('rejects a level the chosen model cannot take with a clear 400 and saves nothing', async () => {
    const result = await chat({ model: 'claude-sonnet-4-6', effort: 'xhigh' }, true);
    expect(result.status).toBe(400);
    expect(result.body).toContain("Model 'claude-sonnet-4-6' does not support effort 'xhigh'");
    expect(provider.requests).toHaveLength(0);
    expect(result.savedMessages).toBe(0);
  });

  it('keeps the same effort for every round of a turn', async () => {
    provider = new FakeLlmProvider([
      {
        text: 'Checking. ',
        toolCalls: [{ id: 't1', name: 'get_recipe', arguments: { name: 'Iron Plate' } }],
        stopReason: 'tool_use',
      },
      {
        text: '',
        toolCalls: [{ id: 't2', name: 'get_recipe', arguments: { name: 'Wire' } }],
        stopReason: 'tool_use',
      },
      stop,
    ]);
    await chat({ model: 'claude-opus-5-5', effort: 'high' }, true);
    expect(provider.requests.map((request) => request.effort)).toEqual(['high', 'high', 'high']);
  });
});
