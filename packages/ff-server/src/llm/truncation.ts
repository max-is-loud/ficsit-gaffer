// Describes a model turn that was cut off before it finished. One description serves two readers:
// the client (an error notice) and the saved history (a marker the model reads on the next turn).

import type { LlmTurnResult } from './types.js';

/** What was cut off: reply text, or a tool call whose arguments were not complete. */
export type TruncationKind = 'text' | 'tool_call';

/** A cut-off turn, worded for the client and for the saved history. */
export interface TruncatedTurn {
  kind: TruncationKind;
  /** Shown to the pioneer as the turn's error. */
  clientMessage: string;
  /**
   * Appended to the saved assistant text. The next turn reads it as the end of this reply, so it
   * says that the reply is unfinished and what to do about it.
   */
  historyMarker: string;
}

type Describe = (toolNames: string[]) => Omit<TruncatedTurn, 'kind'>;

// A table of kinds, so a new kind of cut-off is one entry and not a new branch.
const DESCRIPTIONS: Record<TruncationKind, Describe> = {
  text: () => ({
    clientMessage:
      'The foreman’s reply was cut off before it finished, usually because it reached the ' +
      'output limit. Ask the foreman to continue, or to answer in smaller parts.',
    historyMarker:
      '[Reply cut off: the model reached its output limit before it finished. The text above ' +
      'is incomplete. Continue from it or answer in smaller parts.]',
  }),
  tool_call: (toolNames) => {
    const names = toolNames.join(', ');
    return {
      clientMessage:
        `The foreman was cut off while it wrote a tool call (${names}), so that call did not ` +
        'run. Ask again, and ask the foreman to work in smaller steps.',
      historyMarker:
        `[Reply cut off: the model reached its output limit while it wrote a call to ${names}. ` +
        'That call did not run and nothing it would change was changed. Split the work into ' +
        'smaller calls on the next turn.]',
    };
  },
};

/**
 * Describes a truncated round. Tool calls from a truncated round are never trusted: their
 * arguments may be cut short, so any call at all makes this a `tool_call` truncation.
 */
export function describeTruncation(round: LlmTurnResult): TruncatedTurn {
  const kind: TruncationKind = round.toolCalls.length > 0 ? 'tool_call' : 'text';
  return { kind, ...DESCRIPTIONS[kind](round.toolCalls.map((call) => call.name)) };
}
