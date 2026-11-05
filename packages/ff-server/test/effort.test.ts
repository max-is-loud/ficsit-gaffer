import { describe, expect, it } from 'vitest';

import {
  anthropicEffortParam,
  assertEffortSupported,
  EFFORT_LEVELS,
  effortRejection,
  isReasoningModel,
  openAiEffortParam,
  parseEffortLevel,
  supportedAnthropicEfforts,
  UnsupportedEffortError,
} from '../src/llm/effort.js';
import { chatSchema } from '../src/validation.js';

describe('parseEffortLevel', () => {
  it('accepts each level, ignoring case and surrounding space', () => {
    for (const level of EFFORT_LEVELS) {
      expect(parseEffortLevel(` ${level.toUpperCase()} `, 'LLM_EFFORT')).toBe(level);
    }
  });

  it('treats unset and blank as no effort', () => {
    expect(parseEffortLevel(undefined, 'LLM_EFFORT')).toBeUndefined();
    expect(parseEffortLevel('   ', 'LLM_EFFORT')).toBeUndefined();
  });

  it('names the setting and the allowed values when the level is invalid', () => {
    expect(() => parseEffortLevel('extreme', 'LLM_EFFORT')).toThrow(
      "LLM_EFFORT must be one of low, medium, high, xhigh, max; got 'extreme'.",
    );
  });
});

describe('supportedAnthropicEfforts', () => {
  it('gives every level to the current Claude families', () => {
    for (const model of [
      'claude-fable-5-1',
      'claude-mythos-5-1',
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-5-5',
      'claude-sonnet-5',
      'claude-haiku-5-5',
    ]) {
      expect(supportedAnthropicEfforts(model), model).toEqual(EFFORT_LEVELS);
    }
  });

  it('leaves out xhigh for Opus 4.6 and Sonnet 4.6', () => {
    expect(supportedAnthropicEfforts('claude-sonnet-4-6')).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ]);
    expect(supportedAnthropicEfforts('claude-opus-4-6')).toEqual(['low', 'medium', 'high', 'max']);
  });

  it('gives Opus 4.5 low, medium and high only', () => {
    expect(supportedAnthropicEfforts('claude-opus-4-5-20251101')).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('gives no level to each model without an effort parameter, by dated ID and alias', () => {
    for (const model of [
      'claude-haiku-4-5',
      'claude-haiku-4-5-20251001',
      'claude-haiku-4-5-latest',
      'claude-sonnet-4-5',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-opus-4-1-20250805',
      'claude-3-5-sonnet-20241022',
      'claude-3-7-sonnet-latest',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ]) {
      expect(supportedAnthropicEfforts(model), model).toEqual([]);
    }
  });

  it('matches a dated ID, an alias and a cloud-provider ID to the row of the family', () => {
    for (const model of [
      'claude-opus-4-6-latest',
      'claude-sonnet-4-6-20260101',
      'anthropic.claude-sonnet-4-6',
    ]) {
      expect(supportedAnthropicEfforts(model), model).toEqual(['low', 'medium', 'high', 'max']);
    }
    for (const model of [
      'anthropic.claude-opus-4-5-20251101-v1:0',
      'claude-opus-4-5@20251101',
      'us.anthropic.claude-opus-4-5-20251101-v1:0',
    ]) {
      expect(supportedAnthropicEfforts(model), model).toEqual(['low', 'medium', 'high']);
    }
    expect(supportedAnthropicEfforts('claude-opus-5-5-latest')).toEqual(EFFORT_LEVELS);
  });

  it('tolerates a cloud-provider prefix on the model id', () => {
    expect(supportedAnthropicEfforts('anthropic.claude-opus-5-5')).toEqual(EFFORT_LEVELS);
  });

  it('returns undefined for a model it does not know', () => {
    expect(supportedAnthropicEfforts('my-proxy-model')).toBeUndefined();
  });

  it('returns undefined for a version that is not listed, so the level passes through', () => {
    for (const model of [
      'claude-sonnet-4-7',
      'claude-opus-4-9',
      'claude-sonnet-4-60',
      'claude-haiku-50',
      'claude-opus-4-10',
      'claude-haiku-5',
      'claude-sonnet-3-8',
      'claude-3-5-turbo-20250101',
      'claude-opus-5-9',
    ]) {
      expect(supportedAnthropicEfforts(model), model).toBeUndefined();
      expect(anthropicEffortParam(model, 'max'), model).toEqual({
        output_config: { effort: 'max' },
      });
    }
  });
});

