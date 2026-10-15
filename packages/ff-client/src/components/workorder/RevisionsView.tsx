// Revisions tab of the work-order panel: the revision ledger, and for a selected
// revision its plan-only snapshot rendered with the shared plan sections plus the
// diff against the previous revision.

import { useEffect, useState } from 'react';

import { getRevisionDiff } from '../../api/client.js';
import type { WorkOrder, WorkOrderRevision, WorkOrderRevisionDiff } from '../../api/types.js';
import { RELATIONSHIP_LABEL, woLabel } from '../workOrderLabels.js';
import { BuildCostSection, BuildStepsSection } from './BuildStepsSection.js';
import { Collapsible } from './Collapsible.js';
import { DiffTable } from './DiffTable.js';
import { ExpectedOutputsSection, NotesSection } from './ExpectedOutputsSection.js';
import { LocationSection, ResourceNodesSection } from './LocationSections.js';
import { OpportunitySections, RecipesSection } from './OpportunitySections.js';
import { PlanNarrative } from './PlanNarrative.js';
import { fmtDate } from './format.js';

interface RevisionsViewProps {
  playthroughId: string | null;
  order: WorkOrder;
  revisions: WorkOrderRevision[];
  busy: boolean;
  readOnly: boolean;
  onRevert: (revisionNumber: number) => void;
  /** Externally-requested selection (e.g. a revision link in the audit view). */
  focus?: number | null;
}

/**
 * The previous-snapshot view: the order's revision ledger, and — when a
 * revision is selected — its plan-only snapshot laid out through the same
 * shared components as the live plan (no execution state: a snapshot has no
 * checkboxes, steppers or remaining cost), plus the field diff vs the
 * previous revision.
 */
export function RevisionsView({
  playthroughId,
  order,
  revisions,
  busy,
  readOnly,
  onRevert,
  focus,
}: RevisionsViewProps): React.JSX.Element {
  const [selected, setSelected] = useState<number | null>(null);
  const [diff, setDiff] = useState<WorkOrderRevisionDiff | null>(null);

  // Reset the selection when the displayed order changes.
  useEffect(() => {
    setSelected(null);
  }, [order.id]);

  // Follow an external selection request (audit-view revision links).
  useEffect(() => {
    if (focus !== undefined && focus !== null) {
      setSelected(focus);
    }
  }, [focus]);

  // The field diff of the selected revision against its predecessor.
  useEffect(() => {
    setDiff(null);
    if (playthroughId === null || selected === null || selected <= 1) {
      return;
    }
    let cancelled = false;
    void getRevisionDiff(playthroughId, order.id, selected - 1, selected)
      .then((d) => {
        if (!cancelled) {
          setDiff(d);
        }
      })
      .catch(() => {
        /* best-effort; the snapshot still renders */
      });
    return () => {
      cancelled = true;
    };
  }, [playthroughId, order.id, selected]);

  const sorted = [...revisions].sort((a, b) => b.revisionNumber - a.revisionNumber);
  const current =
    selected !== null ? revisions.find((r) => r.revisionNumber === selected) : undefined;

  return (
    <>
      <div className="section">
        <span className="label">Revisions</span>
        {sorted.length === 0 ? <p className="empty">No revisions recorded yet.</p> : null}
        <div className="ledger">
          {sorted.map((rev) => (
            <div
              className={`row revision${rev.revisionNumber === selected ? ' selected' : ''}`}
              key={rev.id}
            >
              <span className="rev-n">R{rev.revisionNumber}</span>
              <span className="rev-summary">
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    setSelected(rev.revisionNumber === selected ? null : rev.revisionNumber)
                  }
                >
                  {rev.changeSummary ?? rev.reason ?? `Revision ${rev.revisionNumber}`}
                </button>
                <span className="check-note">
                  {rev.createdBy} · {fmtDate(rev.createdAt)}
                  {rev.revisionNumber === order.currentRevision ? ' · current' : ''}
                </span>
              </span>
              {!readOnly && rev.revisionNumber < order.currentRevision ? (
                <button
                  type="button"
                  className="ghost-btn tiny"
                  disabled={busy}
                  onClick={() => onRevert(rev.revisionNumber)}
                >
                  Revert
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {current !== undefined ? (
        <div className="snapshot">
          <div className="wo-top">
            <span className="wo-id">
              {woLabel(order.sequenceNumber)} · R{current.revisionNumber}
            </span>
            <span className="spacer" />
            <span className="chip">snapshot</span>
          </div>
          <h1 className="wo-title">{current.planSnapshot.title}</h1>
          <p className="wo-meta">
            plan as of {fmtDate(current.createdAt)} · by {current.createdBy}
            {current.reason !== undefined ? ` · ${current.reason}` : ''}
          </p>
          {current.planSnapshot.parentWorkOrderId !== undefined ? (
            <p className="wo-meta">
              ↳ child of {current.planSnapshot.parentWorkOrderId}
              {current.planSnapshot.relationshipToParent !== undefined
                ? ` · ${RELATIONSHIP_LABEL[current.planSnapshot.relationshipToParent]}`
                : ''}
            </p>
          ) : null}
          {current.planSnapshot.blockedReason !== undefined ? (
            <p className="wo-objective secondary">
              <span className="loc-tag">BLOCKER</span> {current.planSnapshot.blockedReason}
              {current.planSnapshot.blockedResolutionHint !== undefined
                ? ` — ${current.planSnapshot.blockedResolutionHint}`
                : ''}
            </p>
          ) : null}

          {diff !== null && diff.changes.length > 0 ? (
            <Collapsible label={`Changes vs R${diff.fromRevision}`}>
              <DiffTable diff={diff} />
            </Collapsible>
          ) : null}

          <PlanNarrative
            goal={current.planSnapshot.goal}
            objective={current.planSnapshot.objective}
            strategicSignificance={current.planSnapshot.strategicSignificance}
            successCondition={current.planSnapshot.successCondition}
          />
          <ExpectedOutputsSection outputs={current.planSnapshot.expectedOutputs} />
          <NotesSection notes={current.planSnapshot.notes} />
          <BuildStepsSection steps={current.planSnapshot.buildSteps} />
          <BuildCostSection steps={current.planSnapshot.buildSteps} />
          <LocationSection location={current.planSnapshot.locationRecommendation} />
          <ResourceNodesSection nodes={current.planSnapshot.resourceNodes} />
          <RecipesSection recipes={current.planSnapshot.recipes} />
          <OpportunitySections opportunities={current.planSnapshot.opportunities} />
        </div>
      ) : null}
    </>
  );
}
