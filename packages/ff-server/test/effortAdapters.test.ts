import type Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicProvider } from '../src/llm/anthropic.js';
import { UnsupportedEffortError } from '../src/llm/effort.js';
import { OpenAiCompatibleProvider } from '../src/llm/openai.js';
import type { LlmRequest } from '../src/llm/types.js';

// The effort setting at the wire: what each adapter sends the provider. Only the external SDKs are
// mocked; the real adapters run. No request leaves the process.
const wire = vi.hoisted(() => ({
  anthropic: [] as Record<string, unknown>[],
  openai: [] as Record<string, unknown>[],
  failWith: undefined as Error | undefined,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    public readonly messages = {
      stream(request: Record<string, unknown>) {
        wire.anthropic.push(structuredClone(request));
        if (wire.failWith !== undefined) {
          throw wire.failWith;
        }
        return {
          on(): void {},
          async finalMessage(): Promise<Partial<Anthropic.Message>> {
            return {
              content: [{ type: 'text', text: 'ok', citations: null }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 } as Anthropic.Usage,
            };
          },
        };
      },
      async create(request: Record<string, unknown>) {
        wire.anthropic.push(structuredClone(request));
        return { content: [{ type: 'text', text: 'summary' }] };
      },
    };
  },
}));

vi.mock('openai', () => ({
  default: class {
    public readonly chat = {
      completions: {
        create: async (request: Record<string, unknown>) => {
          wire.openai.push(structuredClone(request));
          if (wire.failWith !== undefined) {
            throw wire.failWith;
          }
          return (async function* () {
            yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] };
          })();
        },
      },
    };
  },
}));

beforeEach(() => {
  wire.anthropic.length = 0;
  wire.openai.length = 0;
  wire.failWith = undefined;
});

function request(model: string, effort?: LlmRequest['effort']): LlmRequest {
  return {
    system: 'Persona',
    messages: [{ role: 'user', content: 'Hi' }],
    tools: [],
    model,
    maxTokens: 1024,
    ...(effort !== undefined ? { effort } : {}),
  };
}

describe('Anthropic adapter effort', () => {
  it('sends output_config.effort when an effort is set', async () => {
    await new AnthropicProvider('key').runTurn(request('claude-sonnet-4-6', 'high'), () => {});
    expect(wire.anthropic[0]?.['output_config']).toEqual({ effort: 'high' });
  });

  it('sends no output_config at all when no effort is set', async () => {
    await new AnthropicProvider('key').runTurn(request('claude-sonnet-4-6'), () => {});
    expect(wire.anthropic[0]).not.toHaveProperty('output_config');
  });

  it('fails before the provider call when the model cannot take the level', async () => {
    await expect(
      new AnthropicProvider('key').runTurn(request('claude-sonnet-4-6', 'xhigh'), () => {}),
    ).rejects.toThrow(UnsupportedEffortError);
    expect(wire.anthropic).toHaveLength(0);
  });

  it('maps a provider 400 about effort for a model outside the table', async () => {
    wire.failWith = Object.assign(new Error('400 effort is not supported by this model'), {
      status: 400,
    });
    await expect(
      new AnthropicProvider('key').runTurn(request('my-proxy-model', 'max'), () => {}),
    ).rejects.toThrow("The provider rejected effort 'max' for model 'my-proxy-model'");
  });

  it('does not add effort to the one-shot summary completion', async () => {
    await new AnthropicProvider('key').complete({
      system: 'S',
      userText: 'U',
      model: 'claude-haiku-4-5',
      maxTokens: 512,
    });
    expect(wire.anthropic[0]).not.toHaveProperty('output_config');
  });
});

describe('OpenAI-compatible adapter effort', () => {
  it('sends reasoning_effort for a reasoning model', async () => {
    await new OpenAiCompatibleProvider('key').runTurn(request('gpt-5-mini', 'low'), () => {});
    expect(wire.openai[0]?.['reasoning_effort']).toBe('low');
    expect(wire.openai[0]).toHaveProperty('max_completion_tokens', 1024);
  });

  it('sends no reasoning_effort when no effort is set', async () => {
    await new OpenAiCompatibleProvider('key').runTurn(request('gpt-5-mini'), () => {});
    expect(wire.openai[0]).not.toHaveProperty('reasoning_effort');
  });

  it('sends no reasoning_effort for a model that is not a reasoning model', async () => {
    await new OpenAiCompatibleProvider('key').runTurn(request('gpt-4.1', 'high'), () => {});
    expect(wire.openai[0]).not.toHaveProperty('reasoning_effort');
  });

  it('maps a provider 400 about the level to a clear error naming model and level', async () => {
    wire.failWith = Object.assign(
      new Error("400 Unsupported value: 'max' is not supported with reasoning_effort"),
      { status: 400 },
    );
    await expect(
      new OpenAiCompatibleProvider('key').runTurn(request('gpt-5-mini', 'max'), () => {}),
    ).rejects.toThrow("The provider rejected effort 'max' for model 'gpt-5-mini'");
  });

  it('passes an unrelated provider error through unchanged', async () => {
    wire.failWith = Object.assign(new Error('503 overloaded'), { status: 503 });
    await expect(
      new OpenAiCompatibleProvider('key').runTurn(request('gpt-5-mini', 'low'), () => {}),
    ).rejects.toThrow('503 overloaded');
  });
});
