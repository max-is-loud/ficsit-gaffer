import { describe, expect, it } from 'vitest';

import type { NeutralMessage } from '../src/llm/types.js';
import { traceToolCalls } from '../src/scripts/measureTrace.js';

describe('traceToolCalls', () => {
  it('numbers rounds, pairs results with calls and caps result text', () => {
    const messages: NeutralMessage[] = [
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'Copper?' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [
          { id: 'a', name: 'get_production', arguments: { item: 'Copper Ingot' } },
          { id: 'b', name: 'get_milestones', arguments: {} },
        ],
      },
      { role: 'tool', toolCallId: 'b', content: 'tier 3', isError: false },
      { role: 'tool', toolCallId: 'a', content: '0123456789abc', isError: true },
      {
        role: 'assistant',
        text: 'Checking recipes',
        toolCalls: [{ id: 'c', name: 'recipes_for', arguments: { items: ['Wire'] } }],
      },
      { role: 'tool', toolCallId: 'c', content: 'Wire ok', isError: false },
    ];

    expect(traceToolCalls(messages, 10)).toEqual([
      {
        round: 1,
        name: 'get_production',
        arguments: { item: 'Copper Ingot' },
        isError: true,
        resultChars: 13,
        result: '0123456789',
        resultTruncated: true,
      },
      {
        round: 1,
        name: 'get_milestones',
        arguments: {},
        isError: false,
        resultChars: 6,
        result: 'tier 3',
        resultTruncated: false,
      },
      {
        round: 2,
        name: 'recipes_for',
        arguments: { items: ['Wire'] },
        isError: false,
        resultChars: 7,
        result: 'Wire ok',
        resultTruncated: false,
      },
    ]);
  });

  it('returns no calls for a turn answered without tools', () => {
    expect(traceToolCalls([{ role: 'user', content: 'Hi' }], 10)).toEqual([]);
  });
});
