// Bounds and parsing for the conversation history window setting, so the account
// settings form and the request code agree on the accepted range.

/** Server default conversation history window (kept in sync with the backend). */
export const DEFAULT_HISTORY_WINDOW = 20;
export const MIN_HISTORY_WINDOW = 2;
export const MAX_HISTORY_WINDOW = 100;

/**
 * Parse the history-window field to the stored number: 0 means "use the server
 * default" (blank/invalid input), otherwise clamp to the server's accepted range.
 */
export function parseHistoryWindow(raw: string): number {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(n) || n <= 0) {
    return 0;
  }
  return Math.min(MAX_HISTORY_WINDOW, Math.max(MIN_HISTORY_WINDOW, n));
}
