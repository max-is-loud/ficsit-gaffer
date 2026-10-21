import { describe, expect, it } from 'vitest';

import { formatTurnMetrics, TurnMetricsRecorder } from '../src/llm/turnMetrics.js';
import type { LlmTurnResult } from '../src/llm/types.js';

function round(usage: LlmTurnResult['usage'], rawStopReason?: string): LlmTurnResult {
  return { text: '', toolCalls: [], stopReason: 'tool_use', usage, rawStopReason };
}

describe('TurnMetricsRecorder', () => {
  it('sums usage across rounds and counts them', () => {
    const recorder = new TurnMetricsRecorder();
    recorder.recordRound(
      round({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0 }),
    );
    recorder.recordRound(
      round(
        { inputTokens: 20, outputTokens: 7, cacheReadTokens: 110, cacheWriteTokens: 30 },
        'end_turn',
      ),
    );
    const metrics = recorder.finish(false);
    expect(metrics.rounds).toBe(2);
    expect(metrics.usage).toEqual({
      inputTokens: 30,
      outputTokens: 12,
      cacheReadTokens: 210,
      cacheWriteTokens: 30,
    });
    expect(metrics.stopReason).toBe('end_turn');
    expect(metrics.hitIterationCap).toBe(false);
  });

  it('adds nothing for a round without usage', () => {
    const recorder = new TurnMetricsRecorder();
    recorder.recordRound(round(undefined));
    const metrics = recorder.finish(true);
    expect(metrics.rounds).toBe(1);
    expect(metrics.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(metrics.stopReason).toBe('tool_use');
    expect(metrics.hitIterationCap).toBe(true);
  });

  it('records tool calls in order across rounds', () => {
    const recorder = new TurnMetricsRecorder();
    recorder.recordToolCalls([
      { id: 'a', name: 'get_recipe', arguments: {} },
      { id: 'b', name: 'get_building', arguments: {} },
    ]);
    recorder.recordToolCalls([{ id: 'c', name: 'get_recipe', arguments: {} }]);
    expect(recorder.finish(false).toolCalls).toEqual(['get_recipe', 'get_building', 'get_recipe']);
  });
});

describe('formatTurnMetrics', () => {
  it('renders one log line', () => {
    const line = formatTurnMetrics({
      rounds: 7,
      toolCalls: new Array<string>(30).fill('get_recipe'),
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
      stopReason: 'end_turn',
      durationMs: 1234,
      hitIterationCap: false,
    });
    expect(line).toBe(
      'Chat turn: rounds=7 tools=30 input=1 cacheRead=3 cacheWrite=4 output=2 stop=end_turn ms=1234',
    );
  });

  it('flags a turn that hit the iteration cap', () => {
    const line = formatTurnMetrics({
      rounds: 12,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: 'tool_use',
      durationMs: 5,
      hitIterationCap: true,
    });
    expect(line).toContain('stop=tool_use (iteration cap)');
  });
});
