import { describe, expect, it } from 'vitest';

import { resolveBridgeBinding } from '../src/bridge/config.js';

const TOKEN = 'q'.repeat(48);
const VALID = {
  FOREMAN_BRIDGE_URL: 'https://receiver.example:9443',
  FOREMAN_BRIDGE_QUERY_TOKEN: TOKEN,
  FOREMAN_BRIDGE_SERVER_ID: '00000001-0000-4000-8000-000000000001',
  FOREMAN_BRIDGE_WORLD_ID: '00000002-0000-4000-8000-000000000001',
  FOREMAN_BRIDGE_PLAYTHROUGH_ID: 'playthrough_1',
};

function failure(env: NodeJS.ProcessEnv): string {
  try {
    resolveBridgeBinding(env);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected configuration to be rejected');
}

describe('resolveBridgeBinding', () => {
  it('is disabled when every variable is absent or blank', () => {
    expect(resolveBridgeBinding({})).toBeUndefined();
    expect(
      resolveBridgeBinding({ FOREMAN_BRIDGE_URL: '  ', FOREMAN_BRIDGE_QUERY_TOKEN: '' }),
    ).toBeUndefined();
  });

  it('resolves a complete binding with a normalised root URL', () => {
    expect(resolveBridgeBinding(VALID)).toEqual({
      url: 'https://receiver.example:9443/',
      queryToken: TOKEN,
      serverId: VALID.FOREMAN_BRIDGE_SERVER_ID,
      worldId: VALID.FOREMAN_BRIDGE_WORLD_ID,
      playthroughId: 'playthrough_1',
    });
    expect(
      resolveBridgeBinding({ ...VALID, FOREMAN_BRIDGE_URL: 'https://10.0.0.5:9443/' })?.url,
    ).toBe('https://10.0.0.5:9443/');
  });

  it('names missing variables when partially configured', () => {
    const { FOREMAN_BRIDGE_WORLD_ID: _omit, ...partial } = VALID;
    const message = failure(partial);
    expect(message).toMatch(/incomplete/i);
    expect(message).toContain('FOREMAN_BRIDGE_WORLD_ID');
    expect(message).not.toContain(TOKEN);
  });

  it.each([
    ['http scheme', { FOREMAN_BRIDGE_URL: 'http://receiver.example:9443' }],
    ['userinfo', { FOREMAN_BRIDGE_URL: 'https://user:pw@receiver.example:9443' }],
    ['non-root path', { FOREMAN_BRIDGE_URL: 'https://receiver.example:9443/api' }],
    ['query', { FOREMAN_BRIDGE_URL: 'https://receiver.example:9443/?x=1' }],
    ['empty query', { FOREMAN_BRIDGE_URL: 'https://receiver.example:9443/?' }],
    ['fragment', { FOREMAN_BRIDGE_URL: 'https://receiver.example:9443/#frag' }],
    ['unparseable URL', { FOREMAN_BRIDGE_URL: 'not a url' }],
    ['short token', { FOREMAN_BRIDGE_QUERY_TOKEN: 'short' }],
    ['token charset', { FOREMAN_BRIDGE_QUERY_TOKEN: `${'a'.repeat(40)} $` }],
    ['uppercase server id', { FOREMAN_BRIDGE_SERVER_ID: '00000001-0000-4000-8000-00000000000A' }],
    ['malformed world id', { FOREMAN_BRIDGE_WORLD_ID: 'world-1' }],
    ['unsafe playthrough id', { FOREMAN_BRIDGE_PLAYTHROUGH_ID: '../other' }],
  ])('rejects %s without echoing secrets', (_label, change) => {
    const env = { ...VALID, ...change };
    const message = failure(env);
    expect(message).toMatch(/FOREMAN_BRIDGE_/);
    for (const value of Object.values(env)) {
      if (value.length >= 8) {
        expect(message).not.toContain(value);
      }
    }
  });
});
