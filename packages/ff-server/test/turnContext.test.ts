import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SaveSummaryCache } from '../src/context/saveSummaryCache.js';
import { buildTurnContext, warmSaveSummary } from '../src/context/turnContext.js';
import type { McpGateway, ToolInvocationResult } from '../src/mcp/client.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { SaveService } from '../src/services/saveService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { createTestDb, createTestForeman, createTestUser, type TestDb } from './helpers.js';

let db: TestDb;
let saveDir: string;

beforeAll(async () => {
  db = await createTestDb();
  saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-turn-context-'));
});

afterAll(async () => {
  await db.cleanup();
  fs.rmSync(saveDir, { recursive: true, force: true });
});

/** Names each save by its file contents, so a re-upload's summary is recognisably different. */
function saveAwareMcp(): McpGateway & { summaryCalls: number } {
  const gateway = {
    gameVersion: 'test',
    summaryCalls: 0,
    listTools: async () => [],
    callTool: async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<ToolInvocationResult> => {
      if (name !== 'get_save_summary') {
        return { text: 'unavailable', isError: true };
      }
      gateway.summaryCalls += 1;
      const saveName = fs.readFileSync(String(args['savePath']), 'utf8');
      const summary = {
        save: { saveName, version: 'build 1 (save 2)' },
        player: {},
        progress: { highestTier: 0, tierMilestones: [], mamTrees: [] },
        recipes: { standardCount: 0, alternateCount: 0, alternates: [], alternatesOmitted: 0 },
        power: {
          capacityMw: 0,
          consumptionMw: 0,
          headroomMw: 0,
          circuits: 0,
          overloadedCircuits: 0,
          generators: [],
        },
        production: [],
        storage: [],
        nearbyResources: [],
      };
      return { text: JSON.stringify({ summary }), isError: false };
    },
  };
  return gateway;
}

async function setUp(): Promise<{
  deps: { saves: SaveService; saveSummaries: SaveSummaryCache };
  mcp: ReturnType<typeof saveAwareMcp>;
  playthroughId: string;
}> {
  const mcp = saveAwareMcp();
  const saves = new SaveService(db.prisma, mcp, saveDir, new WorkOrderService(db.prisma));
  const userId = await createTestUser(db.prisma);
  const foremanId = await createTestForeman(db.prisma, userId);
  const playthrough = await new PlaythroughService(db.prisma).create({ userId, foremanId });
  return {
    deps: { saves, saveSummaries: new SaveSummaryCache(mcp) },
    mcp,
    playthroughId: playthrough.id,
  };
}

describe('buildTurnContext', () => {
  it('gives no blocks and no save path before a save is uploaded', async () => {
    const { deps, playthroughId } = await setUp();
    expect(await buildTurnContext(deps, playthroughId)).toEqual({ contextBlocks: [] });
  });

  it('summarises the current save, and the new one after a re-upload', async () => {
    const { deps, mcp, playthroughId } = await setUp();
    await deps.saves.addVersion(playthroughId, { fileName: 'a.sav', bytes: Buffer.from('First') });
    const first = await buildTurnContext(deps, playthroughId);
    expect(first.savePath).toBe(await deps.saves.getSavePath(playthroughId));
    expect(first.contextBlocks).toEqual([expect.stringContaining('Save "First"')]);
    await buildTurnContext(deps, playthroughId);
    expect(mcp.summaryCalls).toBe(1);

    await deps.saves.addVersion(playthroughId, { fileName: 'b.sav', bytes: Buffer.from('Second') });
    const second = await buildTurnContext(deps, playthroughId);
    expect(second.contextBlocks).toEqual([expect.stringContaining('Save "Second"')]);
    expect(mcp.summaryCalls).toBe(2);
  });

  it('omits the block, keeping the save path, when no summary cache is configured', async () => {
    const { deps, playthroughId } = await setUp();
    await deps.saves.addVersion(playthroughId, { fileName: 'a.sav', bytes: Buffer.from('First') });
    const context = await buildTurnContext({ saves: deps.saves }, playthroughId);
    expect(context.contextBlocks).toEqual([]);
    expect(context.savePath).toBeDefined();
  });
});

describe('warmSaveSummary', () => {
  it('builds the current save summary ahead of the next turn', async () => {
    const { deps, mcp, playthroughId } = await setUp();
    await deps.saves.addVersion(playthroughId, { fileName: 'a.sav', bytes: Buffer.from('First') });
    await warmSaveSummary(deps, playthroughId);
    expect(mcp.summaryCalls).toBe(1);
    await buildTurnContext(deps, playthroughId);
    expect(mcp.summaryCalls).toBe(1);
  });
});
