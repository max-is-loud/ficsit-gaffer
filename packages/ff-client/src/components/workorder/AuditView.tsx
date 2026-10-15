// Audit-trail tab of the work-order panel: events newest first, filterable by
// actor and event type, with links to revision snapshots.

import { useMemo, useState } from 'react';

import type {
  WorkOrderActor,
  WorkOrderAuditEvent,
  WorkOrderAuditEventType,
} from '../../api/types.js';
import { fmtDateTime } from './format.js';

interface AuditViewProps {
  events: WorkOrderAuditEvent[];
  /** Jump to a revision's snapshot in the Revisions tab. */
  onOpenRevision?: (revisionNumber: number) => void;
}

/** "buildable_built_count_changed" → "buildable built count changed". */
const eventLabel = (t: WorkOrderAuditEventType): string => t.replace(/_/g, ' ');

/** Compact one-line rendering of an event's open-shaped details payload. */
function detailsLine(details: unknown): string | null {
  if (details === null || details === undefined) {
    return null;
  }
  if (typeof details === 'string') {
    return details;
  }
  try {
    const json = JSON.stringify(details);
    return json === '{}' || json === '[]' ? null : json;
  } catch {
    return null;
  }
}

/**
 * The audit-trail view: the order's full event log, newest first, filterable
 * by actor and event type. Events referencing a revision link through to its
 * snapshot in the Revisions tab.
 */
export function AuditView({ events, onOpenRevision }: AuditViewProps): React.JSX.Element {
  const [actorFilter, setActorFilter] = useState<WorkOrderActor | ''>('');
  const [typeFilter, setTypeFilter] = useState<WorkOrderAuditEventType | ''>('');

  // Only offer the types that actually occur on this order.
  const presentTypes = useMemo(() => [...new Set(events.map((e) => e.eventType))].sort(), [events]);

  const filtered = [...events]
    .filter((e) => actorFilter === '' || e.actor === actorFilter)
    .filter((e) => typeFilter === '' || e.eventType === typeFilter)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <div className="section">
      <span className="label">Audit Trail</span>

      <div className="audit-filters">
        <select
          value={actorFilter}
          aria-label="Filter by actor"
          onChange={(e) => setActorFilter(e.target.value as WorkOrderActor | '')}
        >
          <option value="">All actors</option>
          <option value="Pioneer">Pioneer</option>
          <option value="Foreman">Foreman</option>
          <option value="System">System</option>
        </select>
        <select
          value={typeFilter}
          aria-label="Filter by event type"
          onChange={(e) => setTypeFilter(e.target.value as WorkOrderAuditEventType | '')}
        >
          <option value="">All events</option>
          {presentTypes.map((t) => (
            <option key={t} value={t}>
              {eventLabel(t)}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? <p className="empty">No events match.</p> : null}
      <div className="ledger">
        {filtered.map((e) => {
          const details = detailsLine(e.details);
          return (
            <div className="row tall audit-event" key={e.id}>
              <span className="check-body">
                <span>
                  <span className={`audit-actor actor-${e.actor.toLowerCase()}`}>{e.actor}</span>{' '}
                  {eventLabel(e.eventType)}
                  {e.revisionNumber !== undefined ? (
                    <>
                      {' · '}
                      {onOpenRevision !== undefined ? (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onOpenRevision(e.revisionNumber ?? 0)}
                        >
                          R{e.revisionNumber}
                        </button>
                      ) : (
                        `R${e.revisionNumber}`
                      )}
                      {e.previousRevisionNumber !== undefined
                        ? ` (from R${e.previousRevisionNumber})`
                        : ''}
                    </>
                  ) : null}
                </span>
                {e.note !== undefined ? <span className="check-note">{e.note}</span> : null}
                {details !== null ? <span className="check-note mono">{details}</span> : null}
              </span>
              <span className="qty muted">{fmtDateTime(e.timestamp)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
