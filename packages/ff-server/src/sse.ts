// Helper that turns an Express response into a Server-Sent Events channel.

import type { Response } from 'express';

/** A Server-Sent Events channel over an Express response. */
export interface SseChannel {
  /** Emits a named event with a JSON-encoded payload. */
  send(event: string, data: unknown): void;
  /** Ends the stream. */
  close(): void;
}

/**
 * Initialises an Express response for Server-Sent Events and returns a channel
 * for emitting named events. `X-Accel-Buffering: no` disables proxy buffering so
 * tokens reach the client as they stream.
 */
export function openSse(res: Response): SseChannel {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  return {
    send(event: string, data: unknown): void {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    close(): void {
      res.end();
    },
  };
}
