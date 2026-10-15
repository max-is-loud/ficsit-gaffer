// The work-order cockpit. It switches between the live order, revision snapshots
// and the audit log, loads revisions, diffs and audit events, and wires the
// lifecycle controls (state transitions, close-out feedback, hours, acknowledge
// or revert revision) and execution toggles to the actions from useForeman. The
// plan sections themselves are the plan-only components in workorder/.

import { useEffect, useRef, useState } from 'react';

import { getAuditTrail, getRevisionDiff, getRevisions } from '../api/client.js';
import type {
  WorkOrder,
  WorkOrderAuditEvent,
  WorkOrderRevision,
  WorkOrderRevisionDiff,
} from '../api/types.js';
import type { WorkOrderActions } from '../useForeman.js';
import { RELATIONSHIP_LABEL, STATE_LABEL, woLabel } from './workOrderLabels.js';
import { Collapsible } from './workorder/Collapsible.js';
import {
  BuildCostSection,
  BuildStepsSection,
  type BuildStepsExecution,
} from './workorder/BuildStepsSection.js';
import { ExpectedOutputsSection, NotesSection } from './workorder/ExpectedOutputsSection.js';
import { LocationSection, ResourceNodesSection } from './workorder/LocationSections.js';
import { OpportunitySections, RecipesSection } from './workorder/OpportunitySections.js';
import { WaypointsSection, type WaypointsExecution } from './workorder/WaypointsSection.js';
import { PlanNarrative } from './workorder/PlanNarrative.js';
import { AuditView } from './workorder/AuditView.js';
import { DiffTable } from './workorder/DiffTable.js';
import { RevisionsView } from './workorder/RevisionsView.js';
import { fmtDate, fmtDateTime } from './workorder/format.js';

/** The panel's views: the live order, the revision snapshots, the audit log. */
type PanelView = 'order' | 'revisions' | 'audit';

interface WorkOrderPanelProps {
  playthroughId: string | null;
  current: WorkOrder | null;
  history: WorkOrder[];
  actions: WorkOrderActions;
  /** True when the displayed order is being viewed from history (read-only). */
  isViewingHistory: boolean;
  /** Return to the live active order. */
  onBackToActive: () => void;
  /** Open another order read-only (parent/child navigation). */
  onViewOrder?: (id: string) => void;
}

/**
 * The active work-order cockpit (Work Orders v2). Laid out briefing-first:
 * goal/summary/action material at the top (header, banners, narrative,
 * expected output, FM notes, lifecycle controls), the work content after
 * (build steps → cost, location, recipes, opportunities, relations, history).
 * Plan sections are shared, plan-only components (components/workorder/) so
 * the revision-snapshot view can reuse them.
 */
