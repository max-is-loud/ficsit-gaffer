import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runChat, type ChatEvents } from '../src/llm/chat.js';
import type { TruncatedTurn } from '../src/llm/truncation.js';
import type { LlmTurnResult } from '../src/llm/types.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { FakeLlmProvider, fakeMcp } from './chatFakes.js';
import { createTestDb, createTestForeman, createTestUser, type TestDb } from './helpers.js';

// Scripted-provider tests for a turn the model cuts off at its output-token limit.

let db: TestDb;
let userId: string;

beforeAll(async () => {
  db = await createTestDb();
  userId = await createTestUser(db.prisma);
});

afterAll(async () => {
  await db.cleanup();
});

const recipeRound: LlmTurnResult = {
  text: "I'll check the recipe. ",
  toolCalls: [{ id: 't1', name: 'get_recipe', arguments: { name: 'Iron Plate' } }],
  stopReason: 'tool_use',
};

interface Run {
  returned: string;
  streamed: string[];
  truncations: TruncatedTurn[];
  provider: FakeLlmProvider;
  mcp: ReturnType<typeof fakeMcp>;
  workOrders: WorkOrderService;
  playthroughId: string;
}

async function run(rounds: LlmTurnResult[]): Promise<Run> {
  const playthroughs = new PlaythroughService(db.prisma);
  const workOrders = new WorkOrderService(db.prisma);
  const mcp = fakeMcp();
  const foremanId = await createTestForeman(db.prisma, userId);
  const playthrough = await playthroughs.create({ userId, foremanId });
  await playthroughs.appendMessage(playthrough.id, 'user', 'Set up iron plates.');
  const provider = new FakeLlmProvider(rounds);
  const streamed: string[] = [];
  const truncations: TruncatedTurn[] = [];
  const events: ChatEvents = {
    text: (delta) => streamed.push(delta),
    toolUse: () => {},
    workOrder: () => {},
    truncated: (turn) => truncations.push(turn),
  };
  const returned = await runChat(
    {
      playthroughId: playthrough.id,
      promptContext: { personality: '', pioneerProfile: '' },
      provider,
      model: 'm',
      maxTokens: 1024,
    },
    { systemPromptTemplate: 'Prompt', historyWindow: 20, playthroughs, workOrders, mcp },
    events,
  );
  return {
    returned,
    streamed,
    truncations,
    provider,
    mcp,
    workOrders,
    playthroughId: playthrough.id,
  };
}

describe('runChat truncated turns', () => {
  it('keeps truncated text, reports it, and marks it in the saved text', async () => {
    const result = await run([
      { text: 'The plan has three parts: first', toolCalls: [], stopReason: 'truncated' },
    ]);

    expect(result.truncations).toHaveLength(1);
    expect(result.truncations[0]?.kind).toBe('text');
    expect(result.truncations[0]?.clientMessage).toMatch(/cut off/i);
    // The text stays, and the marker follows it in the saved text.
    expect(result.returned.startsWith('The plan has three parts: first')).toBe(true);
    expect(result.returned).toMatch(/\[Reply cut off/);
    // The marker is for history only: the client never streams it.
    expect(result.streamed).toEqual(['The plan has three parts: first']);
    expect(result.provider.requests).toHaveLength(1);
  });

  it('never runs a tool call that was cut off, and reports it', async () => {
    const result = await run([
      recipeRound,
      {
        text: 'Now the order. ',
        // The arguments are cut short, so the title and steps are missing.
        toolCalls: [{ id: 't2', name: 'create_work_order', arguments: { title: 'Iron Pla' } }],
        stopReason: 'truncated',
        rawStopReason: 'max_tokens',
      },
    ]);

    expect(result.mcp.calls).toEqual([{ name: 'get_recipe', args: { name: 'Iron Plate' } }]);
    expect(await result.workOrders.list(result.playthroughId)).toHaveLength(0);
    expect(result.provider.requests).toHaveLength(2);

    expect(result.truncations).toHaveLength(1);
    expect(result.truncations[0]?.kind).toBe('tool_call');
    expect(result.truncations[0]?.clientMessage).toContain('create_work_order');
    // The saved text keeps what the foreman said and names the call that did not run.
    expect(result.returned.startsWith("I'll check the recipe. Now the order. ")).toBe(true);
    expect(result.returned).toContain('create_work_order');
    expect(result.returned).toMatch(/did not run/i);
  });

  it('saves a marker when the truncated round had no text', async () => {
    const result = await run([
      {
        text: '',
        toolCalls: [{ id: 't1', name: 'create_work_order', arguments: {} }],
        stopReason: 'truncated',
      },
    ]);
    expect(result.streamed).toEqual([]);
    expect(result.returned.length).toBeGreaterThan(0);
    expect(result.returned).toContain('create_work_order');
  });

  it('does not report a normal stop as truncated', async () => {
    const result = await run([{ text: 'Done.', toolCalls: [], stopReason: 'stop' }]);
    expect(result.truncations).toEqual([]);
    expect(result.returned).toBe('Done.');
  });
});
