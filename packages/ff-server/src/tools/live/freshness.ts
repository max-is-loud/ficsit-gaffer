// Shared wording for live results: what each receiver status means for the
// foreman's answer, how failures are reported, and time/unit helpers. Kept
// apart so every live tool words freshness the same way.

import type { BridgeQueryError, StateReason } from '../../bridge/types.js';
import type { ToolInvocationResult } from '../../mcp/client.js';

export const iso = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString();
export const metres = (cm: number): number => Math.round(cm) / 100;

export function liveError(text: string): ToolInvocationResult {
  return { text, isError: true };
}

const STATUS_GUIDANCE: Record<StateReason, string> = {
  recent_sync:
    'Recently synchronised: the receiver accepted game updates less than 15 s before evaluatedAt. This is what the receiver knows, not a guarantee the game has not changed since.',
  stale:
    'LAST-KNOWN state: no successful synchronisation for 15 s or more. Say so and give lastSyncAt.',
  resynchronizing:
    'LAST-KNOWN state: the game is resending a full snapshot; this is the previous committed state. Say so and give lastSyncAt.',
  receiver_restarted:
    'LAST-KNOWN state: the receiver restarted and has not yet re-synchronised with the game. Say so and give lastSyncAt.',
  no_baseline:
    'UNAVAILABLE: no complete baseline has been received from the game yet. Counts are unknown, not zero.',
};

export function statusGuidance(reason: StateReason): string {
  return STATUS_GUIDANCE[reason];
}

const FAILURES: Record<BridgeQueryError['code'], string> = {
  state_changed:
    'The live state changed between pages. Restart from the first page (omit cursor); never combine pages from different states.',
  invalid_query:
    'The receiver rejected that query (usually a cursor it did not issue). Restart the listing without a cursor.',
  unavailable:
    'Live factory observations are unavailable right now (the receiver could not be reached or did not answer correctly). Do not state current counts from live data. Other tools and ordinary chat are unaffected; the pioneer can ask again later.',
  invalid_response:
    'Live factory observations are unavailable right now (the receiver could not be reached or did not answer correctly). Do not state current counts from live data. Other tools and ordinary chat are unaffected; the pioneer can ask again later.',
};

export function failure(code: BridgeQueryError['code']): ToolInvocationResult {
  return liveError(FAILURES[code]);
}