export function WorkOrderPanel({
  playthroughId,
  current,
  history,
  actions,
  isViewingHistory,
  onBackToActive,
  onViewOrder,
}: WorkOrderPanelProps): React.JSX.Element {
  const [revisions, setRevisions] = useState<WorkOrderRevision[]>([]);
  const [audit, setAudit] = useState<WorkOrderAuditEvent[]>([]);
  const [diff, setDiff] = useState<WorkOrderRevisionDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceWarn, setForceWarn] = useState(false);
  const [proposeDismissed, setProposeDismissed] = useState(false);
  // The completion close-out form (summary + pioneer feedback capture).
  const [closeOutOpen, setCloseOutOpen] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [enjoyedDraft, setEnjoyedDraft] = useState('');
  const [didNotEnjoyDraft, setDidNotEnjoyDraft] = useState('');
  const [feedbackNotesDraft, setFeedbackNotesDraft] = useState('');
  const [hoursDraft, setHoursDraft] = useState('');
  const [view, setView] = useState<PanelView>('order');
  // A revision the audit view asked to open in the Revisions tab.
  const [revisionFocus, setRevisionFocus] = useState<number | null>(null);
  const forceWarnRef = useRef<HTMLDivElement>(null);

  const id = current?.id ?? null;

  // Reset transient UI when the displayed order changes.
  useEffect(() => {
    setView('order');
    setRevisionFocus(null);
    setForceWarn(false);
    setProposeDismissed(false);
    setCloseOutOpen(false);
    setSummaryDraft('');
    setEnjoyedDraft('');
    setDidNotEnjoyDraft('');
    setFeedbackNotesDraft('');
    setHoursDraft('');
    setError(null);
  }, [id]);

  // Bring the force-complete confirmation into view when it opens.
  useEffect(() => {
    if (forceWarn) {
      forceWarnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [forceWarn]);

  // Pull the audit trail, revisions, and (when unacknowledged) the field diff for
  // the current order. Re-runs whenever the order object changes (any mutation).
  useEffect(() => {
    if (playthroughId === null || current === null) {
      setRevisions([]);
      setAudit([]);
      setDiff(null);
      return;
    }
    const pid = playthroughId;
    const orderId = current.id;
    let cancelled = false;
    void (async () => {
      try {
        const [revs, events] = await Promise.all([
          getRevisions(pid, orderId),
          getAuditTrail(pid, orderId),
        ]);
        if (cancelled) {
          return;
        }
        setRevisions(revs);
        setAudit(events);
        if (current.hasUnacknowledgedRevision && current.currentRevision > 1) {
          const d = await getRevisionDiff(pid, orderId);
          if (!cancelled) {
            setDiff(d);
          }
        } else {
          setDiff(null);
        }
      } catch {
        /* aux data is best-effort; the core order still renders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playthroughId, current]);

  const run = (fn: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    void fn()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Action failed.'))
      .finally(() => setBusy(false));
  };

  if (current === null) {
    return (
      <section className="pane work">
        <div className="pane-head">
          <span className="tick label">⟩</span>
          <span className="label">Active Work Order</span>
        </div>
        <div className="wo">
          <p className="empty">
            No active order. Ask the foreman what to build next, and it will issue one here.
          </p>
        </div>
      </section>
    );
  }

  const o = current;
  const terminal = o.state === 'completed' || o.state === 'cancelled' || o.state === 'superseded';
  // Viewing a past order from history is read-only too, even when it is not
  // terminal (e.g. a paused sibling) — only the live active order is editable.
  const readOnly = terminal || isViewingHistory;

  const incompleteSteps = o.buildSteps.filter((s) => !s.checked);
  const incompleteBuildables = o.buildSteps.flatMap((s) =>
    s.buildables.filter((b) => b.builtCount < b.requiredCount),
  );
  // Explore orders complete by collecting the route, not by checking build steps.
  const uncollected = (o.waypoints ?? []).flatMap((w) =>
    w.collectibles.filter((c) => !c.collected),
  );
  const isComplete =
    o.orderType === 'explore'
      ? uncollected.length === 0
      : incompleteSteps.length === 0 && incompleteBuildables.length === 0;

  const lastEvent = audit[audit.length - 1];
  const proposed =
    o.state === 'active' && !proposeDismissed && lastEvent?.eventType === 'completion_proposed';

  // Live execution wiring for the shared (plan-only) build-steps renderer.
  const stepById = new Map(o.buildSteps.map((s) => [s.id, s]));
  const execution: BuildStepsExecution = {
    busy,
    readOnly,
    stepChecked: (stepId) => stepById.get(stepId)?.checked ?? false,
    builtCount: (stepId, buildableId) =>
      stepById.get(stepId)?.buildables.find((b) => b.id === buildableId)?.builtCount ?? 0,
    onToggleStep: (stepId, checked) => run(() => actions.setStep(o.id, stepId, checked)),
    onSetBuilt: (stepId, buildableId, count) =>
      run(() => actions.setBuildable(o.id, stepId, buildableId, count)),
  };

  // Live execution wiring for an explore order's collection route.
  const waypointExecution: WaypointsExecution = {
    busy,
    readOnly,
    collected: (waypointId, collectibleId) =>
      (o.waypoints ?? [])
        .find((w) => w.id === waypointId)
        ?.collectibles.find((c) => c.id === collectibleId)?.collected ?? false,
    onToggle: (waypointId, collectibleId, collected) =>
      run(() => actions.setWaypointCollectible(o.id, waypointId, collectibleId, collected)),
  };

  const onComplete = (): void => {
    if (isComplete) {
      setCloseOutOpen(true);
    } else {
      setForceWarn(true);
    }
  };

  /** Textarea → list: one entry per non-empty line. */
  const toList = (raw: string): string[] =>
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

  const onConfirmComplete = (withFeedback: boolean): void => {
    const enjoyed = toList(enjoyedDraft);
    const didNot = toList(didNotEnjoyDraft);
    const freeform = feedbackNotesDraft.trim();
    const summary = summaryDraft.trim();
    const feedback =
      withFeedback && (enjoyed.length > 0 || didNot.length > 0 || freeform.length > 0)
        ? {
            enjoyedAspects: enjoyed,
            didNotEnjoy: didNot,
            freeformNotes: freeform.length > 0 ? freeform : undefined,
          }
        : undefined;
    run(() =>
      actions.transition(o.id, 'Complete', {
        completionSummary: summary.length > 0 ? summary : undefined,
        pioneerFeedback: feedback,
      }),
    );
  };

  const onLogHours = (): void => {
    const hours = Number.parseFloat(hoursDraft);
    if (!Number.isFinite(hours) || hours <= 0) {
      return;
    }
    setHoursDraft('');
    run(() => actions.logHours(o.id, hours));
  };

  const onForceComplete = (): void => {
    const summary = [
      incompleteSteps.length > 0 ? `${incompleteSteps.length} steps unchecked` : null,
      incompleteBuildables.length > 0 ? `${incompleteBuildables.length} buildables short` : null,
      uncollected.length > 0 ? `${uncollected.length} collectibles uncollected` : null,
    ]
      .filter(Boolean)
      .join('; ');
    run(() =>
      actions.transition(o.id, 'ForceComplete', {
        forceCompletionReason: 'Completed by the pioneer with items outstanding.',
        incompleteItemSummary: summary,
      }),
    );
  };

  return (
    <section className="pane work">
      <div className="pane-head">
        <span className="tick label">⟩</span>
        <span className="label">{readOnly ? 'Work Order' : 'Active Work Order'}</span>
        {o.hoursLogged !== undefined ? (
          <span className="label hours">{o.hoursLogged}h logged</span>
        ) : null}
      </div>

      <div className="wo">
        {isViewingHistory ? (
          <button type="button" className="ghost-btn back-active" onClick={onBackToActive}>
            ← Back to active order
          </button>
        ) : null}

        <div className="settings-tabs wo-tabs" role="tablist">
          {(
            [
              { key: 'order', label: 'Order' },
              { key: 'revisions', label: `Revisions (${Math.max(revisions.length, 1)})` },
              { key: 'audit', label: `Audit (${audit.length})` },
            ] as { key: PanelView; label: string }[]
          ).map((t) => (
            <button
              type="button"
              key={t.key}
              role="tab"
              aria-selected={view === t.key}
              className={`settings-tab${view === t.key ? ' selected' : ''}`}
              onClick={() => setView(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {view === 'revisions' ? (
          <RevisionsView
            playthroughId={playthroughId}
            order={o}
            revisions={revisions}
            busy={busy}
            readOnly={readOnly}
            onRevert={(n) => run(() => actions.revert(o.id, n))}
            focus={revisionFocus}
          />
        ) : null}

        {view === 'audit' ? (
          <AuditView
            events={audit}
            onOpenRevision={(n) => {
              setRevisionFocus(n);
              setView('revisions');
            }}
          />
        ) : null}

        {view === 'order' ? (
          <>
            {/* ══ Briefing — goal, summary and actions ══════════════════ */}
            <div className="wo-top">
              <span className="wo-id">{woLabel(o.sequenceNumber, o.orderType)}</span>
              {o.tier !== undefined ? <span className="wo-tier">Tier {o.tier}</span> : null}
              <span className="spacer" />
              <span className={`chip state-${o.state}`}>{STATE_LABEL[o.state] ?? o.state}</span>
            </div>
            <h1 className="wo-title">{o.title}</h1>
            <p className="wo-meta">
              R{o.currentRevision}
              {o.lastAcknowledgedRevision !== undefined
                ? ` (ack R${o.lastAcknowledgedRevision})`
                : ''}{' '}
              · game data {o.version} · created {fmtDate(o.createdAt)} · updated{' '}
              {fmtDate(o.updatedAt)}
            </p>
            {o.startedAt !== undefined ||
            o.pausedAt !== undefined ||
            o.blockedAt !== undefined ||
            o.completedAt !== undefined ? (
              <p className="wo-meta">
                {[
                  o.startedAt !== undefined ? `started ${fmtDateTime(o.startedAt)}` : null,
                  o.pausedAt !== undefined ? `paused ${fmtDateTime(o.pausedAt)}` : null,
                  o.blockedAt !== undefined ? `blocked ${fmtDateTime(o.blockedAt)}` : null,
                  o.completedAt !== undefined ? `completed ${fmtDateTime(o.completedAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
            {o.parentWorkOrderId !== undefined ? (
              <p className="wo-meta">
                ↳ child of{' '}
                {(() => {
                  const parent = history.find((h) => h.id === o.parentWorkOrderId);
                  const label =
                    parent !== undefined
                      ? `${woLabel(parent.sequenceNumber, parent.orderType)} ${parent.title}`
                      : 'parent order';
                  return onViewOrder !== undefined ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onViewOrder(o.parentWorkOrderId ?? '')}
                    >
                      {label}
                    </button>
                  ) : (
                    label
                  );
                })()}
                {o.relationshipToParent !== undefined
                  ? ` · ${RELATIONSHIP_LABEL[o.relationshipToParent]}`
                  : ''}
              </p>
            ) : null}
            {o.state !== 'blocked' && o.blockedReason !== undefined ? (
              <p className="wo-objective secondary">
                <span className="loc-tag">BLOCKER</span> {o.blockedReason}
                {o.blockedResolutionHint !== undefined ? ` — ${o.blockedResolutionHint}` : ''}
              </p>
            ) : null}

            {error !== null ? <div className="wo-error">{error}</div> : null}

            {/* Plan revised */}
            {o.hasUnacknowledgedRevision && !readOnly ? (
              <div className="banner-card revised">
                <div className="banner-card-head">
                  <span className="label">Plan revised by Foreman · R{o.currentRevision}</span>
                </div>
                {diff !== null && diff.changes.length > 0 ? (
                  <DiffTable diff={diff} />
                ) : (
                  <p className="banner-note">The plan changed. Your progress is preserved.</p>
                )}
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => run(() => actions.acknowledge(o.id))}
                >
                  Acknowledge
                </button>
              </div>
            ) : null}

            {/* Blocked */}
            {o.state === 'blocked' ? (
              <div className="banner-card blocked">
                <span className="label">Blocked — cannot proceed</span>
                <p className="banner-note">{o.blockedReason}</p>
                {o.blockedResolutionHint !== undefined ? (
                  <p className="banner-resolve">
                    <span className="loc-tag">RESOLVE</span> {o.blockedResolutionHint}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Foreman suggests completion */}
            {proposed ? (
              <div className="banner-card suggest">
                <p className="banner-note">
                  Foreman suggests:{' '}
                  {lastEvent?.note ?? 'this looks close to done — ready to close out?'}
                </p>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setProposeDismissed(true)}
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            <PlanNarrative
              goal={o.goal}
              objective={o.objective}
              strategicSignificance={o.strategicSignificance}
              successCondition={o.successCondition}
            />

            <ExpectedOutputsSection outputs={o.expectedOutputs} />

            <NotesSection notes={o.notes} />

            {/* Completion summary + captured feedback (terminal) */}
            {terminal && o.completionSummary !== undefined ? (
              <div className="banner-card closed">
                <span className="label">{STATE_LABEL[o.state]}</span>
                <p className="banner-note">{o.completionSummary}</p>
              </div>
            ) : null}
            {terminal && o.pioneerFeedback !== undefined ? (
              <div className="section notes">
                <span className="label">Pioneer Feedback</span>
                {o.pioneerFeedback.enjoyedAspects.length > 0 ? (
                  <>
                    <span className="check-note">Enjoyed</span>
                    <ul className="fm-notes">
                      {o.pioneerFeedback.enjoyedAspects.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {o.pioneerFeedback.didNotEnjoy.length > 0 ? (
                  <>
                    <span className="check-note">Did not enjoy</span>
                    <ul className="fm-notes">
                      {o.pioneerFeedback.didNotEnjoy.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {o.pioneerFeedback.freeformNotes !== undefined ? (
                  <p className="check-note">{o.pioneerFeedback.freeformNotes}</p>
                ) : null}
              </div>
            ) : null}

            {/* Lifecycle controls */}
            {!readOnly ? (
              <div className="controls">
                {forceWarn ? (
                  <div className="force-warn" ref={forceWarnRef}>
                    <span className="label">Incomplete work order</span>
                    <ul>
                      {incompleteSteps.length > 0 ? (
                        <li>{incompleteSteps.length} steps unchecked</li>
                      ) : null}
                      {incompleteBuildables.length > 0 ? (
                        <li>{incompleteBuildables.length} buildables short</li>
                      ) : null}
                      {uncollected.length > 0 ? (
                        <li>{uncollected.length} collectibles uncollected</li>
                      ) : null}
                    </ul>
                    <div className="force-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setForceWarn(false)}
                      >
                        Keep working
                      </button>
                      <button
                        type="button"
                        className="danger-btn"
                        disabled={busy}
                        onClick={onForceComplete}
                      >
                        Complete anyway
                      </button>
                    </div>
                  </div>
                ) : closeOutOpen ? (
                  <div className="force-warn close-out">
                    <span className="label">
                      Close out {woLabel(o.sequenceNumber, o.orderType)}
                    </span>
                    <div className="field">
                      <label htmlFor="co-summary">Completion summary (optional)</label>
                      <input
                        id="co-summary"
                        value={summaryDraft}
                        onChange={(e) => setSummaryDraft(e.target.value)}
                        placeholder="What got built, in a sentence"
                        autoComplete="off"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="co-enjoyed">Enjoyed (one per line, optional)</label>
                      <textarea
                        id="co-enjoyed"
                        rows={2}
                        value={enjoyedDraft}
                        onChange={(e) => setEnjoyedDraft(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="co-didnot">Did not enjoy (one per line, optional)</label>
                      <textarea
                        id="co-didnot"
                        rows={2}
                        value={didNotEnjoyDraft}
                        onChange={(e) => setDidNotEnjoyDraft(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="co-notes">Notes for the foreman (optional)</label>
                      <textarea
                        id="co-notes"
                        rows={2}
                        value={feedbackNotesDraft}
                        onChange={(e) => setFeedbackNotesDraft(e.target.value)}
                      />
                    </div>
                    <div className="force-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setCloseOutOpen(false)}
                      >
                        Keep working
                      </button>
                      <button
                        type="button"
                        className="complete-btn"
                        disabled={busy}
                        onClick={() => onConfirmComplete(true)}
                      >
                        ⚡ Complete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="control-row">
                    {o.state === 'new' ? (
                      <button
                        type="button"
                        className="primary-btn"
                        disabled={busy}
                        onClick={() => run(() => actions.transition(o.id, 'Start'))}
                      >
                        Start work order
                      </button>
                    ) : null}
                    {o.state === 'active' ? (
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={busy}
                        onClick={() => run(() => actions.transition(o.id, 'Pause'))}
                      >
                        Pause
                      </button>
                    ) : null}
                    {o.state === 'paused' ? (
                      <button
                        type="button"
                        className="primary-btn"
                        disabled={busy}
                        onClick={() => run(() => actions.transition(o.id, 'Resume'))}
                      >
                        Resume
                      </button>
                    ) : null}
                    {o.state === 'active' ? (
                      <button
                        type="button"
                        className="complete-btn"
                        disabled={busy}
                        onClick={onComplete}
                      >
                        ⚡ Complete work order
                      </button>
                    ) : null}
                    {(o.state === 'paused' || o.state === 'blocked') &&
                    (o.buildSteps.length > 0 || (o.waypoints ?? []).length > 0) ? (
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={busy}
                        onClick={() => setForceWarn(true)}
                      >
                        Force complete
                      </button>
                    ) : null}
                    {o.state === 'active' || o.state === 'paused' ? (
                      <span className="hours-log">
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={hoursDraft}
                          onChange={(e) => setHoursDraft(e.target.value)}
                          placeholder="h"
                          aria-label="Hours to log"
                        />
                        <button
                          type="button"
                          className="ghost-btn"
                          disabled={busy || hoursDraft.trim().length === 0}
                          onClick={onLogHours}
                        >
                          Log hours
                        </button>
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {/* ══ Work content — the how ════════════════════════════════ */}
            {o.orderType === 'explore' ? (
              <WaypointsSection waypoints={o.waypoints ?? []} execution={waypointExecution} />
            ) : (
              <>
                <BuildStepsSection steps={o.buildSteps} execution={execution} />
                <BuildCostSection steps={o.buildSteps} liveSteps={o.buildSteps} />
                <RecipesSection recipes={o.recipes} />
              </>
            )}

            <LocationSection location={o.locationRecommendation} />
            <ResourceNodesSection nodes={o.resourceNodes} />
            <OpportunitySections opportunities={o.opportunities} />

            {o.childWorkOrderIds.length > 0 ? (
              <Collapsible label={`Child Orders (${o.childWorkOrderIds.length})`}>
                <div className="ledger">
                  {o.childWorkOrderIds.map((cid) => {
                    const child = history.find((h) => h.id === cid);
                    const title = child !== undefined ? child.title : cid;
                    return (
                      <div className="row" key={cid}>
                        <span>
                          {onViewOrder !== undefined ? (
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => onViewOrder(cid)}
                            >
                              {title}
                            </button>
                          ) : (
                            title
                          )}
                          {child?.relationshipToParent !== undefined
                            ? ` · ${RELATIONSHIP_LABEL[child.relationshipToParent]}`
                            : ''}
                        </span>
                        <span className="qty muted">
                          {child !== undefined ? (STATE_LABEL[child.state] ?? child.state) : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Collapsible>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
