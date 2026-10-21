// LlmProvider adapter for OpenAI Chat Completions-compatible APIs. It translates neutral history to
// chat messages and assembles streamed fragments (including tool-call arguments) into a normalised
// turn result.

import OpenAI from 'openai';

import { logger } from '../logger.js';
import type { LlmProvider } from './provider.js';
import type {
  LlmCompletionRequest,
  LlmRequest,
  LlmStreamEvent,
  LlmTurnResult,
  NeutralMessage,
  NeutralToolCall,
  TurnUsage,
} from './types.js';

/**
 * Minimal shape of an OpenAI streaming chunk we depend on. Kept local (rather
 * than tied to the SDK's exact type) so the stream consumer can be unit-tested
 * with hand-built chunks.
 */
export interface OpenAiStreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  /** Sent on a final, choice-less chunk when `stream_options.include_usage` is set. */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
}

/** Maps OpenAI usage to neutral usage; cached prompt tokens are split out of input. */
function toTurnUsage(usage: NonNullable<OpenAiStreamChunk['usage']>): TurnUsage {
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: (usage.prompt_tokens ?? 0) - cached,
    outputTokens: usage.completion_tokens ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}

/**
 * Consumes an OpenAI-style streamed completion and assembles a normalized turn
 * result. Tool calls arrive as index-keyed fragments: `id`/`name` appear once,
 * `arguments` is a string built up across many chunks and parsed once at the
 * end. Exported for unit testing.
 */
export async function consumeOpenAiStream(
  stream: AsyncIterable<OpenAiStreamChunk>,
  onEvent: (event: LlmStreamEvent) => void,
): Promise<LlmTurnResult> {
  let text = '';
  let finishReason: string | null = null;
  const acc = new Map<number, { id: string; name: string; args: string }>();

  let usage: TurnUsage | undefined;

  for await (const chunk of stream) {
    if (chunk.usage !== undefined && chunk.usage !== null) {
      usage = toTurnUsage(chunk.usage);
    }
    const choice = chunk.choices?.[0];
    if (choice === undefined) {
      continue;
    }
    const content = choice.delta?.content;
    if (typeof content === 'string' && content.length > 0) {
      text += content;
      onEvent({ type: 'text', delta: content });
    }
    for (const fragment of choice.delta?.tool_calls ?? []) {
      const entry = acc.get(fragment.index) ?? { id: '', name: '', args: '' };
      if (fragment.id !== undefined) {
        entry.id = fragment.id;
      }
      if (fragment.function?.name !== undefined) {
        entry.name = fragment.function.name;
      }
      if (fragment.function?.arguments !== undefined) {
        entry.args += fragment.function.arguments;
      }
      acc.set(fragment.index, entry);
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      finishReason = choice.finish_reason;
    }
  }

  if (finishReason === 'length') {
    logger.warn('OpenAI response was truncated (finish_reason=length); returning partial turn.');
  }
  logger.info(
    `OpenAI usage: ${usage?.inputTokens ?? '?'} input, ${usage?.cacheReadTokens ?? '?'} ` +
      `cache-read, ${usage?.outputTokens ?? '?'} output; finish_reason=${finishReason ?? 'none'}.`,
  );

  const toolCalls = assembleToolCalls(acc, onEvent);
  return {
    text,
    toolCalls,
    stopReason: finishReason === 'tool_calls' ? 'tool_use' : 'stop',
    usage,
    rawStopReason: finishReason ?? undefined,
  };
}

/** Turns the index-keyed fragments into ordered tool calls, emitting each one. */
function assembleToolCalls(
  acc: Map<number, { id: string; name: string; args: string }>,
  onEvent: (event: LlmStreamEvent) => void,
): NeutralToolCall[] {
  const toolCalls: NeutralToolCall[] = [];
  for (const entry of [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value)) {
    if (entry.name.length === 0) {
      continue;
    }
    const call: NeutralToolCall = {
      id: entry.id,
      name: entry.name,
      arguments: parseArgs(entry.args),
    };
    toolCalls.push(call);
    onEvent({ type: 'tool_call', call });
  }
  return toolCalls;
}

function parseArgs(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {};
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    logger.warn(`Could not parse tool-call arguments as JSON: ${trimmed.slice(0, 120)}`);
    return {};
  }
}

/**
 * Picks the output-token-limit parameter for the model. OpenAI's GPT-5 family
 * and o-series reasoning models reject the legacy `max_tokens` with a 400 and
 * require `max_completion_tokens`; everything else (gpt-4.1/4o, Azure,
 * OpenRouter, local Ollama, …) still takes `max_tokens`. The `(^|/)` guard
 * tolerates an OpenRouter-style `openai/gpt-5-mini` prefix; the `[-.]` boundary
 * tolerates a dotted minor version such as `gpt-5.4-mini`. Exported for testing.
 */
export function tokenLimitParam(model: string, maxTokens: number): Record<string, number> {
  return /(^|\/)(gpt-5|o[1-4])([-.]|$)/.test(model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

/**
 * Adapter for any OpenAI Chat Completions-compatible API (OpenAI, Azure,
 * OpenRouter, Google's OpenAI-compatible endpoint, …). The base URL selects the
 * provider; the rest of the surface is identical.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  private readonly client: OpenAI;

  public constructor(apiKey: string, baseUrl?: string) {
    this.client = new OpenAI(baseUrl !== undefined ? { apiKey, baseURL: baseUrl } : { apiKey });
  }

  public async runTurn(
    req: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
  ): Promise<LlmTurnResult> {
    const stream = await this.client.chat.completions.create({
      model: req.model,
      ...tokenLimitParam(req.model, req.maxTokens),
      messages: toOpenAiMessages([req.system, ...(req.contextBlocks ?? [])], req.messages),
      tools: req.tools.map((tool) => ({
        type: 'function' as const,
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      })),
      stream: true,
      // Usage arrives on a final chunk; providers that ignore the option simply omit it.
      stream_options: { include_usage: true },
    });
    return consumeOpenAiStream(stream as AsyncIterable<OpenAiStreamChunk>, onEvent);
  }

  public async complete(req: LlmCompletionRequest): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: req.model,
      ...tokenLimitParam(req.model, req.maxTokens),
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.userText },
      ],
      stream: false,
    });
    return (response.choices[0]?.message?.content ?? '').trim();
  }
}

/**
 * Translates neutral history to OpenAI chat messages, after one system message per system text
 * (the persona, then each context block) so the provider's prefix cache keeps the persona.
 */
function toOpenAiMessages(
  systemTexts: string[],
  messages: NeutralMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = systemTexts.map((content) => ({
    role: 'system',
    content,
  }));
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content });
    } else if (message.role === 'tool') {
      // OpenAI tool messages have no error flag — fold failures into the text.
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.isError ? `ERROR: ${message.content}` : message.content,
      });
    } else if ('toolCalls' in message && message.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: message.text.length > 0 ? message.text : null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      });
    } else {
      out.push({ role: 'assistant', content: 'text' in message ? message.text : message.content });
    }
  }
  return out;
}
