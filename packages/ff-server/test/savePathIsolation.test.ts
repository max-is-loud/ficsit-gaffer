import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runChat } from '../src/llm/chat.js';
import type { NeutralToolCall } from '../src/llm/types.js';
import type {
  McpGateway,
  ToolCallContext,
  ToolDefinition,
  ToolInvocationResult,
} from '../src/mcp/client.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { FakeLlmProvider } from './chatFakes.js';
import { createTestDb, createTestForeman, createTestUser, type TestDb } from './helpers.js';

// Regression for #52: a model-supplied savePath must never reach a save tool. With no save
// attached, the call reads sf-mcp's default store; with a save attached, it reads that save.

const OTHER_SAVE = '/data/saves/other-playthrough/other-save.sav';
const OWN_SAVE = '/data/saves/own-playthrough/own-save.sav';

let db: TestDb;
let userId: string;

beforeAll(async () => {
  db = await createTestDb();
  userId = await createTestUser(db.prisma);
});

afterAll(async () => {
  await db.cleanup();
});

type RecordedCall = { args: Record<string, unknown>; context?: ToolCallContext };

/**
 * Lists get_player_state with a savePath property and answers with the data of the save it
 * would read: the host's context path wins over an args path, as in McpHttpClient.callTool.
 */
function saveMcp(): McpGateway & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const playerState: ToolDefinition = {
    name: 'get_player_state',
    description: 'player',
    inputSchema: { type: 'object', properties: { savePath: { type: 'string' } } },
  };
  return {
    gameVersion: '1.2.3.0',
    calls,
    listTools: async () => [playerState],
    callTool: async (_name, args, context): Promise<ToolInvocationResult> => {
      calls.push({ args, context });
      const argPath = typeof args['savePath'] === 'string' ? args['savePath'] : undefined;
      const effectivePath = context?.savePath ?? argPath;
      return { text: `data of ${effectivePath ?? 'default save'}`, isError: false };
    },
  };
}

/** Runs one turn whose first round makes `call`; `savePath` is the playthrough's attached save. */
async function runTurn(
  call: NeutralToolCall,
  savePath: string | undefined,
): Promise<{ provider: FakeLlmProvider; mcp: ReturnType<typeof saveMcp> }> {
  const playthroughs = new PlaythroughService(db.prisma);
  const foremanId = await createTestForeman(db.prisma, userId);
  const playthrough = await playthroughs.create({ userId, foremanId });
  await playthroughs.appendMessage(playthrough.id, 'user', 'Where am I?');
  const mcp = saveMcp();
  const provider = new FakeLlmProvider([
    { text: '', toolCalls: [call], stopReason: 'tool_use' },
    { text: 'Done.', toolCalls: [], stopReason: 'stop' },
  ]);
  await runChat(
    {
      playthroughId: playthrough.id,
      promptContext: { personality: '', pioneerProfile: '' },
      savePath,
      provider,
      model: 'm',
      maxTokens: 1024,
    },
    {
      systemPromptTemplate: 'Prompt',
      historyWindow: 20,
      playthroughs,
      workOrders: new WorkOrderService(db.prisma),
      mcp,
    },
    { text: () => {}, toolUse: () => {}, workOrder: () => {} },
  );
  return { provider, mcp };
}

/** The content of the tool result the model received in the second round. */
function toolResultText(provider: FakeLlmProvider): string | undefined {
  const toolMessage = provider.requests[1]?.messages.find((message) => message.role === 'tool');
  return toolMessage?.role === 'tool' ? toolMessage.content : undefined;
}

const readOtherSave: NeutralToolCall = {
  id: 't1',
  name: 'get_player_state',
  arguments: { savePath: OTHER_SAVE },
};

describe('save-path isolation (#52)', () => {
  it('does not return another playthrough save when no save is attached', async () => {
    const { provider, mcp } = await runTurn(readOtherSave, undefined);
    expect(toolResultText(provider)).not.toContain(OTHER_SAVE);
    expect(toolResultText(provider)).toBe('data of default save');
    expect(mcp.calls[0]?.args).not.toHaveProperty('savePath');
  });

  it('reads the attached save, not the model path, when a save is attached', async () => {
    const { provider, mcp } = await runTurn(readOtherSave, OWN_SAVE);
    expect(mcp.calls[0]?.args).not.toHaveProperty('savePath');
    expect(toolResultText(provider)).toBe(`data of ${OWN_SAVE}`);
  });

  it('offers get_player_state to the model without a savePath property', async () => {
    const { provider } = await runTurn(readOtherSave, undefined);
    const offered = provider.requests[0]?.tools.find((tool) => tool.name === 'get_player_state');
    expect(offered?.inputSchema).not.toHaveProperty('properties.savePath');
  });
});
