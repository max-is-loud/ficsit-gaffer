// Plan-only sections for the recommended build location (summary, bearing,
// coordinates) and the resource nodes feeding the order.

import type { LocationRecommendation, ResourceNodeReference } from '../../api/types.js';
import { Collapsible } from './Collapsible.js';
import { fmtCoords, metres } from './format.js';

/**
 * Where the Foreman recommends building — summary, bearing from the player,
 * the reasoning, and map coordinates. Plan-only.
 */
export function LocationSection({
  location,
}: {
  location?: LocationRecommendation;
}): React.JSX.Element | null {
  if (location === undefined) {
    return null;
  }
  return (
    <div className="section">
      <span className="label">Location</span>
      <p className="wo-loc">
        <span className="loc-tag">LOC</span> {location.summary}
        {location.relativeToPlayer !== undefined ? ` — ${location.relativeToPlayer}` : ''}
      </p>
      {location.rationale !== undefined ? (
        <p className="wo-loc secondary">
          <span className="loc-tag">WHY</span> {location.rationale}
        </p>
      ) : null}
      {location.coordinates !== undefined ? (
        <p className="wo-loc secondary">
          <span className="loc-tag">MAP</span>{' '}
          <span className="mono">{fmtCoords(location.coordinates)}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The resource nodes feeding the order, with distances and map coordinates. Plan-only. */
export function ResourceNodesSection({
  nodes,
}: {
  nodes?: ResourceNodeReference[];
}): React.JSX.Element | null {
  if (nodes === undefined || nodes.length === 0) {
    return null;
  }
  return (
    <Collapsible label="Resource Nodes">
      <div className="ledger">
        {nodes.map((n, i) => (
          <div className="row tall" key={n.id ?? i}>
            <span className="check-body">
              {n.resourceName}
              {n.purity !== undefined ? <span className="purity"> {n.purity}</span> : null}
              {n.notes !== undefined ? <span className="check-note">{n.notes}</span> : null}
              {n.coordinates !== undefined ? (
                <span className="check-note mono">{fmtCoords(n.coordinates)}</span>
              ) : null}
            </span>
            <span className="qty muted">
              {n.distanceFromWorkOrderLocation !== undefined
                ? `${metres(n.distanceFromWorkOrderLocation)} from site`
                : ''}
              {n.distanceFromWorkOrderLocation !== undefined && n.distanceFromPlayer !== undefined
                ? ' · '
                : ''}
              {n.distanceFromPlayer !== undefined ? `${metres(n.distanceFromPlayer)} from you` : ''}
            </span>
          </div>
        ))}
      </div>
    </Collapsible>
  );
}
