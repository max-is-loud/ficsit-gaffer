import { loadGameData } from '@foreman/sf-game-data';
import { describe, expect, it } from 'vitest';

import { createGameNames } from '../src/bridge/gameNames.js';
import {
  BridgeQueryError,
  type BridgeBinding,
  type BridgeClient,
  type BuildableRow,
  type BuildablesQuery,
  type BuildablesState,
} from '../src/bridge/types.js';
import {
  LIVE_BUILDABLES_TOOL,
  handleLiveStateTool,
  isLiveStateTool,
  liveStateToolDefinitions,
  type LiveStateService,
} from '../src/tools/liveStateTools.js';

const TOKEN = 'live-query-token-should-never-leak-0123456789';
const binding: BridgeBinding = {
  url: 'https://receiver.internal.example:9443/',
  queryToken: TOKEN,
  serverId: '00000001-0000-4000-8000-000000000001',
  worldId: '00000002-0000-4000-8000-000000000001',
  playthroughId: 'linked',
};
const names = createGameNames(loadGameData({}).gameData);
const SMELTER: BuildableRow = {
  entityId: '00000009-0000-4000-8000-00000000000a',
  category: 'manufacturer',
  classPath: '/Game/FactoryGame/Buildable/Factory/SmelterMk1/Build_SmelterMk1.Build_SmelterMk1_C',
  position: [12345, -6789, 100],
  config: {
    recipe: '/Game/FactoryGame/Recipes/Smelter/Recipe_IngotIron.Recipe_IngotIron_C',
    clockSpeed: 1.5,
    productionBoost: 1,
    powerShards: 1,
    somersloops: 0,
    paused: false,
  },
};

function liveState(overrides: Partial<BuildablesState> = {}): BuildablesState {
  return {
    protocol: 2,
    serverId: binding.serverId,
    worldId: binding.worldId,
    revision: '0000000a-0000-4000-8000-000000000001',
    epoch: '00000003-0000-4000-8000-000000000001',
    status: 'fresh',
    reason: 'recent_sync',
    lastSyncAt: Date.UTC(2026, 9, 14, 12, 0, 0),
    evaluatedAt: Date.UTC(2026, 9, 14, 12, 0, 4),
    totalCount: 120,
    rows: [SMELTER],
    coordinateSystem: 'unreal_cm',
    returnedCount: 1,
    hasMore: true,
    nextCursor: 'next_page',
    ...overrides,
  };
}

function service(
  result: BuildablesState | BridgeQueryError | Error = liveState(),
): LiveStateService & { calls: BuildablesQuery[] } {
  const calls: BuildablesQuery[] = [];
  const client: BridgeClient = {
    query: async (query) => {
      calls.push(query);
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  };
  return { binding, client, names, calls };
}

function parse(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

async function run(
  args: Record<string, unknown>,
  live: LiveStateService = service(),
): Promise<{ isError: boolean; text: string }> {
  return handleLiveStateTool(LIVE_BUILDABLES_TOOL, 'linked', args, live);
}

describe('liveStateToolDefinitions', () => {
  it('advertises the tool only to the linked playthrough', () => {
    const live = service();
    const [definition] = liveStateToolDefinitions('linked', live);
    expect(definition?.name).toBe(LIVE_BUILDABLES_TOOL);
    expect(LIVE_BUILDABLES_TOOL).toBe('get_live_buildables');
    expect(isLiveStateTool(LIVE_BUILDABLES_TOOL)).toBe(true);
    expect(isLiveStateTool('get_live_constructor_state')).toBe(false);
    expect(liveStateToolDefinitions('other', live)).toEqual([]);
    expect(liveStateToolDefinitions('linked', undefined)).toEqual([]);
  });

  it('exposes only query arguments, never identities or credentials', () => {
    const [definition] = liveStateToolDefinitions('linked', service());
    const schema = definition?.inputSchema as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.properties).sort()).toEqual([
      'building',
      'category',
      'cursor',
      'groupBy',
      'includeRows',
      'limit',
      'nearestTo',
      'recipe',
    ]);
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(definition)).not.toContain(TOKEN);
    expect(JSON.stringify(definition)).not.toContain(binding.worldId);
  });
});

