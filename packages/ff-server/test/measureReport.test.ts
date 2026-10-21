import { describe, expect, it } from 'vitest';

import {
  inputEquivalent,
  renderReportTable,
  renderToolTable,
  spread,
  toolResultCharsByName,
  type MeasuredTurn,
} from '../src/scripts/measureReport.js';

function turn(scenario: string, rounds: number, input: number): MeasuredTurn {
  return {
    scenario,
    run: 1,
    rounds,
    toolCalls: { get_recipe: rounds },
    toolResultChars: { get_recipe: 100 },
    usage: { inputTokens: input, outputTokens: 10, cacheReadTokens: 1000, cacheWriteTokens: 200 },
    inputEquivalent: inputEquivalent({
      inputTokens: input,
      outputTokens: 10,
      cacheReadTokens: 1000,
      cacheWriteTokens: 200,
    }),
    stopReason: 'end_turn',
    durationMs: 2000,
  };
}

describe('inputEquivalent', () => {
  it('weights cache writes at 1.25 and cache reads at 0.1', () => {
    expect(
      inputEquivalent({
        inputTokens: 100,
        outputTokens: 999,
        cacheReadTokens: 1000,
        cacheWriteTokens: 200,
      }),
    ).toBe(450);
  });
});

describe('spread', () => {
  it('gives the median, minimum and maximum', () => {
    expect(spread([5, 1, 3])).toEqual({ median: 3, min: 1, max: 5 });
  });

  it('averages the middle pair for an even count', () => {
    expect(spread([1, 2, 3, 4])).toEqual({ median: 2.5, min: 1, max: 4 });
  });
});

describe('renderReportTable', () => {
  it('renders one row per scenario with median (min–max) cells', () => {
    const table = renderReportTable([
      turn('iron-near-me', 3, 100),
      turn('iron-near-me', 5, 300),
      turn('power-plan', 2, 50),
    ]);
    const lines = table.split('\n');
    expect(lines[0]).toBe(
      '| Scenario | Runs | Rounds | Tool calls | Input | Cache read | Cache write | Output | Input-equivalent | Seconds |',
    );
    expect(lines[2]).toBe(
      '| iron-near-me | 2 | 4 (3–5) | 4 (3–5) | 200 (100–300) | 1000 (1000–1000) | 200 (200–200) | 10 (10–10) | 550 (450–650) | 2.0 (2.0–2.0) |',
    );
    expect(lines[3]).toContain('| power-plan | 1 |');
  });
});

describe('renderToolTable', () => {
  it('gives mean calls and result characters per run for each tool', () => {
    const table = renderToolTable([turn('iron-near-me', 3, 100), turn('iron-near-me', 5, 300)]);
    expect(table.split('\n')[2]).toBe('| iron-near-me | get_recipe | 4.0 | 100 |');
  });
});

describe('toolResultCharsByName', () => {
  it('sums tool result text per tool name, matched through the call ids', () => {
    expect(
      toolResultCharsByName([
        { role: 'user', content: 'question' },
        {
          role: 'assistant',
          text: '',
          toolCalls: [
            { id: 'a', name: 'get_recipe', arguments: {} },
            { id: 'b', name: 'get_power', arguments: {} },
          ],
        },
        { role: 'tool', toolCallId: 'a', content: '12345', isError: false },
        { role: 'tool', toolCallId: 'b', content: '12', isError: false },
        {
          role: 'assistant',
          text: '',
          toolCalls: [{ id: 'c', name: 'get_recipe', arguments: {} }],
        },
        { role: 'tool', toolCallId: 'c', content: '123', isError: false },
      ]),
    ).toEqual({ get_recipe: 8, get_power: 2 });
  });
});
