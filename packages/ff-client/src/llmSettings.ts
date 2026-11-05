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

/**
 * Effort levels the server accepts, lowest first (kept in sync with the backend's
 * `EFFORT_LEVELS`). Whether a given model takes a level is checked by the server, which answers
 * a level the model cannot take with a clear error.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** A known level, or the empty string for "use the server default" (blank or unknown input). */
export function parseEffortSetting(raw: string): string {
  const value = raw.trim().toLowerCase();
  return (EFFORT_LEVELS as readonly string[]).includes(value) ? value : '';
}

/** LLM settings the user can configure (empty = use the server default). */
export interface LlmSettings {
  apiKey: string;
  provider: string;
  model: string;
  baseUrl: string;
  /** One of {@link EFFORT_LEVELS}, or empty for the server default. BYOK-only. */
  effort: string;
  /** Conversation history window (message count); 0 = use the server default. BYOK-only. */
  historyWindow: number;
}

/** Per-request LLM override (effective only when an API key is supplied). */
export interface ClientLlmConfig {
  provider?: 'anthropic' | 'openai';
  model?: string;
  baseUrl?: string;
  /** One of {@link EFFORT_LEVELS}; fixed for the whole turn on the server. */
  effort?: string;
  /** Conversation history window (message count); BYOK-only, server-clamped. */
  historyWindow?: number;
}

/** The request override for the saved settings: a field left at its default is not sent. */
export function toClientLlmConfig(llm: LlmSettings): ClientLlmConfig {
  return {
    provider: llm.provider === 'anthropic' || llm.provider === 'openai' ? llm.provider : undefined,
    model: llm.model || undefined,
    baseUrl: llm.baseUrl || undefined,
    effort: parseEffortSetting(llm.effort) || undefined,
    historyWindow: llm.historyWindow > 0 ? llm.historyWindow : undefined,
  };
}

/** The JSON body of a chat request: the message plus each override that is set. */
export function chatRequestBody(message: string, llm: ClientLlmConfig): Record<string, unknown> {
  const body: Record<string, unknown> = { message };
  for (const field of ['provider', 'model', 'baseUrl', 'effort'] as const) {
    const value = llm[field];
    if (value !== undefined && value.length > 0) {
      body[field] = value;
    }
  }
  if (llm.historyWindow !== undefined && llm.historyWindow > 0) {
    body['historyWindow'] = llm.historyWindow;
  }
  return body;
}
