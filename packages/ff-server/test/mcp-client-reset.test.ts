import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each fake Client is recorded, and each tool call is parked on a deferred keyed
// by tool name, so a test can settle concurrent calls in any order it likes.
interface Deferred {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

const state = vi.hoisted(() => ({
  clients: [] as { closed: boolean }[],
  pending: new Map<string, Deferred>(),
  listError: undefined as unknown,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  class StreamableHTTPClientTransport {
    public async start(): Promise<void> {}
    public async close(): Promise<void> {}
  }
  return { StreamableHTTPClientTransport };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class Client {
    public closed = false;
    public constructor() {
      state.clients.push(this);
    }
    public async connect(transport: { start(): Promise<void> }): Promise<void> {
      await transport.start();
    }
    public async listTools(): Promise<unknown> {
      if (state.listError !== undefined) {
        throw state.listError;
      }
      return { tools: [{ name: 'get_item', description: 'd', inputSchema: { type: 'object' } }] };
    }
    public callTool({ name }: { name: string }): Promise<unknown> {
      if (this.closed) {
        return Promise.reject(new Error('Connection closed'));
      }
      return new Promise((resolve, reject) => {
        state.pending.set(name, { resolve, reject });
      });
    }
    public async close(): Promise<void> {
      this.closed = true;
    }
  }
  return { Client };
});

import { McpHttpClient } from '../src/mcp/client.js';

const OK = { content: [{ type: 'text', text: 'ok' }], isError: false };

/** Waits until the named call is parked, then returns its deferred. */
async function parked(name: string): Promise<Deferred> {
  await vi.waitFor(() => {
    expect(state.pending.has(name)).toBe(true);
  });
  const deferred = state.pending.get(name)!;
  state.pending.delete(name);
  return deferred;
}

beforeEach(() => {
  state.clients = [];
  state.pending = new Map();
  state.listError = undefined;
  vi.stubGlobal(
    'fetch',
    async () => ({ ok: true, json: async () => ({ version: '1.2.3.0' }) }) as unknown as Response,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('McpHttpClient connection reset', () => {
  it('keeps the shared client when one concurrent call times out', async () => {
    const mcp = new McpHttpClient('http://localhost:8723/mcp');
    const slow = mcp.callTool('slow', {});
    const sibling = mcp.callTool('sibling', {});
    (await parked('slow')).reject(new McpError(ErrorCode.RequestTimeout, 'Request timed out'));
    const timedOut = await slow;
    expect(timedOut).toMatchObject({ isError: true });
    expect(timedOut.text).toMatch(/^Tool 'slow' failed: .*Request timed out/);

    (await parked('sibling')).resolve(OK);
    expect(await sibling).toEqual({ text: 'ok', isError: false });
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]?.closed).toBe(false);
  });

  it('keeps the client after a server error response', async () => {
    const mcp = new McpHttpClient('http://localhost:8723/mcp');
    const call = mcp.callTool('bad', {});
    (await parked('bad')).reject(new McpError(ErrorCode.InvalidParams, 'bad args'));
    expect((await call).isError).toBe(true);
    expect(state.clients[0]?.closed).toBe(false);
  });

  it.each([
    ['a transport error', new Error('fetch failed')],
    ['a closed connection', new McpError(ErrorCode.ConnectionClosed, 'Connection closed')],
  ])('resets after %s and reconnects on the next call', async (_label, error) => {
    const mcp = new McpHttpClient('http://localhost:8723/mcp');
    const call = mcp.callTool('broken', {});
    (await parked('broken')).reject(error);
    expect((await call).isError).toBe(true);
    expect(state.clients[0]?.closed).toBe(true);

    const next = mcp.callTool('next', {});
    (await parked('next')).resolve(OK);
    expect((await next).isError).toBe(false);
    expect(state.clients).toHaveLength(2);
  });

  it('does not close a newer client when a stale call fails', async () => {
    const mcp = new McpHttpClient('http://localhost:8723/mcp');
    const stale = mcp.callTool('stale', {});
    const staleCall = await parked('stale');
    const broken = mcp.callTool('broken', {});
    (await parked('broken')).reject(new Error('fetch failed'));
    await broken;

    // A later call reconnects; then the call still pending on the old client fails.
    const fresh = mcp.callTool('fresh', {});
    const freshCall = await parked('fresh');
    staleCall.reject(new Error('socket hang up'));
    expect((await stale).isError).toBe(true);

    freshCall.resolve(OK);
    expect((await fresh).isError).toBe(false);
    expect(state.clients).toHaveLength(2);
    expect(state.clients[1]?.closed).toBe(false);
  });

  it('keeps the client when listing tools gets a protocol error', async () => {
    const mcp = new McpHttpClient('http://localhost:8723/mcp');
    await mcp.connect();
    state.listError = new McpError(ErrorCode.RequestTimeout, 'Request timed out');
    await expect(mcp.listTools()).rejects.toThrow(/Request timed out/);
    expect(state.clients[0]?.closed).toBe(false);

    state.listError = new Error('fetch failed');
    await expect(mcp.listTools()).rejects.toThrow(/fetch failed/);
    expect(state.clients[0]?.closed).toBe(true);
  });
});
