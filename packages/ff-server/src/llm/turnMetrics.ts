// Accumulates the per-round token usage, tool calls and stop reason of one chat turn, and formats
// them as the single log line used to compare turns before and after tuning.

import type { LlmTurnResult, NeutralToolCall, TurnUsage } from './types.js';

/** What one chat turn cost: model rounds, tool calls and summed token usage. */
export interface TurnMetrics {
  rounds: number;
  /** Tool names in the order the model called them, across all rounds. */
  toolCalls: string[];
  usage: TurnUsage;
  /** The final round's provider stop reason (raw when the provider gave one). */
  stopReason: string;
  durationMs: number;
  /** True when the turn ended because it ran out of tool rounds. */
  hitIterationCap: boolean;
}

/** Collects a turn's metrics round by round; the clock starts at construction. */
export class TurnMetricsRecorder {
  private readonly startedAt = Date.now();
  private rounds = 0;
  private stopReason = 'none';
  private readonly toolCalls: string[] = [];
  private readonly usage: TurnUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  public recordRound(result: LlmTurnResult): void {
    this.rounds += 1;
    this.stopReason = result.rawStopReason ?? result.stopReason;
    if (result.usage !== undefined) {
      this.usage.inputTokens += result.usage.inputTokens;
      this.usage.outputTokens += result.usage.outputTokens;
      this.usage.cacheReadTokens += result.usage.cacheReadTokens;
      this.usage.cacheWriteTokens += result.usage.cacheWriteTokens;
    }
  }

  public recordToolCalls(calls: NeutralToolCall[]): void {
    this.toolCalls.push(...calls.map((call) => call.name));
  }

  public finish(hitIterationCap: boolean): TurnMetrics {
    return {
      rounds: this.rounds,
      toolCalls: [...this.toolCalls],
      usage: { ...this.usage },
      stopReason: this.stopReason,
      durationMs: Date.now() - this.startedAt,
      hitIterationCap,
    };
  }
}

/** One greppable line per turn, e.g. `Chat turn: rounds=7 tools=30 input=… ms=…`. */
export function formatTurnMetrics(metrics: TurnMetrics): string {
  const { usage } = metrics;
  const stop = metrics.hitIterationCap
    ? `${metrics.stopReason} (iteration cap)`
    : metrics.stopReason;
  return (
    `Chat turn: rounds=${metrics.rounds} tools=${metrics.toolCalls.length} ` +
    `input=${usage.inputTokens} cacheRead=${usage.cacheReadTokens} ` +
    `cacheWrite=${usage.cacheWriteTokens} output=${usage.outputTokens} ` +
    `stop=${stop} ms=${metrics.durationMs}`
  );
}
