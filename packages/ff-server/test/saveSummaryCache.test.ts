import { describe, expect, it } from 'vitest';

import { buildContextBlocks, saveContributor } from '../src/context/contextBlocks.js';
import { SaveSummaryCache, type CurrentSave } from '../src/context/saveSummaryCache.js';
import type { McpGateway, ToolInvocationResult } from '../src/mcp/client.js';

const UPLOADED = new Date('2026-10-16T04:59:00.000Z');

function summaryFor(saveName: string): object {
  return {
    save: { saveName, version: 'build 1 (save 2)' },
    player: {},
    progress: { highestTier: 1, tierMilestones: ['1-1'], mamTrees: [] },
    recipes: { standardCount: 5, alternateCount: 0, alternates: [], alternatesOmitted: 0 },
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
}

/** Answers get_save_summary per save path; `fail` makes the next call fail once. */
function countingMcp(): McpGateway & { calls: string[]; fail: boolean; delayMs: number } {
  const gateway = {
    gameVersion: 'test',
    calls: [] as string[],
    fail: false,
    delayMs: 0,
    listTools: async () => [],
    callTool: async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<ToolInvocationResult> => {
      const savePath = String(args['savePath']);
      gateway.calls.push(`${name}:${savePath}`);
      await new Promise((resolve) => setTimeout(resolve, gateway.delayMs));
      if (gateway.fail) {
        gateway.fail = false;
        return { text: 'Save unreadable', isError: true };
      }
      const saveName = savePath.split('/').pop() ?? '';
      return { text: JSON.stringify({ summary: summaryFor(saveName) }), isError: false };
    },
  };
  return gateway;
}

const save = (id: string): CurrentSave => ({ id, path: `/saves/${id}`, uploadedAt: UPLOADED });

describe('SaveSummaryCache', () => {
  it('builds once per save and reuses the text', async () => {
    const mcp = countingMcp();
    const cache = new SaveSummaryCache(mcp);
    const first = await cache.get(save('a'));
    const second = await cache.get(save('a'));
    expect(first).toContain('## Save snapshot');
    expect(first).toContain('Save "a"');
    expect(second).toBe(first);
    expect(mcp.calls).toEqual(['get_save_summary:/saves/a']);
  });

  it('shares one build between concurrent requests', async () => {
    const mcp = countingMcp();
    mcp.delayMs = 10;
    const cache = new SaveSummaryCache(mcp);
    await Promise.all([cache.get(save('a')), cache.get(save('a'))]);
    expect(mcp.calls).toHaveLength(1);
  });

  it('builds afresh for a re-uploaded save (a new save id)', async () => {
    const mcp = countingMcp();
    const cache = new SaveSummaryCache(mcp);
    await cache.get(save('a'));
    const next = await cache.get(save('b'));
    expect(next).toContain('Save "b"');
    expect(mcp.calls).toEqual(['get_save_summary:/saves/a', 'get_save_summary:/saves/b']);
  });

  it('does not cache a failure', async () => {
    const mcp = countingMcp();
    mcp.fail = true;
    const cache = new SaveSummaryCache(mcp);
    expect(await cache.get(save('a'))).toBeUndefined();
    expect(await cache.get(save('a'))).toContain('Save "a"');
    expect(mcp.calls).toHaveLength(2);
  });

  it('gives no summary for a payload of the wrong shape', async () => {
    const mcp = countingMcp();
    mcp.callTool = async () => ({ text: JSON.stringify({ summary: { save: 1 } }), isError: false });
    expect(await new SaveSummaryCache(mcp).get(save('a'))).toBeUndefined();
  });

  it('rebuilds after evict', async () => {
    const mcp = countingMcp();
    const cache = new SaveSummaryCache(mcp);
    await cache.get(save('a'));
    cache.evict('a');
    await cache.get(save('a'));
    expect(mcp.calls).toHaveLength(2);
  });

  it('drops the least recently used save beyond its capacity', async () => {
    const mcp = countingMcp();
    const cache = new SaveSummaryCache(mcp, 2);
    await cache.get(save('a'));
    await cache.get(save('b'));
    await cache.get(save('a')); // a is now most recent
    await cache.get(save('c')); // evicts b
    await cache.get(save('a'));
    await cache.get(save('b'));
    expect(mcp.calls.map((call) => call.split('/').pop())).toEqual(['a', 'b', 'c', 'b']);
  });

  it('warm builds in the background', async () => {
    const mcp = countingMcp();
    const cache = new SaveSummaryCache(mcp);
    cache.warm(save('a'));
    await cache.get(save('a'));
    expect(mcp.calls).toHaveLength(1);
  });
});

describe('buildContextBlocks', () => {
  it('returns the save block when there is a current save', async () => {
    const cache = new SaveSummaryCache(countingMcp());
    const blocks = await buildContextBlocks([saveContributor(cache)], {
      playthroughId: 'p',
      currentSave: save('a'),
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('Save "a"');
  });

  it('returns no blocks without a save, in contributor order otherwise', async () => {
    const cache = new SaveSummaryCache(countingMcp());
    expect(await buildContextBlocks([saveContributor(cache)], { playthroughId: 'p' })).toEqual([]);
    const live = { source: 'live' as const, build: async () => 'LIVE' };
    expect(
      await buildContextBlocks([saveContributor(cache), live], {
        playthroughId: 'p',
        currentSave: save('a'),
      }),
    ).toEqual([expect.stringContaining('Save "a"'), 'LIVE']);
  });
});
