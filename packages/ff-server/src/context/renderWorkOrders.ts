// Renders the playthrough's work orders as a context block. Persisted chat history keeps only the
// foreman's text, not its tool calls, so without this block a later turn cannot tell an order it
// issued from one it only described. Byte-stable for the same orders: the block sits in the cached
// prompt prefix and changes only when an order does.

import { formatWorkOrderLabel } from '../services/workOrderService.js';
import type { WorkOrder, WorkOrderState } from '../types.js';

/** Caps keep the block small however long the playthrough runs. */
export const WORK_ORDER_CAPS = { open: 10, closed: 5 } as const;

const CLOSED_STATES = new Set<WorkOrderState>(['completed', 'cancelled', 'superseded']);

function line(order: WorkOrder): string {
  const label = formatWorkOrderLabel(order.sequenceNumber, order.orderType);
  const blocked =
    order.state === 'blocked' && order.blockedReason ? ` (${order.blockedReason})` : '';
  return (
    `- ${label} "${order.title}": ${order.state}${blocked}, revision ${order.currentRevision}, ` +
    `id ${order.id}`
  );
}

/**
 * The open orders to show: every active one, then the newest of the rest, up to the cap, in
 * sequence order. Older paused or blocked orders give way first, so the order the work-order
 * tools treat as current (active, else the newest open) is never dropped.
 */
function shownOpen(open: WorkOrder[]): WorkOrder[] {
  const active = open.filter((order) => order.state === 'active');
  const others = open.filter((order) => order.state !== 'active');
  const room = Math.max(0, WORK_ORDER_CAPS.open - active.length);
  const newest = room === 0 ? [] : others.slice(-room);
  const shown = [...active.slice(0, WORK_ORDER_CAPS.open), ...newest];
  return shown.sort((left, right) => left.sequenceNumber - right.sequenceNumber);
}

/** `- …and 3 older closed orders.`, or nothing. */
function olderLine(count: number): string[] {
  return count > 0 ? [`- …and ${count} older closed order${count === 1 ? '' : 's'}.`] : [];
}

/**
 * The work-orders block: the open orders (see {@link shownOpen}), then the most recent closed
 * ones, each with its label, state, revision and id. Undefined when the playthrough has no orders, so a new
 * playthrough's prompt prefix is unchanged. `orders` is oldest first, as the service lists them.
 */
export function renderWorkOrders(orders: WorkOrder[]): string | undefined {
  if (orders.length === 0) {
    return undefined;
  }
  const open = orders.filter((order) => !CLOSED_STATES.has(order.state));
  const closed = orders.filter((order) => CLOSED_STATES.has(order.state));
  const recentClosed = closed.slice(-WORK_ORDER_CAPS.closed);
  const openShown = shownOpen(open);
  const openMore =
    open.length > openShown.length ? [`- …and ${open.length - openShown.length} more open.`] : [];
  return [
    '## Work orders — current at the start of this turn',
    '',
    'These are what exists; they override anything said about orders earlier in the conversation.',
    'Pass an id as `workOrderId` to the work-order tools.',
    '',
    ...(open.length === 0 ? ['- No open orders.'] : [...openShown.map(line), ...openMore]),
    ...recentClosed.map(line),
    ...olderLine(closed.length - recentClosed.length),
  ].join('\n');
}
