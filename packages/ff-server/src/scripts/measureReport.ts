// The measured-turn record written by the chat-turn measurement script, and the statistics and
// markdown table it reports. Pure functions, so the report is testable without a model.

import type { NeutralMessage, TurnUsage } from '../llm/types.js';

/** One measured chat turn, as written (one JSON object per line) to the results file. */
export interface MeasuredTurn {
  scenario: string;
  run: number;
  rounds: number;
  /** Calls per tool name. */
  toolCalls: Record<string, number>;
  /** Characters of tool output returned to the model, per tool name. */
  toolResultChars: Record<string, number>;
  usage: TurnUsage;
  inputEquivalent: number;
  stopReason: string;
  durationMs: number;
}

/**
 * Input tokens weighted by Anthropic's 5-minute cache prices: writes cost 1.25× and reads
 * 0.1× the base input rate. Output tokens are not included.
 */
export function inputEquivalent(usage: TurnUsage): number {
  return usage.inputTokens + 1.25 * usage.cacheWriteTokens + 0.1 * usage.cacheReadTokens;
}

/** Median, minimum and maximum of a non-empty list. */
export function spread(values: number[]): { median: number; min: number; max: number } {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  return { median, min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0 };
}

/** The table's metric columns, in order: heading, value per turn and decimal places. */
const COLUMNS: { heading: string; value: (turn: MeasuredTurn) => number; digits: number }[] = [
  { heading: 'Rounds', value: (turn) => turn.rounds, digits: 0 },
  {
    heading: 'Tool calls',
    value: (turn) => Object.values(turn.toolCalls).reduce((sum, count) => sum + count, 0),
    digits: 0,
  },
  { heading: 'Input', value: (turn) => turn.usage.inputTokens, digits: 0 },
  { heading: 'Cache read', value: (turn) => turn.usage.cacheReadTokens, digits: 0 },
  { heading: 'Cache write', value: (turn) => turn.usage.cacheWriteTokens, digits: 0 },
  { heading: 'Output', value: (turn) => turn.usage.outputTokens, digits: 0 },
  { heading: 'Input-equivalent', value: (turn) => turn.inputEquivalent, digits: 0 },
  { heading: 'Seconds', value: (turn) => turn.durationMs / 1000, digits: 1 },
];

function cell(values: number[], digits: number): string {
  const { median, min, max } = spread(values);
  return `${median.toFixed(digits)} (${min.toFixed(digits)}–${max.toFixed(digits)})`;
}

/** A markdown table with one row per scenario; each cell is `median (min–max)`. */
export function renderReportTable(turns: MeasuredTurn[]): string {
  const headings = ['Scenario', 'Runs', ...COLUMNS.map((column) => column.heading)];
  const lines = [`| ${headings.join(' | ')} |`, `|${headings.map(() => '---').join('|')}|`];
  const scenarios = [...new Set(turns.map((turn) => turn.scenario))];
  for (const scenario of scenarios) {
    const rows = turns.filter((turn) => turn.scenario === scenario);
    const cells = COLUMNS.map((column) => cell(rows.map(column.value), column.digits));
    lines.push(`| ${scenario} | ${rows.length} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** Mean calls per run for each tool, per scenario — shows which lookups a change removed. */
export function renderToolTable(turns: MeasuredTurn[]): string {
  const lines = ['| Scenario | Tool | Calls per run | Result chars per run |', '|---|---|---|---|'];
  const scenarios = [...new Set(turns.map((turn) => turn.scenario))];
  for (const scenario of scenarios) {
    const rows = turns.filter((turn) => turn.scenario === scenario);
    const tools = [...new Set(rows.flatMap((turn) => Object.keys(turn.toolCalls)))].sort();
    for (const tool of tools) {
      const calls = rows.reduce((sum, turn) => sum + (turn.toolCalls[tool] ?? 0), 0);
      const chars = rows.reduce((sum, turn) => sum + (turn.toolResultChars[tool] ?? 0), 0);
      lines.push(
        `| ${scenario} | ${tool} | ${(calls / rows.length).toFixed(1)} | ` +
          `${Math.round(chars / rows.length)} |`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * Characters of tool output the model actually received, per tool name, from a request's
 * message list. Counted here rather than at the MCP gateway, which also sees the work-order
 * tools' internal name lookups.
 */
export function toolResultCharsByName(messages: NeutralMessage[]): Record<string, number> {
  const names = new Map<string, string>();
  const chars: Record<string, number> = {};
  for (const message of messages) {
    if (message.role === 'assistant' && 'toolCalls' in message) {
      message.toolCalls.forEach((call) => names.set(call.id, call.name));
    } else if (message.role === 'tool') {
      const name = names.get(message.toolCallId) ?? 'unknown';
      chars[name] = (chars[name] ?? 0) + message.content.length;
    }
  }
  return chars;
}
