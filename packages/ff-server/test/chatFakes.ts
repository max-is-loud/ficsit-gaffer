import type { LlmProvider } from '../src/llm/provider.js';
import type { LlmRequest, LlmStreamEvent, LlmTurnResult } from '../src/llm/types.js';
import type { McpGateway, ToolDefinition, ToolInvocationResult } from '../src/mcp/client.js';

// Shared fakes for the chat-loop tests: a scripted provider and a one-tool MCP gateway.

/** A scripted provider: returns queued turns, emitting their text as a delta. */
export class FakeLlmProvider implements LlmProvider {
  public readonly requests: LlmRequest[] = [];
  public constructor(private readonly queue: LlmTurnResult[]) {}
  public async runTurn(
    req: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
  ): Promise<LlmTurnResult> {
    this.requests.push({ ...req, messages: [...req.messages] });
    const result = this.queue.shift();
    if (result === undefined) {
      throw new Error('FakeLlmProvider: no scripted turn left');
    }
    if (result.text.length > 0) {
      onEvent({ type: 'text', delta: result.text });
    }
    return result;
  }
  public async complete(): Promise<string> {
    return '';
  }
}

export function fakeMcp(): McpGateway & {
  calls: { name: string; args: Record<string, unknown> }[];
} {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    gameVersion: '1.2.3.0',
    calls,
    listTools: async (): Promise<ToolDefinition[]> => [
      { name: 'get_recipe', description: 'recipe', inputSchema: { type: 'object' } },
    ],
    callTool: async (name, args): Promise<ToolInvocationResult> => {
      calls.push({ name, args });
      return { text: 'Iron Plate: 1 Iron Ingot → 1 plate.', isError: false };
    },
  };
}
