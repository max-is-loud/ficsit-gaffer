import fs from 'node:fs';
import path from 'node:path';

import { expect, it, vi } from 'vitest';

import { createProvider } from '../src/llm/factory.js';
import type { McpGateway } from '../src/mcp/client.js';
import { runScenario } from '../src/scripts/measureChatTurn.js';
import { createScratchDb } from '../src/scripts/scratchDb.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { SaveService } from '../src/services/saveService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { FakeLlmProvider } from './chatFakes.js';

vi.mock('../src/llm/factory.js', () => ({ createProvider: vi.fn() }));

it.each([true, false])(
  'validates scenario context before calling the model (valid=%s)',
  async (valid) => {
    const scratch = await createScratchDb();
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
      { text: 'Copper answer', toolCalls: [], stopReason: 'stop' },
    ]);
    vi.mocked(createProvider).mockReturnValue(provider);
    const workOrders = new WorkOrderService(scratch.prisma);
    try {
      const pending = runScenario(
        {
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
        return;
      }
      const measured = await pending;
      expect(measured.contextChars).toBeGreaterThan(0);
      expect(measured.contextChars).toBe(provider.requests[1]?.contextBlocks?.[0]?.length);
      expect(provider.requests).toHaveLength(2);
      for (const request of provider.requests) {
        expect(request.contextBlocks).toEqual([expect.stringContaining('Measurement fixture')]);
      }
      expect(provider.requests[1]?.contextBlocks).toEqual(provider.requests[0]?.contextBlocks);
    } finally {
      await scratch.cleanup();
    }
  },
);
