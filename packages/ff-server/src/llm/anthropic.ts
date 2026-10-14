import Anthropic from '@anthropic-ai/sdk';

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

/** Native Anthropic adapter — the foreman's first-class path for Claude models. */
export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;

  public constructor(apiKey: string, baseUrl?: string) {
    this.client = new Anthropic(baseUrl !== undefined ? { apiKey, baseURL: baseUrl } : { apiKey });
  }

  public async runTurn(
    req: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
  ): Promise<LlmTurnResult> {
    const stream = this.client.messages.stream({
      model: req.model,
      max_tokens: req.maxTokens,
      // Cache the stable prefix (render order: tools → system → messages) so it
      // is reused across requests and across tool rounds within a turn. Two
      // breakpoints — one on the tool list, one on system — mean a system-prompt
      // change still reuses the tools cache.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: toAnthropicMessages(req.messages),
      tools: cacheableTools(req.tools),
    });

    let text = '';
    stream.on('text', (delta: string) => {
      text += delta;
      onEvent({ type: 'text', delta });
    });

    const final = await stream.finalMessage();
    logger.info(
      `Anthropic usage: ${final.usage.input_tokens} input, ` +
        `${final.usage.cache_creation_input_tokens ?? 0} cache-write, ` +
        `${final.usage.cache_read_input_tokens ?? 0} cache-read.`,
    );
    const toolCalls: NeutralToolCall[] = [];
    for (const block of final.content) {
      if (block.type === 'tool_use') {
        const call: NeutralToolCall = {
          id: block.id,
          name: block.name,
          arguments: (block.input ?? {}) as Record<string, unknown>,
        };
        toolCalls.push(call);
        onEvent({ type: 'tool_call', call });
      }
    }

    return {
      text,
      toolCalls,
      stopReason: final.stop_reason === 'tool_use' ? 'tool_use' : 'stop',
      continuation: { provider: 'anthropic', content: final.content },
    };
  }

  public async complete(req: LlmCompletionRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.userText }],
    });
    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
  }
}

/**
 * Maps the neutral tool definitions to Anthropic tools, placing a cache
 * breakpoint on the last one so the whole tool list is cached as part of the
 * stable prefix. The tool set is deterministic, so the cache holds across turns.
 */
function cacheableTools(tools: LlmRequest['tools']): Anthropic.Tool[] {
  const mapped: Anthropic.Tool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));
  const last = mapped[mapped.length - 1];
  if (last !== undefined) {
    last.cache_control = { type: 'ephemeral' };
  }
  return mapped;
}

/**
 * Translates neutral history to Anthropic message params. Native assistant
 * content is replayed unchanged, including thinking signatures and block order.
 * Turns without native content fall back to text + tool_use blocks.
 * Consecutive tool results are folded into one user
 * message of tool_result blocks (Anthropic requires them grouped that way).
 */
function toAnthropicMessages(messages: NeutralMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let pendingResults: Anthropic.ToolResultBlockParam[] = [];

  const flushResults = (): void => {
    if (pendingResults.length > 0) {
      out.push({ role: 'user', content: pendingResults });
      pendingResults = [];
    }
  };

  for (const message of messages) {
    if (message.role === 'tool') {
      pendingResults.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
        is_error: message.isError,
      });
      continue;
    }
    flushResults();
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content });
    } else if ('toolCalls' in message) {
      if (message.continuation?.provider === 'anthropic') {
        out.push({ role: 'assistant', content: message.continuation.content });
        continue;
      }
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (message.text.length > 0) {
        blocks.push({ type: 'text', text: message.text });
      }
      for (const call of message.toolCalls) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      out.push({ role: 'assistant', content: blocks });
    } else {
      out.push({ role: 'assistant', content: message.content });
    }
  }
  flushResults();
  return out;
}
