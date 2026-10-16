import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ChatDeps, ChatEvents } from '../src/llm/chat.js';
import { MAX_CONCURRENT_TOOL_CALLS, runToolCalls } from '../src/llm/toolRunner.js';
import type { NeutralToolCall } from '../src/llm/types.js';
import type { McpGateway } from '../src/mcp/client.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import type { WorkOrder } from '../src/types.js';
import { createTestDb, createTestForeman, createTestUser, type TestDb } from './helpers.js';

let db: TestDb;
let userId: string;

beforeAll(async () => {
  db = await createTestDb();
  userId = await createTestUser(db.prisma);
});

afterAll(async () => {
  await db.cleanup();
});

/** A gateway whose calls wait `delays[name]` ms (or throw) and record the peak in flight. */
function slowMcp(
  delays: Record<string, number>,
  failures: Record<string, string> = {},
): McpGateway & { peak: number; log: string[] } {
  let inFlight = 0;
  const gateway = {
    gameVersion: '1.2.3.0',
    peak: 0,
    log: [] as string[],
    listTools: async () => [],
    callTool: async (name: string, args: Record<string, unknown>) => {
      inFlight += 1;
      gateway.peak = Math.max(gateway.peak, inFlight);
      gateway.log.push(`call:${String(args['tag'] ?? name)}`);
      await new Promise((resolve) => setTimeout(resolve, delays[name] ?? 0));
      inFlight -= 1;
      const failure = failures[name];
      if (failure !== undefined) {
        throw new Error(failure);
      }
      return { text: `${name}:${String(args['tag'] ?? '')}`, isError: false };
    },
  };
  return gateway;
}

async function context(
  mcp: McpGateway,
  workOrders = new WorkOrderService(db.prisma),
): Promise<{
  run: (calls: NeutralToolCall[]) => ReturnType<typeof runToolCalls>;
  toolUses: string[];
  orders: WorkOrder[];
  playthroughId: string;
}> {
  const playthroughs = new PlaythroughService(db.prisma);
  const foremanId = await createTestForeman(db.prisma, userId);
  const playthrough = await playthroughs.create({ userId, foremanId });
  const deps: ChatDeps = {
    systemPromptTemplate: 'Prompt',
    historyWindow: 20,
    playthroughs,
    workOrders,
    mcp,
  };
  const toolUses: string[] = [];
  const orders: WorkOrder[] = [];
  const events: ChatEvents = {
    text: () => {},
    toolUse: (name) => toolUses.push(name),
    workOrder: (order) => orders.push(order),
  };
  return {
    run: (calls) => runToolCalls(calls, { playthroughId: playthrough.id, deps, events }),
    toolUses,
    orders,
    playthroughId: playthrough.id,
  };
}

function lookup(id: string, name: string, tag = id): NeutralToolCall {
  return { id, name, arguments: { tag } };
}

function createOrder(id: string, title: string): NeutralToolCall {
  return {
    id,
    name: 'create_work_order',
    arguments: {
      title,
      goal: 'Make plates.',
      buildSteps: [{ title: 'Place constructors' }],
      expectedOutputs: [{ kind: 'infrastructure', description: 'Online.' }],
    },
  };
}

describe('runToolCalls', () => {
  it('runs read-only calls concurrently and returns results in call order', async () => {
    const mcp = slowMcp({ slow: 30, mid: 10, fast: 0 });
    const { run } = await context(mcp);
    const outcomes = await run([lookup('a', 'slow'), lookup('b', 'mid'), lookup('c', 'fast')]);
    expect(outcomes.map((outcome) => outcome.text)).toEqual(['slow:a', 'mid:b', 'fast:c']);
    expect(mcp.peak).toBe(3);
  });

  it(`never has more than ${MAX_CONCURRENT_TOOL_CALLS} read-only calls in flight`, async () => {
    const mcp = slowMcp({ get_recipe: 15 });
    const { run } = await context(mcp);
    const calls = Array.from({ length: 8 }, (_, i) => lookup(`r${i}`, 'get_recipe'));
    const outcomes = await run(calls);
    expect(outcomes).toHaveLength(8);
    expect(mcp.peak).toBe(MAX_CONCURRENT_TOOL_CALLS);
  });

  it('runs work-order calls one at a time, in call order, beside the lookups', async () => {
    const workOrders = new WorkOrderService(db.prisma);
    let inFlight = 0;
    let peak = 0;
    const tracked = new Proxy(workOrders, {
      get(target, property, receiver): unknown {
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') {
          return value;
        }
        return async (...args: unknown[]): Promise<unknown> => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          try {
            return await (value as (...rest: unknown[]) => Promise<unknown>).apply(target, args);
          } finally {
            inFlight -= 1;
          }
        };
      },
    });
    const { run, orders, playthroughId } = await context(slowMcp({ get_recipe: 20 }), tracked);
    const outcomes = await run([
      createOrder('w1', 'First Order'),
      lookup('r1', 'get_recipe'),
      createOrder('w2', 'Second Order'),
    ]);
    expect(outcomes.map((outcome) => outcome.isError)).toEqual([false, false, false]);
    expect(peak).toBe(1);
    expect(orders.map((order) => order.title)).toEqual(['First Order', 'Second Order']);
    const stored = await workOrders.list(playthroughId);
    expect(stored.map((order) => order.title).sort()).toEqual(['First Order', 'Second Order']);
  });

  it('turns a failing call into an error result without stopping the others', async () => {
    const mcp = slowMcp({}, { get_power: 'boom' });
    const { run, orders } = await context(mcp);
    const outcomes = await run([
      lookup('a', 'get_recipe'),
      lookup('b', 'get_power'),
      createOrder('w1', 'Still Created'),
    ]);
    expect(outcomes[0]).toEqual({ text: 'get_recipe:a', isError: false });
    expect(outcomes[1]).toEqual({ text: 'Tool get_power failed: boom', isError: true });
    expect(outcomes[2]?.isError).toBe(false);
    expect(orders.map((order) => order.title)).toEqual(['Still Created']);
  });

  it('announces every call, in call order, before dispatching any', async () => {
    const mcp = slowMcp({});
    const { run, toolUses } = await context(mcp);
    const announced: string[] = [];
    const calls = [lookup('a', 'get_recipe'), lookup('b', 'get_building'), lookup('c', 'get_item')];
    const original = mcp.callTool.bind(mcp);
    mcp.callTool = async (name, args, callContext) => {
      announced.push(toolUses.join(','));
      return original(name, args, callContext);
    };
    await run(calls);
    expect(toolUses).toEqual(['get_recipe', 'get_building', 'get_item']);
    expect(announced.every((seen) => seen === 'get_recipe,get_building,get_item')).toBe(true);
  });
});
