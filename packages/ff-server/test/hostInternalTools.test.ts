import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runChat } from '../src/llm/chat.js';
import type { NeutralToolCall } from '../src/llm/types.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { isHostInternalTool } from '../src/tools/hostInternalTools.js';
import { FakeLlmProvider, fakeMcp } from './chatFakes.js';
import { createTestDb, createTestForeman, createTestUser, type TestDb } from './helpers.js';

// Host-internal MCP tools (describe_save, get_save_summary) are the backend's own: hidden from
// the model, and refused at dispatch even when the model names one anyway.

let db: TestDb;
let userId: string;

beforeAll(async () => {
  db = await createTestDb();
  userId = await createTestUser(db.prisma);
});

afterAll(async () => {
  await db.cleanup();
});

/** Runs one chat turn whose first round makes `calls`, over a gateway that also lists the host tools. */
async function runRound(calls: NeutralToolCall[]): Promise<{
  provider: FakeLlmProvider;
  mcp: ReturnType<typeof fakeMcp>;
}> {
  const playthroughs = new PlaythroughService(db.prisma);
  const workOrders = new WorkOrderService(db.prisma);
  const foremanId = await createTestForeman(db.prisma, userId);
  const playthrough = await playthroughs.create({ userId, foremanId });
  await playthroughs.appendMessage(playthrough.id, 'user', 'What is in my save?');
  const mcp = fakeMcp();
  const listed = await mcp.listTools();
  mcp.listTools = async () => [
    ...listed,
    { name: 'describe_save', description: 'host', inputSchema: { type: 'object' } },
    { name: 'get_save_summary', description: 'host', inputSchema: { type: 'object' } },
    {
      name: 'get_player_state',
      description: 'save',
      inputSchema: { type: 'object', properties: { savePath: { type: 'string' } } },
    },
  ];
  const provider = new FakeLlmProvider([
    { text: '', toolCalls: calls, stopReason: 'tool_use' },
    { text: 'Done.', toolCalls: [], stopReason: 'stop' },
  ]);
  await runChat(
    {
      playthroughId: playthrough.id,
      promptContext: { personality: '', pioneerProfile: '' },
      provider,
      model: 'm',
      maxTokens: 1024,
    },
    { systemPromptTemplate: 'Prompt', historyWindow: 20, playthroughs, workOrders, mcp },
    { text: () => {}, toolUse: () => {}, workOrder: () => {} },
  );
  return { provider, mcp };
}

describe('host-internal tools', () => {
  it('recognises exactly the backend-only save tools', () => {
    expect(isHostInternalTool('describe_save')).toBe(true);
    expect(isHostInternalTool('get_save_summary')).toBe(true);
    expect(isHostInternalTool('get_recipe')).toBe(false);
  });

  it('refuses a model call to each host-internal tool without reaching MCP', async () => {
    const { provider, mcp } = await runRound([
      { id: 't1', name: 'get_save_summary', arguments: {} },
      { id: 't2', name: 'describe_save', arguments: { savePath: '/saves/other.sav' } },
      { id: 't3', name: 'get_recipe', arguments: { name: 'Iron Plate' } },
    ]);
    expect(mcp.calls.map((call) => call.name)).toEqual(['get_recipe']);
    const results = (provider.requests[1]?.messages ?? []).filter(
      (message) => message.role === 'tool',
    );
    expect(results).toEqual([
      expect.objectContaining({
        toolCallId: 't1',
        content: "Tool 'get_save_summary' is not available.",
        isError: true,
      }),
      expect.objectContaining({
        toolCallId: 't2',
        content: "Tool 'describe_save' is not available.",
        isError: true,
      }),
      expect.objectContaining({ toolCallId: 't3', isError: false }),
    ]);
  });

  it('still hides them from the advertised tool list', async () => {
    const { provider } = await runRound([{ id: 't1', name: 'get_recipe', arguments: {} }]);
    const offered = provider.requests[0]?.tools.map((tool) => tool.name) ?? [];
    expect(offered).toContain('get_recipe');
    expect(offered).not.toContain('describe_save');
    expect(offered).not.toContain('get_save_summary');
  });

  it('offers save tools without their host-managed savePath property', async () => {
    const { provider } = await runRound([{ id: 't1', name: 'get_recipe', arguments: {} }]);
    const playerState = provider.requests[0]?.tools.find(
      (tool) => tool.name === 'get_player_state',
    );
    expect(playerState).toBeDefined();
    expect(playerState?.inputSchema).toEqual({ type: 'object', properties: {} });
  });
});
