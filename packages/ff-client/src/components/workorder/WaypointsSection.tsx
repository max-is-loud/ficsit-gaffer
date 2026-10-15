// Explore-order section showing the collection route: waypoints, their
// collectibles with an optional collect toggle in the live view, and the unlock
// cost of hard-drive pods.

import type { ExploreWaypoint, UnlockCost } from '../../api/types.js';
import { COLLECTIBLE_LABEL, fmtCoords } from './format.js';

/**
 * Live-view execution wiring for an explore route. Absent → plan-only render (no
 * collect checkboxes), the shape a revision snapshot needs.
 */
export interface WaypointsExecution {
  busy: boolean;
  readOnly: boolean;
  collected: (waypointId: string, collectibleId: string) => boolean;
  onToggle: (waypointId: string, collectibleId: string, collected: boolean) => void;
}

/** "opens with 50 Desc_IronPlate_C + 250 MW" — a pod's server-derived unlock cost. */
function fmtUnlock(cost: UnlockCost): string {
  const parts: string[] = [];
  if (cost.item !== undefined) {
    parts.push(`${cost.item.amount} ${cost.item.itemClass}`);
  }
  if (cost.powerMW !== undefined) {
    parts.push(`${cost.powerMW} MW`);
  }
  return parts.length > 0 ? `opens with ${parts.join(' + ')}` : 'free to open';
}

interface WaypointsSectionProps {
  waypoints: ExploreWaypoint[];
  execution?: WaypointsExecution;
}

/**
 * An explore order's collection route: ordered waypoints, each listing the
 * collectibles to grab (with a per-collectible collect toggle in the live view)
 * and, for hard-drive pods, the cost to open them.
 */
export function WaypointsSection({
  waypoints,
  execution,
}: WaypointsSectionProps): React.JSX.Element | null {
  if (waypoints.length === 0) {
    return null;
  }
  const total = waypoints.reduce((n, w) => n + w.collectibles.length, 0);
  const done = waypoints.reduce((n, w) => n + w.collectibles.filter((c) => c.collected).length, 0);
  return (
    <div className="section">
      <span className="label">
        Route — {done} / {total} collected
      </span>
      <ol className={execution !== undefined ? 'checks' : 'checks plan'}>
        {[...waypoints]
          .sort((a, b) => a.order - b.order)
          .map((wp, i) => (
            <li key={wp.id}>
              <span className="step-n">{String(i + 1).padStart(2, '0')}</span>
              <span className="check-body">
                {wp.label ?? `Waypoint ${i + 1}`}
                <span className="check-note">{fmtCoords(wp.coordinates)}</span>
                {wp.relativeToPlayer !== undefined ? (
                  <span className="check-note">{wp.relativeToPlayer}</span>
                ) : null}
                {wp.notes !== undefined ? <span className="check-note">{wp.notes}</span> : null}
              </span>
              <div className="machines step-buildables">
                {wp.collectibles.map((c) => (
                  <div key={c.id} className={`machine${c.collected ? ' done' : ''}`}>
                    {execution !== undefined ? (
                      <input
                        type="checkbox"
                        checked={execution.collected(wp.id, c.id)}
                        disabled={execution.busy || execution.readOnly}
                        onChange={(e) => execution.onToggle(wp.id, c.id, e.target.checked)}
                      />
                    ) : null}
                    <span className="check-body">
                      {COLLECTIBLE_LABEL[c.kind]}
                      {c.reason !== undefined ? (
                        <span className="check-note">{c.reason}</span>
                      ) : null}
                      {c.unlockCost !== undefined ? (
                        <span className="check-note">{fmtUnlock(c.unlockCost)}</span>
                      ) : null}
                      {c.coordinates !== undefined ? (
                        <span className="check-note">{fmtCoords(c.coordinates)}</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </li>
          ))}
      </ol>
    </div>
  );
}
