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

  for await (const chunk of stream) {
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

  return { text, toolCalls, stopReason: finishReason === 'tool_calls' ? 'tool_use' : 'stop' };
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
      messages: toOpenAiMessages(req.system, req.messages),
      tools: req.tools.map((tool) => ({
        type: 'function' as const,
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      })),
      stream: true,
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

/** Translates neutral history to OpenAI chat messages (system prompt first). */
function toOpenAiMessages(
  system: string,
  messages: NeutralMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
  ];
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
