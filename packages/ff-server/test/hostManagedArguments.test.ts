import { describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../src/mcp/client.js';
import {
  withoutHostManagedArguments,
  withoutHostManagedProperties,
} from '../src/tools/hostManagedArguments.js';

// Host-managed arguments (the save path) belong to the backend: the model never sees them in a
// tool schema and never sets them in a call.

const playerState: ToolDefinition = {
  name: 'get_player_state',
  description: 'd',
  inputSchema: {
    type: 'object',
    properties: { savePath: { type: 'string' }, location: { type: 'object' } },
    required: ['location', 'savePath'],
  },
};

describe('withoutHostManagedProperties', () => {
  it('removes savePath from the properties and the required list', () => {
    const filtered = withoutHostManagedProperties(playerState);
    expect(filtered.inputSchema).toEqual({
      type: 'object',
      properties: { location: { type: 'object' } },
      required: ['location'],
    });
  });

  it('removes an empty required list', () => {
    const onlyPath: ToolDefinition = {
      ...playerState,
      inputSchema: {
        type: 'object',
        properties: { savePath: { type: 'string' } },
        required: ['savePath'],
      },
    };
    expect(withoutHostManagedProperties(onlyPath).inputSchema).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('does not change the original tool and is deterministic', () => {
    const before = structuredClone(playerState);
    const first = withoutHostManagedProperties(playerState);
    expect(playerState).toEqual(before);
    expect(JSON.stringify(withoutHostManagedProperties(playerState))).toBe(JSON.stringify(first));
  });

  it('returns the same object for a tool without host-managed properties', () => {
    const recipe: ToolDefinition = {
      name: 'get_recipe',
      description: 'r',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    };
    expect(withoutHostManagedProperties(recipe)).toBe(recipe);
  });
});

describe('withoutHostManagedArguments', () => {
  it.each(['', 42, null, { path: '/data/saves/a/b.sav' }, '/data/saves/a/b.sav'])(
    'removes a model savePath of value %j',
    (value) => {
      const args = { savePath: value, name: 'Iron Plate' };
      expect(withoutHostManagedArguments(args)).toEqual({ name: 'Iron Plate' });
      expect(args).toHaveProperty('savePath');
    },
  );

  it('keeps the other arguments of a call without a savePath', () => {
    expect(withoutHostManagedArguments({ name: 'Iron Plate' })).toEqual({ name: 'Iron Plate' });
  });
});
