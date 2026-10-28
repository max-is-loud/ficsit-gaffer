import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { createProvider } from '../src/llm/factory.js';
import type { McpGateway } from '../src/mcp/client.js';
import { runScenario } from '../src/scripts/measureChatTurn.js';
import type { TurnTrace } from '../src/scripts/measureTrace.js';
import { createScratchDb, type ScratchDb } from '../src/scripts/scratchDb.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { SaveService } from '../src/services/saveService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { FakeLlmProvider } from './chatFakes.js';

vi.mock('../src/llm/factory.js', () => ({ createProvider: vi.fn() }));

// `prisma db push` is a blocking subprocess. Running it in a test body counts against the 5 s
// test timeout, and it slows down when many test files push at once. A hook has a longer
// timeout, so create the scratch database once here. Every `runScenario` call makes its own
// user, playthrough and save, so the cases do not see each other's rows.
let scratch: ScratchDb;

beforeAll(async () => {
  scratch = await createScratchDb();
});

afterAll(async () => {
  await scratch.cleanup();
});

it.each([true, false])(
  'validates scenario context before calling the model (valid=%s)',
  async (valid) => {
    const savePath = path.join(scratch.saveDataDir, 'input.sav');
    fs.writeFileSync(savePath, 'fixture: parsed by the fake MCP');
    const summary = {
      save: { saveName: 'Measurement fixture', version: 'test' },
      player: {},
      progress: { highestTier: 1, tierMilestones: [], mamTrees: [] },
      recipes: { standardCount: 5, alternateCount: 0, alternates: [], alternatesOmitted: 0 },
      power: {
        capacityMw: 75,
        consumptionMw: 25,
        headroomMw: 50,
        circuits: 1,
        overloadedCircuits: 0,
        generators: [],
      },
      production: [],
      storage: [],
      nearbyResources: [],
    };
    const mcp: McpGateway = {
      gameVersion: 'test',
      listTools: async () => [],
      callTool: async (name) => ({
        text: JSON.stringify(name === 'get_save_summary' && valid ? { summary } : {}),
        isError: false,
      }),
    };
    const provider = new FakeLlmProvider([
      { text: 'Iron answer', toolCalls: [], stopReason: 'stop' },
      {
        text: '',
        toolCalls: [{ id: 'call-1', name: 'get_production', arguments: { item: 'Copper Ingot' } }],
        stopReason: 'tool_use',
      },
      { text: 'Copper answer', toolCalls: [], stopReason: 'stop' },
    ]);
    const traces: TurnTrace[] = [];
    vi.mocked(createProvider).mockReturnValue(provider);
    const workOrders = new WorkOrderService(scratch.prisma);
    const pending = runScenario(
      {
        onTrace: (trace) => traces.push(trace),
        prisma: scratch.prisma,
        saves: new SaveService(scratch.prisma, mcp, scratch.saveDataDir, workOrders),
        deps: {
          mcp,
          workOrders,
          playthroughs: new PlaythroughService(scratch.prisma),
          systemPromptTemplate: 'Foreman',
          historyWindow: 20,
        },
        options: {
          savePath,
          scenarios: [],
          runs: 1,
          traceResultChars: 1,
          llm: {
            providerKind: 'anthropic',
            model: 'test',
            summaryModel: 'test',
            maxTokens: 16000,
            summaryMaxTokens: 1000,
            apiKey: 'unused',
          },
        },
      },
      { id: 'follow-up', turns: ['Iron?', 'Copper?'], measuredTurn: 1 },
      1,
    );
    if (!valid) {
      await expect(pending).rejects.toThrow('Measurement requires a save snapshot');
      expect(provider.requests).toHaveLength(0);
      expect(traces).toHaveLength(0);
      return;
    }
    const measured = await pending;
    expect(measured.contextChars).toBeGreaterThan(0);
    expect(measured.contextChars).toBe(provider.requests[1]?.contextBlocks?.[0]?.length);
    expect(provider.requests).toHaveLength(3);
    for (const request of provider.requests) {
      expect(request.contextBlocks).toEqual([expect.stringContaining('Measurement fixture')]);
    }
    expect(provider.requests[1]?.contextBlocks).toEqual(provider.requests[0]?.contextBlocks);
    expect(
      traces.map(({ turn, measured, question, answer }) => [turn, measured, question, answer]),
    ).toEqual([
      [0, false, 'Iron?', 'Iron answer'],
      [1, true, 'Copper?', 'Copper answer'],
    ]);
    expect(traces[0]?.toolCalls).toEqual([]);
    expect(traces[1]?.toolCalls).toEqual([
      expect.objectContaining({
        round: 1,
        name: 'get_production',
        arguments: { item: 'Copper Ingot' },
        resultTruncated: true,
      }),
    ]);
    expect(traces[1]?.toolCalls[0]?.result).toBe('{');
    expect(traces[1]?.contextBlocks).toEqual(provider.requests[2]?.contextBlocks);
    expect(traces[1]?.workOrders).toEqual([]);
  },
);
