// Body of the Work History drawer: the playthrough's work orders as a git-style
// graph list, using the layout from historyGraph. Selecting a row asks the parent
// to view that order read-only.

import type { WorkOrder } from '../api/types.js';
import { buildHistoryGraph, type GraphCell } from './historyGraph.js';
import { STATE_LABEL, woLabel } from './workOrderLabels.js';

interface WorkHistoryDrawerBodyProps {
  history: WorkOrder[];
  /** The live active order's id (selected when not viewing a past order). */
  currentId: string | null;
  /** The order being viewed from history, or null when on the active order. */
  viewingId: string | null;
  /** Open an order; the active order's id returns to the live view. */
  onSelect: (id: string) => void;
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' });

function completionDate(order: WorkOrder): string {
  if (order.completedAt === undefined) {
    return '';
  }
  const when = new Date(order.completedAt);
  return Number.isNaN(when.getTime()) ? '' : DATE_FMT.format(when);
}

/** The gutter cell: directional line segments + an optional state-coloured node. */
function LaneCell({ cell, state }: { cell: GraphCell; state: string }): React.JSX.Element {
  return (
    <span className="lane">
      {cell.up ? <span className="ln ln-up" /> : null}
      {cell.down ? <span className="ln ln-down" /> : null}
      {cell.left ? <span className="ln ln-left" /> : null}
      {cell.right ? <span className="ln ln-right" /> : null}
      {cell.node ? <span className={`node state-${state}`} /> : null}
    </span>
  );
}

/**
 * The Work History drawer's content: every order in the playthrough as a single
 * creation-ordered trunk (newest top, oldest bottom) with a git-style branch
 * gutter — children fork into their own lane and elbow back to their parent.
 * Selecting a row opens it read-only in the cockpit; the active order returns to
 * the live view. The dock owns the surrounding chrome (rail, pin, collapse).
 */
export function WorkHistoryDrawerBody({
  history,
  currentId,
  viewingId,
  onSelect,
}: WorkHistoryDrawerBodyProps): React.JSX.Element {
  const { rows, laneCount } = buildHistoryGraph(history);
  const selectedId = viewingId ?? currentId;

  if (rows.length === 0) {
    return <p className="empty">No work orders yet.</p>;
  }

  return (
    <div className="history">
      {rows.map(({ order, cells, relationshipLabel }) => {
        const selected = order.id === selectedId;
        return (
          <button
            type="button"
            key={order.id}
            className={`history-row${selected ? ' selected' : ''}`}
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect(order.id)}
          >
            <span className="wo-graph" style={{ ['--lanes']: laneCount } as React.CSSProperties}>
              {cells.map((cell, l) => (
                <LaneCell key={l} cell={cell} state={order.state} />
              ))}
            </span>
            <span className="wo-n">{woLabel(order.sequenceNumber)}</span>
            <span className="history-title">
              {order.title}
              {relationshipLabel !== undefined ? (
                <span className="label sub">{relationshipLabel}</span>
              ) : null}
            </span>
            <span className="history-meta">
              <span className={`chip state-${order.state}`}>
                {STATE_LABEL[order.state] ?? order.state}
              </span>
              {completionDate(order) !== '' ? (
                <span className="qty muted">{completionDate(order)}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
