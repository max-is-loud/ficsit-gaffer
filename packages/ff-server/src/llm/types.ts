import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages';

import type { ToolDefinition } from '../mcp/client.js';

/**
 * Provider-neutral LLM types. The chat loop speaks only these shapes; each
 * provider adapter (Anthropic native, OpenAI-compatible) translates them to and
 * from its own wire format. This is the seam that lets the foreman run on any
 * supported frontier provider without the loop knowing which.
 */

export type ProviderKind = 'anthropic' | 'openai';

/** A tool the model asked to call, with arguments already parsed to an object. */
export interface NeutralToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** A plain conversational turn (persisted history is only ever these). */
export interface NeutralTextMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Native content for replay within one request; never persisted as chat text. */
export type ProviderContinuation = { provider: 'anthropic'; content: ContentBlock[] };

/** An assistant turn that produced text and/or tool calls (in-loop only). */
export interface NeutralAssistantTurn {
  role: 'assistant';
  text: string;
  toolCalls: NeutralToolCall[];
  /** Opaque to the shared loop; only the matching provider interprets it. */
  continuation?: ProviderContinuation;
}

/** The result of running one tool, fed back to the model (in-loop only). */
export interface NeutralToolResult {
  role: 'tool';
  toolCallId: string;
  content: string;
  isError: boolean;
}

export type NeutralMessage = NeutralTextMessage | NeutralAssistantTurn | NeutralToolResult;

/** Normalized streaming events the loop receives as a turn unfolds. */
export type LlmStreamEvent =
  { type: 'text'; delta: string } | { type: 'tool_call'; call: NeutralToolCall };

/** Why a turn ended: the model wants tools run, or it is finished. */
export type StopReason = 'stop' | 'tool_use';

/** The assembled outcome of a single turn. */
export interface LlmTurnResult {
  /** Full assistant text emitted this turn. */
  text: string;
  /** Tool calls to run (empty when stopReason is 'stop'). */
  toolCalls: NeutralToolCall[];
  stopReason: StopReason;
  /** Complete native assistant content needed to continue a tool-use loop. */
  continuation?: ProviderContinuation;
}

/** A single turn request to a provider. */
export interface LlmRequest {
  system: string;
  messages: NeutralMessage[];
  tools: ToolDefinition[];
  model: string;
  maxTokens: number;
}

/** A one-shot non-streaming completion (used for session summaries). */
export interface LlmCompletionRequest {
  system: string;
  userText: string;
  model: string;
  maxTokens: number;
}

/**
 * Everything needed to construct a provider for one request: which provider,
 * which models, and the credentials. Resolved per request (client override →
 * server default).
 */
export interface LlmRuntimeConfig {
  providerKind: ProviderKind;
  model: string;
  summaryModel: string;
  maxTokens: number;
  summaryMaxTokens: number;
  apiKey: string;
  /** Base URL override — only meaningful for the OpenAI-compatible provider. */
  baseUrl?: string;
}
