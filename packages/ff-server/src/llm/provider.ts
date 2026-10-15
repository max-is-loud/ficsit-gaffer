// The provider interface the chat loop and summariser depend on, and the factory type that builds
// one from a runtime config.

import type {
  LlmCompletionRequest,
  LlmRequest,
  LlmRuntimeConfig,
  LlmStreamEvent,
  LlmTurnResult,
} from './types.js';

/**
 * A frontier LLM provider the foreman can run on. Adapters implement this for
 * native Anthropic and the OpenAI-compatible API; the chat loop and summariser
 * depend only on this interface.
 */
export interface LlmProvider {
  /**
   * Runs one streamed turn. Emits normalized events (text deltas, assembled
   * tool calls) via `onEvent`, and resolves with the turn's full result.
   */
  runTurn(req: LlmRequest, onEvent: (event: LlmStreamEvent) => void): Promise<LlmTurnResult>;

  /** Runs a one-shot, non-streaming completion (for session summaries). */
  complete(req: LlmCompletionRequest): Promise<string>;
}

/** Constructs a provider from a per-request runtime config. */
export type LlmProviderFactory = (config: LlmRuntimeConfig) => LlmProvider;
