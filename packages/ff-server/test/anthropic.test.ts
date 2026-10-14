import type Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicProvider } from '../src/llm/anthropic.js';
import { runChat } from '../src/llm/chat.js';
import type { LlmStreamEvent } from '../src/llm/types.js';
import type { McpGateway } from '../src/mcp/client.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { createTestDb, createTestForeman, createTestUser, type TestDb } from './helpers.js';

// Mock only the external SDK stream; exercise the real adapter and chat loop.
const wire = vi.hoisted(() => ({
  responses: [] as Anthropic.Message[],
  requests: [] as Anthropic.MessageCreateParams[],
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    public readonly messages = {
      stream(request: Anthropic.MessageCreateParams) {
        wire.requests.push(structuredClone(request));
        const response = wire.responses.shift();
        if (response === undefined) {
          throw new Error('No scripted Anthropic response');
        }
        return {
          on(_event: 'text', callback: (delta: string) => void): void {
            for (const block of response.content) {
              if (block.type === 'text') {
                callback(block.text);
              }
            }
          },
          async finalMessage(): Promise<Anthropic.Message> {
            return response;
          },
        };
      },
    };
  },
}));

function response(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.StopReason = 'end_turn',
): Anthropic.Message {
  return {
    id: 'msg-test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    container: null,
    stop_details: null,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 20,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
    },
  };
}

let db: TestDb | undefined;
let playthroughs: PlaythroughService;
let workOrders: WorkOrderService;
let playthroughId: string;

beforeAll(async () => {
  db = await createTestDb();
  playthroughs = new PlaythroughService(db.prisma);
  workOrders = new WorkOrderService(db.prisma);
  const userId = await createTestUser(db.prisma);
  const foremanId = await createTestForeman(db.prisma, userId);
  const playthrough = await playthroughs.create({ userId, foremanId });
  playthroughId = playthrough.id;
  await playthroughs.appendMessage(playthroughId, 'user', 'Check my saved factory.');
});

afterAll(async () => {
  await db?.cleanup();
});

beforeEach(() => {
  wire.requests.length = 0;
  wire.responses.length = 0;
});

const mcp: McpGateway = {
  gameVersion: 'test',
  listTools: async () => [
    { name: 'get_recipe', description: 'Recipe', inputSchema: { type: 'object' } },
    { name: 'get_power', description: 'Saved power', inputSchema: { type: 'object' } },
  ],
  callTool: async (name) =>
    name === 'get_power'
      ? { text: 'Power unavailable', isError: true }
      : { text: 'Recipe found', isError: false },
};

async function chat(): Promise<{ text: string; chunks: string[]; tools: string[] }> {
  const chunks: string[] = [];
  const tools: string[] = [];
  const text = await runChat(
    {
      playthroughId,
      promptContext: { personality: '', pioneerProfile: '' },
      provider: new AnthropicProvider('test-key'),
      model: 'claude-sonnet-5-5',
      maxTokens: 4096,
    },
    { systemPromptTemplate: 'Foreman', historyWindow: 20, playthroughs, workOrders, mcp },
    {
      text: (delta) => chunks.push(delta),
      toolUse: (name) => tools.push(name),
      workOrder: () => {},
    },
  );
  return { text, chunks, tools };
}

describe('Anthropic continuation through runChat', () => {
  it('replays native blocks unchanged across rounds and groups all tool results', async () => {
    // Dropping signatures, citations, caller metadata, or original block order
    // breaks the append-only continuation sent to the provider.
    const first: Anthropic.ContentBlock[] = [
      { type: 'thinking', thinking: '', signature: 'signed-empty-thinking' },
      { type: 'text', text: 'Checking. ', citations: null },
      {
        type: 'tool_use',
        id: 'recipe-1',
        name: 'get_recipe',
        input: { name: 'Iron Plate' },
        caller: { type: 'direct' },
      },
      { type: 'text', text: 'And power. ', citations: null },
      {
        type: 'tool_use',
        id: 'power-1',
        name: 'get_power',
        input: {},
        caller: { type: 'direct' },
      },
    ];
    const second: Anthropic.ContentBlock[] = [
      { type: 'thinking', thinking: 'Check another recipe.', signature: 'signed-round-two' },
      { type: 'redacted_thinking', data: 'encrypted-thinking' },
      {
        type: 'tool_use',
        id: 'recipe-2',
        name: 'get_recipe',
        input: { name: 'Iron Rod' },
        caller: { type: 'direct' },
      },
    ];
    const originalFirst = structuredClone(first);
    const originalSecond = structuredClone(second);
    wire.responses.push(
      response(first, 'tool_use'),
      response(second, 'tool_use'),
      response([{ type: 'text', text: 'Done.', citations: null }]),
    );

    expect(await chat()).toEqual({
      text: 'Checking. And power. Done.',
      chunks: ['Checking. ', 'And power. ', 'Done.'],
      tools: ['get_recipe', 'get_power', 'get_recipe'],
    });
    expect(wire.requests).toHaveLength(3);
    expect(wire.requests[1]?.messages).toEqual([
      { role: 'user', content: 'Check my saved factory.' },
      { role: 'assistant', content: originalFirst },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'recipe-1',
            content: 'Recipe found',
            is_error: false,
          },
          {
            type: 'tool_result',
            tool_use_id: 'power-1',
            content: 'Power unavailable',
            is_error: true,
          },
        ],
      },
    ]);
    expect(wire.requests[2]?.messages).toEqual([
      ...(wire.requests[1]?.messages ?? []),
      { role: 'assistant', content: originalSecond },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'recipe-2',
            content: 'Recipe found',
            is_error: false,
          },
        ],
      },
    ]);
    expect(wire.requests[1]?.system).toEqual(wire.requests[0]?.system);
    expect(wire.requests[2]?.tools).toEqual(wire.requests[0]?.tools);
    expect(first).toEqual(originalFirst);
    expect(second).toEqual(originalSecond);
  });

  it('returns only visible text for a response without tool use', async () => {
    wire.responses.push(
      response([
        { type: 'thinking', thinking: '', signature: 'signed-answer' },
        { type: 'text', text: 'Hello.', citations: null },
      ]),
    );
    expect(await chat()).toEqual({ text: 'Hello.', chunks: ['Hello.'], tools: [] });
    expect(wire.requests).toHaveLength(1);
  });

  it('still translates neutral assistant turns when native continuation is absent', async () => {
    wire.responses.push(response([{ type: 'text', text: 'Done.', citations: null }]));
    const events: LlmStreamEvent[] = [];
    await new AnthropicProvider('test-key').runTurn(
      {
        system: 'Foreman',
        model: 'test-model',
        maxTokens: 1024,
        tools: [],
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
          {
            role: 'assistant',
            text: 'Checking',
            toolCalls: [{ id: 'r1', name: 'get_recipe', arguments: { name: 'Iron Plate' } }],
          },
          { role: 'tool', toolCallId: 'r1', content: 'Recipe found', isError: false },
        ],
      },
      (event) => events.push(event),
    );
    expect(wire.requests[0]?.messages).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking' },
          { type: 'tool_use', id: 'r1', name: 'get_recipe', input: { name: 'Iron Plate' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'r1', content: 'Recipe found', is_error: false },
        ],
      },
    ]);
    expect(events).toEqual([{ type: 'text', delta: 'Done.' }]);
  });
});
