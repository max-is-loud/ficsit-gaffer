import { describe, expect, it } from 'vitest';

import {
  chatRequestBody,
  MAX_HISTORY_WINDOW,
  MIN_HISTORY_WINDOW,
  parseEffortSetting,
  parseHistoryWindow,
  toClientLlmConfig,
  type LlmSettings,
} from './llmSettings.js';

describe('parseHistoryWindow', () => {
  it('returns 0 (server default) for blank or non-numeric input', () => {
    expect(parseHistoryWindow('')).toBe(0);
    expect(parseHistoryWindow('   ')).toBe(0);
    expect(parseHistoryWindow('abc')).toBe(0);
  });

  it('returns 0 for zero and negative values', () => {
    expect(parseHistoryWindow('0')).toBe(0);
    expect(parseHistoryWindow('-5')).toBe(0);
  });

  it('clamps to the server-accepted range', () => {
    expect(parseHistoryWindow('1')).toBe(MIN_HISTORY_WINDOW);
    expect(parseHistoryWindow('9999')).toBe(MAX_HISTORY_WINDOW);
  });

  it('passes in-range values through, ignoring whitespace', () => {
    expect(parseHistoryWindow('20')).toBe(20);
    expect(parseHistoryWindow(' 42 ')).toBe(42);
    expect(parseHistoryWindow(String(MIN_HISTORY_WINDOW))).toBe(MIN_HISTORY_WINDOW);
    expect(parseHistoryWindow(String(MAX_HISTORY_WINDOW))).toBe(MAX_HISTORY_WINDOW);
  });
});

describe('parseEffortSetting', () => {
  it('keeps a known level, ignoring case and whitespace', () => {
    expect(parseEffortSetting('high')).toBe('high');
    expect(parseEffortSetting(' XHIGH ')).toBe('xhigh');
  });

  it('returns the empty string (server default) for blank or unknown input', () => {
    expect(parseEffortSetting('')).toBe('');
    expect(parseEffortSetting('extreme')).toBe('');
  });
});

const BASE_SETTINGS: LlmSettings = {
  apiKey: '',
  provider: '',
  model: '',
  baseUrl: '',
  effort: '',
  historyWindow: 0,
};

describe('toClientLlmConfig', () => {
  it('leaves every field unset for default settings, so nothing is sent', () => {
    expect(toClientLlmConfig(BASE_SETTINGS)).toEqual({
      provider: undefined,
      model: undefined,
      baseUrl: undefined,
      effort: undefined,
      historyWindow: undefined,
    });
  });

  it('carries the chosen values', () => {
    expect(
      toClientLlmConfig({
        ...BASE_SETTINGS,
        provider: 'openai',
        model: 'gpt-5-mini',
        baseUrl: 'https://x/v1',
        effort: 'low',
        historyWindow: 30,
      }),
    ).toEqual({
      provider: 'openai',
      model: 'gpt-5-mini',
      baseUrl: 'https://x/v1',
      effort: 'low',
      historyWindow: 30,
    });
  });

  it('drops an unknown provider or effort', () => {
    const config = toClientLlmConfig({ ...BASE_SETTINGS, provider: 'other', effort: 'extreme' });
    expect(config.provider).toBeUndefined();
    expect(config.effort).toBeUndefined();
  });
});

describe('chatRequestBody', () => {
  it('sends only the message when no override is set', () => {
    expect(chatRequestBody('hi', {})).toEqual({ message: 'hi' });
  });

  it('adds each override that is set, effort included', () => {
    expect(
      chatRequestBody('hi', {
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        baseUrl: 'https://proxy/v1',
        effort: 'high',
        historyWindow: 40,
      }),
    ).toEqual({
      message: 'hi',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      baseUrl: 'https://proxy/v1',
      effort: 'high',
      historyWindow: 40,
    });
  });

  it('leaves out empty strings and a zero window', () => {
    expect(chatRequestBody('hi', { model: '', baseUrl: '', historyWindow: 0 })).toEqual({
      message: 'hi',
    });
  });
});