describe('anthropicEffortParam', () => {
  it('sends nothing when no effort is set', () => {
    expect(anthropicEffortParam('claude-sonnet-4-6', undefined)).toEqual({});
  });

  it('puts the level in output_config', () => {
    expect(anthropicEffortParam('claude-sonnet-4-6', 'high')).toEqual({
      output_config: { effort: 'high' },
    });
  });

  it('throws before any request when the model does not accept the level', () => {
    expect(() => anthropicEffortParam('claude-sonnet-4-6', 'xhigh')).toThrow(
      UnsupportedEffortError,
    );
    expect(() => anthropicEffortParam('claude-sonnet-4-6', 'xhigh')).toThrow(
      "Model 'claude-sonnet-4-6' does not support effort 'xhigh'; it accepts low, medium, high, max.",
    );
  });

  it('names a model with no effort parameter at all', () => {
    expect(() => anthropicEffortParam('claude-haiku-4-5', 'low')).toThrow(
      "Model 'claude-haiku-4-5' does not support effort 'low'; it has no effort setting.",
    );
  });

  it('passes the level through for a model it does not know', () => {
    expect(anthropicEffortParam('my-proxy-model', 'max')).toEqual({
      output_config: { effort: 'max' },
    });
  });
});

describe('assertEffortSupported', () => {
  it('does nothing without an effort, whatever the model', () => {
    expect(() => assertEffortSupported('anthropic', 'claude-haiku-4-5', undefined)).not.toThrow();
  });

  it('checks Anthropic models against the table', () => {
    expect(() => assertEffortSupported('anthropic', 'claude-haiku-4-5', 'low')).toThrow(
      UnsupportedEffortError,
    );
    expect(() => assertEffortSupported('anthropic', 'claude-opus-5-5', 'max')).not.toThrow();
  });

  it('never rejects an OpenAI-compatible model up front', () => {
    expect(() => assertEffortSupported('openai', 'gpt-4.1', 'max')).not.toThrow();
  });
});

describe('isReasoningModel / openAiEffortParam', () => {
  it('recognises the GPT-5 family and o-series, with a provider prefix', () => {
    for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5.4-mini', 'o3', 'o4-mini', 'openai/gpt-5']) {
      expect(isReasoningModel(model), model).toBe(true);
    }
    for (const model of ['gpt-4.1', 'gpt-4o', 'llama3.1', 'qwen3:32b']) {
      expect(isReasoningModel(model), model).toBe(false);
    }
  });

  it('sends reasoning_effort for a reasoning model', () => {
    expect(openAiEffortParam('gpt-5-mini', 'medium')).toEqual({ reasoning_effort: 'medium' });
    expect(openAiEffortParam('o3', 'xhigh')).toEqual({ reasoning_effort: 'xhigh' });
  });

  it('sends nothing for a model that is not a reasoning model', () => {
    expect(openAiEffortParam('gpt-4.1', 'high')).toEqual({});
    expect(openAiEffortParam('llama3.1', 'high')).toEqual({});
  });

  it('sends nothing when no effort is set', () => {
    expect(openAiEffortParam('gpt-5-mini', undefined)).toEqual({});
  });
});

describe('effortRejection', () => {
  it('turns a 400 that mentions effort into a clear error naming model and level', () => {
    const rejection = effortRejection(
      Object.assign(new Error('400 reasoning_effort: unsupported value'), { status: 400 }),
      'gpt-5-mini',
      'max',
    );
    expect(rejection).toBeInstanceOf(UnsupportedEffortError);
    expect(rejection?.message).toBe(
      "The provider rejected effort 'max' for model 'gpt-5-mini': 400 reasoning_effort: unsupported value",
    );
  });

  it('leaves other errors alone', () => {
    expect(effortRejection(new Error('boom'), 'm', 'low')).toBeUndefined();
    expect(
      effortRejection(Object.assign(new Error('invalid tools'), { status: 400 }), 'm', 'low'),
    ).toBeUndefined();
    expect(
      effortRejection(Object.assign(new Error('effort'), { status: 500 }), 'm', 'low'),
    ).toBeUndefined();
    expect(effortRejection('effort', 'm', 'low')).toBeUndefined();
  });

  it('leaves a request that sent no effort alone', () => {
    expect(
      effortRejection(Object.assign(new Error('effort'), { status: 400 }), 'm', undefined),
    ).toBeUndefined();
  });
});

describe('chatSchema effort', () => {
  it('accepts each level and the absence of one', () => {
    for (const level of EFFORT_LEVELS) {
      expect(chatSchema.safeParse({ message: 'hi', effort: level }).success).toBe(true);
    }
    expect(chatSchema.safeParse({ message: 'hi' }).success).toBe(true);
  });

  it('rejects a value that is not a level', () => {
    expect(chatSchema.safeParse({ message: 'hi', effort: 'extreme' }).success).toBe(false);
    expect(chatSchema.safeParse({ message: 'hi', effort: 3 }).success).toBe(false);
  });
});
