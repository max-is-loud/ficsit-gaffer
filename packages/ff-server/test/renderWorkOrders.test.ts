import { describe, expect, it } from 'vitest';

import { renderWorkOrders, WORK_ORDER_CAPS } from '../src/context/renderWorkOrders.js';
import type { WorkOrder, WorkOrderState } from '../src/types.js';

function order(sequenceNumber: number, state: WorkOrderState, extra: Partial<WorkOrder> = {}) {
  return {
    id: `id-${sequenceNumber}`,
    sequenceNumber,
    orderType: 'build',
    title: `Order ${sequenceNumber}`,
    state,
    currentRevision: 1,
    ...extra,
  } as WorkOrder;
}

describe('renderWorkOrders', () => {
  it('gives no block for a playthrough without orders', () => {
    expect(renderWorkOrders([])).toBeUndefined();
  });

  it('lists each order with its label, state, revision and id', () => {
    const text = renderWorkOrders([
      order(1, 'new', { title: 'Reinforced Plate Works', currentRevision: 2 }),
      order(2, 'blocked', { orderType: 'explore', blockedReason: 'Needs a Mk.2 belt' }),
    ]);
    expect(text).toContain('- WO-001 "Reinforced Plate Works": new, revision 2, id id-1\n');
    expect(text).toMatch(
      /- EO-002 "Order 2": blocked \(Needs a Mk\.2 belt\), revision 1, id id-2$/,
    );
    expect(text?.startsWith('## Work orders — current at the start of this turn\n')).toBe(true);
  });

  it('lists open orders first and only the most recent closed ones', () => {
    const closed = Array.from({ length: WORK_ORDER_CAPS.closed + 2 }, (_, i) =>
      order(i + 1, 'completed'),
    );
    const text = renderWorkOrders([...closed, order(99, 'active')]) ?? '';
    const lines = text.split('\n').filter((line) => line.startsWith('- '));
    expect(lines[0]).toContain('WO-099');
    expect(lines).toHaveLength(1 + WORK_ORDER_CAPS.closed + 1);
    expect(text).not.toContain('WO-001');
    expect(lines.at(-1)).toBe('- …and 2 older closed orders.');
  });

  it('says so when every order is closed', () => {
    expect(renderWorkOrders([order(1, 'cancelled')])).toContain('- No open orders.\n');
  });

  it('keeps the active order and the newest open ones when over the cap', () => {
    const paused = Array.from({ length: WORK_ORDER_CAPS.open + 2 }, (_, i) =>
      order(i + 2, 'paused'),
    );
    const text = renderWorkOrders([order(1, 'active'), ...paused]) ?? '';
    const shown = text.split('\n').filter((entry) => /^- [WE]O-/.test(entry));
    expect(shown).toHaveLength(WORK_ORDER_CAPS.open);
    expect(shown[0]).toContain('WO-001 "Order 1": active');
    expect(text).toContain(`WO-0${WORK_ORDER_CAPS.open + 3}`);
    expect(text).not.toContain('WO-002');
    expect(text).toContain('- …and 3 more open.');
  });

  it('caps the open orders and counts the rest', () => {
    const open = Array.from({ length: WORK_ORDER_CAPS.open + 3 }, (_, i) => order(i + 1, 'new'));
    expect(renderWorkOrders(open)).toContain('- …and 3 more open.');
  });
});
