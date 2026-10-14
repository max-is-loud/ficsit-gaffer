import { describe, expect, it } from 'vitest';

import {
  BridgeQueryError,
  type BridgeBinding,
  type BridgeClient,
  type ConstructorQuery,
  type ConstructorState,
} from '../src/bridge/types.js';
import {
  LIVE_CONSTRUCTOR_TOOL,
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

function liveState(overrides: Partial<ConstructorState> = {}): ConstructorState {
  return {
    protocol: 1,
    serverId: binding.serverId,
    worldId: binding.worldId,
    revision: '0000000a-0000-4000-8000-000000000001',
    epoch: '00000003-0000-4000-8000-000000000001',
    status: 'fresh',
    reason: 'recent_sync',
    lastSyncAt: Date.UTC(2026, 9, 14, 12, 0, 0),
    evaluatedAt: Date.UTC(2026, 9, 14, 12, 0, 4),
    totalCount: 120,
    locations: [
      { entityId: '00000009-0000-4000-8000-00000000000a', position: [12345, -6789, 100] },
    ],
    coordinateSystem: 'unreal_cm',
    returnedCount: 1,
    hasMore: true,
    nextCursor: 'next_page',
    ...overrides,
  };
}

function service(
  result: ConstructorState | BridgeQueryError | Error = liveState(),
): LiveStateService & {
  calls: ConstructorQuery[];
} {
  const calls: ConstructorQuery[] = [];
  const client: BridgeClient = {
    query: async (query) => {
      calls.push(query);
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  };
  return { binding, client, calls };
}

function parse(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

describe('liveStateToolDefinitions', () => {
  it('advertises the tool only to the linked playthrough', () => {
    const live = service();
    const [definition] = liveStateToolDefinitions('linked', live);
    expect(definition?.name).toBe(LIVE_CONSTRUCTOR_TOOL);
    expect(LIVE_CONSTRUCTOR_TOOL).toBe('get_live_constructor_state');
    expect(isLiveStateTool(LIVE_CONSTRUCTOR_TOOL)).toBe(true);
    expect(liveStateToolDefinitions('other', live)).toEqual([]);
    expect(liveStateToolDefinitions('linked', undefined)).toEqual([]);
  });

  it('exposes only query arguments, never identities or credentials', () => {
    const [definition] = liveStateToolDefinitions('linked', service());
    const schema = definition?.inputSchema as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.properties).sort()).toEqual(['cursor', 'includeLocations', 'limit']);
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
      const result = await handleLiveStateTool(playthroughId, {}, configured);
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
    [{ includeLocations: 'yes' }],
    [{ cursor: 'abc' }],
    [{ includeLocations: false, cursor: 'abc' }],
  ])('rejects forged or invalid arguments %j without calling the receiver', async (args) => {
    const live = service();
    const result = await handleLiveStateTool('linked', args, live);
    expect(result.isError).toBe(true);
    expect(live.calls).toHaveLength(0);
  });

  it('forwards only validated query fields', async () => {
    const live = service();
    await handleLiveStateTool(
      'linked',
      { includeLocations: true, limit: 100, cursor: 'next_page' },
      live,
    );
    await handleLiveStateTool('linked', {}, live);
    expect(live.calls).toEqual([{ includeLocations: true, limit: 100, cursor: 'next_page' }, {}]);
  });

  it('preserves exact total versus partial locations, units, status and UTC times', async () => {
    const result = await handleLiveStateTool(
      'linked',
      { includeLocations: true, limit: 1 },
      service(),
    );
    expect(result.isError).toBe(false);
    const body = parse(result.text);
    expect(body).toMatchObject({
      source: 'live_bridge_receiver',
      status: 'fresh',
      reason: 'recent_sync',
      lastSyncAt: '2026-10-14T12:00:00.000Z',
      evaluatedAt: '2026-10-14T12:00:04.000Z',
      totalConstructors: 120,
      returnedLocations: 1,
      locationsComplete: false,
      nextCursor: 'next_page',
    });
    expect(body.locations).toEqual([
      {
        entityId: '00000009-0000-4000-8000-00000000000a',
        positionCm: [12345, -6789, 100],
        positionMetres: [123.45, -67.89, 1],
      },
    ]);
    expect(String(body.coordinates)).toMatch(/centimetres/);
    expect(String(body.guidance)).toMatch(/120/);
    expect(String(body.guidance)).toMatch(/1 of/);
  });

  it('reports count-only results without implying a location list', async () => {
    const result = await handleLiveStateTool(
      'linked',
      {},
      service(
        liveState({
          locations: [],
          returnedCount: 0,
          hasMore: false,
          nextCursor: null,
          totalCount: 3,
        }),
      ),
    );
    const body = parse(result.text);
    expect(body).toMatchObject({ totalConstructors: 3, locationsIncluded: false });
    expect(body.locations).toBeUndefined();
  });

  it('marks last-known and unknown-count states explicitly', async () => {
    const stale = parse(
      (
        await handleLiveStateTool(
          'linked',
          {},
          service(liveState({ status: 'last_known', reason: 'stale' })),
        )
      ).text,
    );
    expect(String(stale.guidance)).toMatch(/last.known/i);
    const noBaseline = parse(
      (
        await handleLiveStateTool(
          'linked',
          {},
          service(
            liveState({
              status: 'unavailable',
              reason: 'no_baseline',
              revision: null,
              epoch: null,
              lastSyncAt: null,
              totalCount: null,
              locations: [],
              returnedCount: 0,
              hasMore: false,
              nextCursor: null,
            }),
          ),
        )
      ).text,
    );
    expect(noBaseline.totalConstructors).toBe('unknown');
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
      const result = await handleLiveStateTool('linked', { includeLocations: true }, live);
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(pattern);
      expect(result.text).not.toContain(TOKEN);
      expect(result.text).not.toContain('receiver.internal.example');
      expect(live.calls).toHaveLength(1);
    },
  );

  it('treats unexpected failures as unavailable without leaking their message', async () => {
    const result = await handleLiveStateTool('linked', {}, service(new Error(`boom ${TOKEN}`)));
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/unavailable/i);
    expect(result.text).not.toContain(TOKEN);
  });

  it('never includes the binding credential or receiver address in a result', async () => {
    const result = await handleLiveStateTool('linked', { includeLocations: true }, service());
    expect(result.text).not.toContain(TOKEN);
    expect(result.text).not.toContain('receiver.internal.example');
  });
});
