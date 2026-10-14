import { describe, expect, it, vi } from 'vitest';

import {
  consumeOpenAiStream,
  OpenAiCompatibleProvider,
  tokenLimitParam,
  type OpenAiStreamChunk,
} from '../src/llm/openai.js';
import { liveStateToolDefinitions } from '../src/tools/liveStateTools.js';
import type { LlmStreamEvent } from '../src/llm/types.js';

// Capture SDK requests; consumeOpenAiStream tests never touch the client.
const wire = vi.hoisted(() => ({ requests: [] as Record<string, unknown>[] }));
vi.mock('openai', () => ({
  default: class {
    public readonly chat = {
      completions: {
        create: async (request: Record<string, unknown>) => {
          wire.requests.push(structuredClone(request));
          return (async function* () {
            yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] };
          })();
        },
      },
    };
  },
}));

async function* chunks(items: OpenAiStreamChunk[]): AsyncGenerator<OpenAiStreamChunk> {
  for (const item of items) {
    yield item;
  }
}

function textChunk(content: string, finish: string | null = null): OpenAiStreamChunk {
  return { choices: [{ delta: { content }, finish_reason: finish }] };
}

describe('consumeOpenAiStream', () => {
  it('accumulates text deltas in order and finishes with stop', async () => {
    const events: LlmStreamEvent[] = [];
    const result = await consumeOpenAiStream(
      chunks([textChunk('Hello '), textChunk('there.', 'stop')]),
      (e) => events.push(e),
    );
    expect(result.text).toBe('Hello there.');
    expect(result.stopReason).toBe('stop');
    expect(result.toolCalls).toEqual([]);
    expect(
      events.filter((e) => e.type === 'text').map((e) => (e.type === 'text' ? e.delta : '')),
    ).toEqual(['Hello ', 'there.']);
  });

  it('reassembles multiple tool calls with arguments split across chunks', async () => {
    const result = await consumeOpenAiStream(
      chunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'a', function: { name: 'get_item', arguments: '{"name":' } },
                ],
              },
            },
          ],
        },
        {
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Iron"}' } }] } }],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: 'b',
                    function: { name: 'get_recipe', arguments: '{"name":"Plate"}' },
                  },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]),
      () => {},
    );
    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls).toEqual([
      { id: 'a', name: 'get_item', arguments: { name: 'Iron' } },
      { id: 'b', name: 'get_recipe', arguments: { name: 'Plate' } },
    ]);
  });

  it('handles a tool-only turn with no text content', async () => {
    const result = await consumeOpenAiStream(
      chunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'x', function: { name: 'list_schematics', arguments: '' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]),
      () => {},
    );
    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([{ id: 'x', name: 'list_schematics', arguments: {} }]);
    expect(result.stopReason).toBe('tool_use');
  });

  it('treats empty/whitespace arguments as an empty object without throwing', async () => {
    const result = await consumeOpenAiStream(
      chunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'y', function: { name: 'noargs', arguments: '   ' } }],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]),
      () => {},
    );
    expect(result.toolCalls).toEqual([{ id: 'y', name: 'noargs', arguments: {} }]);
  });
});

describe('tokenLimitParam', () => {
  it('uses max_completion_tokens for GPT-5 and o-series reasoning models', () => {
    expect(tokenLimitParam('gpt-5-mini', 4096)).toEqual({ max_completion_tokens: 4096 });
    expect(tokenLimitParam('gpt-5', 4096)).toEqual({ max_completion_tokens: 4096 });
    expect(tokenLimitParam('o3', 4096)).toEqual({ max_completion_tokens: 4096 });
    expect(tokenLimitParam('o4-mini', 4096)).toEqual({ max_completion_tokens: 4096 });
    expect(tokenLimitParam('o1-preview', 4096)).toEqual({ max_completion_tokens: 4096 });
  });

  it('handles dotted minor versions in the GPT-5 family', () => {
    expect(tokenLimitParam('gpt-5.4-mini', 4096)).toEqual({ max_completion_tokens: 4096 });
    expect(tokenLimitParam('gpt-5.1', 4096)).toEqual({ max_completion_tokens: 4096 });
  });

  it('tolerates an OpenRouter-style provider prefix', () => {
    expect(tokenLimitParam('openai/gpt-5-mini', 2048)).toEqual({ max_completion_tokens: 2048 });
    expect(tokenLimitParam('openai/gpt-5.4-mini', 2048)).toEqual({ max_completion_tokens: 2048 });
  });

  it('keeps max_tokens for gpt-4.1/4o, and OpenAI-compatible local models', () => {
    expect(tokenLimitParam('gpt-4.1-mini', 8192)).toEqual({ max_tokens: 8192 });
    expect(tokenLimitParam('gpt-4o', 8192)).toEqual({ max_tokens: 8192 });
    expect(tokenLimitParam('llama3.1', 8192)).toEqual({ max_tokens: 8192 });
    expect(tokenLimitParam('qwen3:32b', 8192)).toEqual({ max_tokens: 8192 });
  });
});

describe('OpenAI live tool serialisation', () => {
  it('carries the live tool definition and folds its error result into the tool message', async () => {
    const [definition] = liveStateToolDefinitions('p1', {
      binding: {
        url: 'https://receiver.example:9443/',
        queryToken: 'openai-test-query-token-0123456789',
        serverId: '00000001-0000-4000-8000-000000000001',
        worldId: '00000002-0000-4000-8000-000000000001',
        playthroughId: 'p1',
      },
      client: { query: async () => Promise.reject(new Error('unused')) },
    });
    expect(definition).toBeDefined();
    await new OpenAiCompatibleProvider('sk-test').runTurn(
      {
        system: 'Foreman',
        model: 'gpt-4.1',
        maxTokens: 512,
        tools: definition === undefined ? [] : [definition],
        messages: [
          { role: 'user', content: 'How many constructors?' },
          {
            role: 'assistant',
            text: '',
            toolCalls: [{ id: 'c1', name: 'get_live_constructor_state', arguments: {} }],
          },
          {
            role: 'tool',
            toolCallId: 'c1',
            content: 'Live observations unavailable.',
            isError: true,
          },
        ],
      },
      () => {},
    );
    const request = wire.requests[0] as {
      tools: { function: { name: string; parameters: { properties: Record<string, unknown> } } }[];
      messages: { role: string; content: string | null; tool_call_id?: string }[];
    };
    expect(request.tools[0]?.function.name).toBe('get_live_constructor_state');
    expect(Object.keys(request.tools[0]?.function.parameters.properties ?? {}).sort()).toEqual([
      'cursor',
      'includeLocations',
      'limit',
    ]);
    expect(request.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: 'ERROR: Live observations unavailable.',
    });
    expect(JSON.stringify(request)).not.toContain('openai-test-query-token');
  });
});
