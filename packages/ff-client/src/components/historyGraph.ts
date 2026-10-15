// Pure layout for the Work History git-style gutter: turns the parent/child tree
// of work orders into per-row lane cells. It does no fetching and no rendering.

import type { WorkOrder } from '../api/types.js';
import { RELATIONSHIP_LABEL } from './workOrderLabels.js';

/**
 * Layout for the Work History "git graph" gutter.
 *
 * The work-order relationship model is a tree (each order has at most one
 * `parentWorkOrderId`), so we can draw a commit-graph-style gutter without any
 * DAG/merge complexity. Orders are listed newest-first (top); because a child is
 * created after its parent, the child sits *above* its parent — exactly the
 * git-log orientation where a branch's tip is at the top and it joins its base
 * lower down.
 *
 * In practice the tree is shallow and sparse, so a node's lane is simply its
 * nesting depth (capped at MAX_LANE). Known v1 limitation: two sibling subtrees
 * that overlap in row-range share a depth-lane and can visually collide — rare
 * given how seldom orders branch; a dynamic lane-packer is a possible follow-up.
 */

const MAX_LANE = 3;

/** What a single lane-cell should draw. Lines run from the cell's edge to its centre. */
export interface GraphCell {
  /** Vertical line, top edge → centre. */
  up: boolean;
  /** Vertical line, centre → bottom edge. */
  down: boolean;
  /** Horizontal line, left edge → centre. */
  left: boolean;
  /** Horizontal line, centre → right edge. */
  right: boolean;
  /** The order's node marker sits in this cell. */
  node: boolean;
}

export interface GraphRow {
  order: WorkOrder;
  /** The lane (column) the node occupies; 0 is the trunk. */
  lane: number;
  /** For a child order, its relationship to its parent (the branch label). */
  relationshipLabel?: string;
  /** One cell per lane, left (0) → right. */
  cells: GraphCell[];
}

export interface HistoryGraph {
  rows: GraphRow[];
  /** Number of lanes (gutter columns). At least 1. */
  laneCount: number;
}

const emptyCell = (): GraphCell => ({
  up: false,
  down: false,
  left: false,
  right: false,
  node: false,
});

/** Depth of an order in the parent chain (0 = root), robust to missing parents / cycles. */
function depthOf(order: WorkOrder, byId: Map<string, WorkOrder>): number {
  let depth = 0;
  const seen = new Set<string>([order.id]);
  let parentId = order.parentWorkOrderId;
  while (parentId !== undefined && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (parent === undefined) {
      break;
    }
    depth += 1;
    seen.add(parentId);
    parentId = parent.parentWorkOrderId;
  }
  return depth;
}

/**
 * Build the gutter layout for the history list. Pure — derived entirely from the
 * in-memory `history`; no fetches, no audit reads.
 */
export function buildHistoryGraph(history: WorkOrder[]): HistoryGraph {
  if (history.length === 0) {
    return { rows: [], laneCount: 1 };
  }

  const byId = new Map(history.map((o) => [o.id, o]));

  // Newest first (top). Tie-break on sequence number so order is deterministic.
  const ordered = [...history].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sequenceNumber - a.sequenceNumber,
  );
  const rowIndexById = new Map(ordered.map((o, i) => [o.id, i]));
  const lanes = ordered.map((o) => Math.min(depthOf(o, byId), MAX_LANE));
  const laneCount = Math.max(...lanes) + 1;

  const rows: GraphRow[] = ordered.map((order, i) => ({
    order,
    lane: lanes[i]!,
    cells: Array.from({ length: laneCount }, emptyCell),
  }));

  // Place each node.
  rows.forEach((row) => {
    row.cells[row.lane]!.node = true;
  });

  // Trunk (lane 0): a continuous vertical through every row between the topmost
  // and bottommost root, so child rows show the trunk passing behind them.
  const rootRows = rows.flatMap((r, i) => (r.lane === 0 ? [i] : []));
  if (rootRows.length > 0) {
    const top = Math.min(...rootRows);
    const bottom = Math.max(...rootRows);
    for (let r = top; r <= bottom; r += 1) {
      if (r > top) {
        rows[r]!.cells[0]!.up = true;
      }
      if (r < bottom) {
        rows[r]!.cells[0]!.down = true;
      }
    }
  }

  // Branch edges: each child connects up to its own node and down to where it
  // joins its parent's lane (an elbow at the parent's row).
  ordered.forEach((child) => {
    const parentId = child.parentWorkOrderId;
    if (parentId === undefined) {
      return;
    }
    const rc = rowIndexById.get(child.id);
    const rp = rowIndexById.get(parentId);
    const parent = byId.get(parentId);
    if (rc === undefined || rp === undefined || parent === undefined) {
      return; // dangling parent — treated as a root, no edge drawn
    }
    const childLane = rows[rc]!.lane;
    const parentLane = rows[rp]!.lane;

    rows[rc]!.relationshipLabel =
      child.relationshipToParent !== undefined
        ? RELATIONSHIP_LABEL[child.relationshipToParent]
        : undefined;

    // Vertical run in the child's lane, from the child node to the parent row.
    const lo = Math.min(rc, rp);
    const hi = Math.max(rc, rp);
    for (let r = lo; r <= hi; r += 1) {
      if (r > lo) {
        rows[r]!.cells[childLane]!.up = true;
      }
      if (r < hi) {
        rows[r]!.cells[childLane]!.down = true;
      }
    }

    // Elbow at the parent row: turn left from the child lane toward the parent
    // lane (childLane > parentLane for a deeper child).
    if (childLane > parentLane) {
      rows[rp]!.cells[childLane]!.left = true;
      for (let l = parentLane; l < childLane; l += 1) {
        rows[rp]!.cells[l]!.right = true;
        if (l > parentLane) {
          rows[rp]!.cells[l]!.left = true;
        }
      }
    }
  });

  return { rows, laneCount };
}
