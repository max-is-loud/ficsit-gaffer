// The work-order state machine: which actions are legal from which states and for which actor, and
// the audit event each transition records. It holds no persistence.

import type { TerminalWorkOrderState, WorkOrderActor, WorkOrderState } from '../types.js';

/**
 * The work-order state machine, per docs/work-orders.md. Transitions are
 * validated against BOTH the current state and the requesting actor. Actor is a
 * correctness guardrail asserted by call site (Foreman = tool call, Pioneer =
 * REST/UI) — it is not authenticated.
 */

export type WorkOrderAction =
  | 'Start'
  | 'Pause'
  | 'Resume'
  | 'Block'
  | 'Unblock'
  | 'Complete'
  | 'ForceComplete'
  | 'Cancel'
  | 'Supersede';

interface TransitionRule {
  allowedActors: readonly WorkOrderActor[];
  from: readonly WorkOrderState[];
  to: WorkOrderState;
}

export const TERMINAL_STATES: readonly TerminalWorkOrderState[] = [
  'completed',
  'cancelled',
  'superseded',
];

/** True when no transition may leave this state. */
export function isTerminal(state: WorkOrderState): state is TerminalWorkOrderState {
  return (TERMINAL_STATES as readonly WorkOrderState[]).includes(state);
}

export const TRANSITIONS: Record<WorkOrderAction, TransitionRule> = {
  Start: { allowedActors: ['Pioneer'], from: ['new'], to: 'active' },
  Pause: { allowedActors: ['Pioneer', 'Foreman'], from: ['active'], to: 'paused' },
  Resume: { allowedActors: ['Pioneer', 'Foreman'], from: ['paused'], to: 'active' },
  Block: { allowedActors: ['Foreman'], from: ['active', 'paused'], to: 'blocked' },
  Unblock: { allowedActors: ['Foreman'], from: ['blocked'], to: 'active' },
  // Completion is Pioneer-only (Option A). The Foreman may only propose it.
  Complete: { allowedActors: ['Pioneer'], from: ['active'], to: 'completed' },
  ForceComplete: {
    allowedActors: ['Pioneer'],
    from: ['active', 'paused', 'blocked'],
    to: 'completed',
  },
  Cancel: {
    allowedActors: ['Pioneer', 'Foreman'],
    from: ['new', 'active', 'paused', 'blocked'],
    to: 'cancelled',
  },
  Supersede: {
    allowedActors: ['Foreman', 'System'],
    from: ['new', 'active', 'paused', 'blocked'],
    to: 'superseded',
  },
};

export interface TransitionFailure {
  ok: false;
  /** 'terminal' (locked), 'state' (wrong from-state), or 'actor' (not allowed). */
  reason: 'terminal' | 'state' | 'actor';
  message: string;
}
export interface TransitionSuccess {
  ok: true;
  to: WorkOrderState;
}
export type TransitionResult = TransitionFailure | TransitionSuccess;

/**
 * Validates an action against the current state and the requesting actor.
 * Returns the resulting state on success, or a typed failure the caller maps to
 * an HTTP status / tool error.
 */
export function validateTransition(
  current: WorkOrderState,
  action: WorkOrderAction,
  actor: WorkOrderActor,
): TransitionResult {
  const rule = TRANSITIONS[action];
  if (isTerminal(current)) {
    return {
      ok: false,
      reason: 'terminal',
      message: `Work order is ${current} (terminal) and cannot be transitioned.`,
    };
  }
  if (!rule.from.includes(current)) {
    return {
      ok: false,
      reason: 'state',
      message: `${action} is not allowed from state '${current}'.`,
    };
  }
  if (!rule.allowedActors.includes(actor)) {
    return {
      ok: false,
      reason: 'actor',
      message: `${actor} may not perform ${action}.`,
    };
  }
  return { ok: true, to: rule.to };
}

/** The audit event type a successful transition records. */
export function transitionEventType(action: WorkOrderAction): string {
  switch (action) {
    case 'Start':
      return 'started';
    case 'Pause':
      return 'paused';
    case 'Resume':
      return 'resumed';
    case 'Block':
      return 'blocked';
    case 'Unblock':
      return 'unblocked';
    case 'Complete':
      return 'completed';
    case 'ForceComplete':
      return 'force_completed';
    case 'Cancel':
      return 'cancelled';
    case 'Supersede':
      return 'superseded';
    default:
      return 'state_transitioned';
  }
}