describe('handleLiveStateTool', () => {
  it('refuses unlinked or disabled playthroughs without calling the receiver', async () => {
    const live = service();
    for (const [playthroughId, configured] of [
      ['other', live],
      ['linked', undefined],
    ] as const) {
      const result = await handleLiveStateTool(LIVE_BUILDABLES_TOOL, playthroughId, {}, configured);
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/not linked/i);
    }
    expect(live.calls).toHaveLength(0);
  });

  it.each([
    [{ url: 'https://evil.example/' }],
    [{ worldId: '00000002-0000-4000-8000-000000000002' }],
    [{ playthroughId: 'linked' }],
    [{ queryToken: 'x'.repeat(40) }],
    [{ limit: 101 }],
    [{ limit: 0 }],
    [{ limit: 2.5 }],
    [{ includeRows: 'yes' }],
    [{ cursor: 'abc' }],
    [{ includeRows: false, cursor: 'abc' }],
    [{ includeRows: true, cursor: 'abc', nearestTo: { x: 0, y: 0, z: 0 } }],
    [{ category: 'decor' }],
    [{ groupBy: 'colour' }],
    [{ nearestTo: { x: 1, y: 2 } }],
    [{ building: '' }],
  ])('rejects forged or invalid arguments %j without calling the receiver', async (args) => {
    const live = service();
    const result = await run(args, live);
    expect(result.isError).toBe(true);
    expect(live.calls).toHaveLength(0);
  });

  it('resolves building and recipe names to class names and metres to centimetres', async () => {
    const live = service();
    await run(
      {
        category: 'manufacturer',
        building: 'Smelter',
        recipe: 'Iron Ingot',
        groupBy: 'recipe',
        nearestTo: { x: 1, y: 2, z: 3 },
        includeRows: true,
        limit: 5,
      },
      live,
    );
    await run({}, live);
    expect(live.calls).toEqual([
      {
        filter: {
          category: 'manufacturer',
          className: 'Build_SmelterMk1_C',
          recipeName: 'Recipe_IngotIron_C',
        },
        groupBy: 'recipe',
        from: [100, 200, 300],
        includeRows: true,
        limit: 5,
      },
      { filter: {} },
    ]);
  });

  it('ambiguous recipe lists candidates without calling the receiver', async () => {
    const live = service();
    const result = await run({ recipe: 'Turbo Rifle Ammo' }, live);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Recipe_CartridgeChaos_Packaged_C');
    expect(live.calls).toHaveLength(0);
  });

  it('suggests close names for an unknown building', async () => {
    const result = await run({ building: 'Smelt' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Smelter');
  });

  it('names buildings, recipes and configuration, with units, status and UTC times', async () => {
    const result = await run({ includeRows: true, limit: 1 });
    expect(result.isError).toBe(false);
    const body = parse(result.text);
    expect(body).toMatchObject({
      source: 'live_bridge_receiver',
      status: 'fresh',
      reason: 'recent_sync',
      lastSyncAt: '2026-10-14T12:00:00.000Z',
      evaluatedAt: '2026-10-14T12:00:04.000Z',
      totalBuildables: 120,
      returnedRows: 1,
      rowsComplete: false,
      nextCursor: 'next_page',
    });
    expect(body.rows).toEqual([
      {
        entityId: SMELTER.entityId,
        building: 'Smelter',
        category: 'manufacturer',
        configuration: {
          recipe: 'Iron Ingot',
          clockSpeedPercent: 150,
          productionBoost: 1,
          powerShards: 1,
          somersloops: 0,
          paused: false,
        },
        positionCm: [12345, -6789, 100],
        positionMetres: [123.45, -67.89, 1],
      },
    ]);
    expect(String(body.guidance)).toMatch(/120/);
    expect(String(body.guidance)).toMatch(/1 of/);
    expect(String(body.guidance)).toMatch(/not.*(running|producing)/i);
  });

  it('formats null recipe as no recipe and unknown fields as unknown', async () => {
    const idle: BuildableRow = {
      ...SMELTER,
      config: { ...SMELTER.config, recipe: null, clockSpeed: null } as BuildableRow['config'],
    };
    const result = await run(
      { includeRows: true, groupBy: 'recipe' },
      service(
        liveState({
          rows: [idle],
          groups: [
            { key: 'Recipe_IngotIron_C', count: 2 },
            { key: null, count: 1 },
          ],
          hasMore: false,
          nextCursor: null,
        }),
      ),
    );
    const body = parse(result.text);
    expect(body.groups).toEqual([
      { name: 'Iron Ingot', count: 2 },
      { name: 'no recipe', count: 1 },
    ]);
    const [row] = body.rows as { configuration: Record<string, unknown> }[];
    expect(row?.configuration).toMatchObject({ recipe: 'no recipe', clockSpeedPercent: 'unknown' });
  });

  it('keeps unresolved rows, marked as not in game data', async () => {
    const modded: BuildableRow = {
      entityId: '00000009-0000-4000-8000-00000000000b',
      category: 'storage',
      classPath: '/Game/Mod/Build_Crate.Build_Crate_C',
      position: [0, 0, 0],
      config: {},
    };
    const result = await run(
      { includeRows: true, groupBy: 'building' },
      service(
        liveState({
          rows: [modded],
          groups: [{ key: 'Build_Crate_C', count: 1 }],
          totalCount: 1,
          hasMore: false,
          nextCursor: null,
        }),
      ),
    );
    const body = parse(result.text);
    expect(body.groups).toEqual([{ name: 'Build_Crate_C (not in game data)', count: 1 }]);
    expect((body.rows as { building: string }[])[0]?.building).toBe(
      'Build_Crate_C (not in game data)',
    );
  });

  it('includes distances in a nearest-first page', async () => {
    const result = await run(
      { includeRows: true, nearestTo: { x: 0, y: 0, z: 0 } },
      service(liveState({ rows: [{ ...SMELTER, distanceMetres: 140.1 }], nextCursor: null })),
    );
    const body = parse(result.text);
    expect((body.rows as { distanceMetres: number }[])[0]?.distanceMetres).toBe(140.1);
    expect(body.nextCursor).toBeNull();
  });

  it('reports totals-only results without implying a row list', async () => {
    const result = await run(
      {},
      service(
        liveState({ rows: [], returnedCount: 0, hasMore: false, nextCursor: null, totalCount: 3 }),
      ),
    );
    const body = parse(result.text);
    expect(body).toMatchObject({ totalBuildables: 3, rowsIncluded: false });
    expect(body.rows).toBeUndefined();
  });

  it('marks last-known and unknown-count states explicitly', async () => {
    const stale = parse(
      (await run({}, service(liveState({ status: 'last_known', reason: 'stale' })))).text,
    );
    expect(String(stale.guidance)).toMatch(/last.known/i);
    const noBaseline = parse(
      (
        await run(
          {},
          service(
            liveState({
              status: 'unavailable',
              reason: 'no_baseline',
              revision: null,
              epoch: null,
              lastSyncAt: null,
              totalCount: null,
              rows: [],
              returnedCount: 0,
              hasMore: false,
              nextCursor: null,
            }),
          ),
        )
      ).text,
    );
    expect(noBaseline.totalBuildables).toBe('unknown');
    expect(String(noBaseline.guidance)).toMatch(/not zero/i);
  });

  it.each([
    ['unavailable', /unavailable/i],
    ['invalid_response', /unavailable/i],
    ['state_changed', /changed.*first page|restart/i],
    ['invalid_query', /restart|without .*cursor/i],
  ] as const)(
    'classifies %s failures without detail, secrets or retries',
    async (code, pattern) => {
      const live = service(new BridgeQueryError(code, 'transport'));
      const result = await run({ includeRows: true }, live);
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(pattern);
      expect(result.text).not.toContain(TOKEN);
      expect(result.text).not.toContain('receiver.internal.example');
      expect(live.calls).toHaveLength(1);
    },
  );

  it('treats unexpected failures as unavailable without leaking their message', async () => {
    const result = await run({}, service(new Error(`boom ${TOKEN}`)));
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/unavailable/i);
    expect(result.text).not.toContain(TOKEN);
  });

  it('never includes the binding credential or receiver address in a result', async () => {
    const result = await run({ includeRows: true });
    expect(result.text).not.toContain(TOKEN);
    expect(result.text).not.toContain('receiver.internal.example');
  });
});
