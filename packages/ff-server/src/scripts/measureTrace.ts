// The per-turn trace the chat-turn measurement script can write alongside its metrics: each tool
// call's arguments and (capped) result, the final answer and the playthrough's work orders. The
// metrics alone show how many calls a turn made; the trace shows whether they were redundant and
// whether the answer was any good. Besides the recording provider, pure functions, testable offline.

import type { LlmProvider } from '../llm/provider.js';
import type { LlmRequest, NeutralMessage } from '../llm/types.js';
import type { WorkOrder } from '../types.js';

/** Keeps the last request the chat loop sent, so the turn's tool calls can be measured and traced. */
export class RecordingProvider implements LlmProvider {
  public lastRequest: LlmRequest | undefined;
  public constructor(private readonly inner: LlmProvider) {}
  public runTurn(...args: Parameters<LlmProvider['runTurn']>): ReturnType<LlmProvider['runTurn']> {
    this.lastRequest = args[0];
    return this.inner.runTurn(...args);
  }
  public complete(...args: Parameters<LlmProvider['complete']>): Promise<string> {
    return this.inner.complete(...args);
  }
}

/** One tool call the model made, with what it asked for and what it got back. */
export interface TracedToolCall {
  /** 1-based model round that requested the call. */
  round: number;
  name: string;
  arguments: Record<string, unknown>;
  isError: boolean;
  /** Full length of the result the model received. */
  resultChars: number;
  /** The result, cut to the trace's result cap. */
  result: string;
  resultTruncated: boolean;
}

/** Everything one scenario turn did, written one JSON object per line to the trace file. */
export interface TurnTrace {
  scenario: string;
  run: number;
  /** 0-based turn index within the scenario. */
  turn: number;
  /** True for the turn the metrics record; false for preparation turns. */
  measured: boolean;
  question: string;
  contextBlocks: string[];
  toolCalls: TracedToolCall[];
  answer: string;
  /** The playthrough's work orders after this turn. */
  workOrders: WorkOrder[];
}

/**
 * The tool calls of the current turn, in request order, from the last request's message list.
 * Persisted history holds only text, so every assistant tool-call message here belongs to this
 * turn; each one is a model round. Results longer than `resultCap` characters are cut.
 */
export function traceToolCalls(messages: NeutralMessage[], resultCap: number): TracedToolCall[] {
  const calls = new Map<string, TracedToolCall>();
  let round = 0;
  for (const message of messages) {
    if (message.role === 'assistant' && 'toolCalls' in message) {
      round += 1;
      for (const call of message.toolCalls) {
        calls.set(call.id, {
          round,
          name: call.name,
          arguments: call.arguments,
          isError: false,
          resultChars: 0,
          result: '',
          resultTruncated: false,
        });
      }
    } else if (message.role === 'tool') {
      const traced = calls.get(message.toolCallId);
      if (traced !== undefined) {
        traced.isError = message.isError;
        traced.resultChars = message.content.length;
        traced.result = message.content.slice(0, resultCap);
        traced.resultTruncated = message.content.length > resultCap;
      }
    }
  }
  return [...calls.values()];
}
