// Plan section components for build steps (with per-buildable cost) and the
// aggregated build cost. Plan-only by default; the live panel passes an execution
// object to add checkboxes and steppers.

import type { WorkOrderStep, WorkOrderStepDef } from '../../api/types.js';
import { remainingCost, totalCost } from '../../workOrderCost.js';
import { buildableCostLines, fmtCost } from './format.js';

/**
 * Live-view execution wiring. When absent the section renders plan-only
 * (no checkboxes or steppers) — the shape a revision snapshot needs.
 */
export interface BuildStepsExecution {
  busy: boolean;
  readOnly: boolean;
  stepChecked: (stepId: string) => boolean;
  builtCount: (stepId: string, buildableId: string) => number;
  onToggleStep: (stepId: string, checked: boolean) => void;
  onSetBuilt: (stepId: string, buildableId: string, count: number) => void;
}

interface BuildStepsSectionProps {
  steps: WorkOrderStepDef[];
  execution?: BuildStepsExecution;
}

/**
 * The order's work content: build steps, each with its buildables and their
 * per-buildable cost. Typed against the plan-only Def shapes so a revision
 * snapshot renders through the same component; the live panel passes
 * {@link BuildStepsExecution} to add the checkbox/stepper adornments.
 */
export function BuildStepsSection({
  steps,
  execution,
}: BuildStepsSectionProps): React.JSX.Element | null {
  if (steps.length === 0) {
    return null;
  }
  return (
    <div className="section">
      <span className="label">Build Steps</span>
      <ol className={execution !== undefined ? 'checks' : 'checks plan'}>
        {[...steps]
          .sort((a, b) => a.order - b.order)
          .map((step, i) => (
            <li key={step.id} className={execution?.stepChecked(step.id) === true ? 'done' : ''}>
              {execution !== undefined ? (
                <input
                  type="checkbox"
                  checked={execution.stepChecked(step.id)}
                  disabled={execution.busy || execution.readOnly}
                  onChange={(e) => execution.onToggleStep(step.id, e.target.checked)}
                />
              ) : null}
              <span className="step-n">{String(i + 1).padStart(2, '0')}</span>
              <span className="check-body">
                {step.title}
                {step.description !== undefined ? (
                  <span className="check-note">{step.description}</span>
                ) : null}
              </span>
              {step.buildables.length > 0 ? (
                <div className="machines step-buildables">
                  {step.buildables.map((b) => (
                    <div key={b.id} className="machine">
                      <span className="check-body">
                        {b.name}
                        {b.recipeName !== undefined ? (
                          <span className="check-note">{b.recipeName}</span>
                        ) : null}
                        {b.buildingClass !== undefined ? (
                          <span className="check-note mono">{b.buildingClass}</span>
                        ) : null}
                        {b.notes !== undefined ? (
                          <span className="check-note">{b.notes}</span>
                        ) : null}
                        {b.buildCost.length > 0 ? (
                          <span className="check-note">{fmtCost(buildableCostLines(b))}</span>
                        ) : null}
                      </span>
                      {execution !== undefined ? (
                        <BuildableStepper
                          step={step}
                          buildableId={b.id}
                          required={b.requiredCount}
                          execution={execution}
                        />
                      ) : (
                        <span className="qty muted">× {b.requiredCount}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
      </ol>
    </div>
  );
}

function BuildableStepper({
  step,
  buildableId,
  required,
  execution,
}: {
  step: WorkOrderStepDef;
  buildableId: string;
  required: number;
  execution: BuildStepsExecution;
}): React.JSX.Element {
  const built = execution.builtCount(step.id, buildableId);
  const disabled = execution.busy || execution.readOnly;
  return (
    <div className="stepper">
      <button
        type="button"
        disabled={disabled || built <= 0}
        onClick={() => execution.onSetBuilt(step.id, buildableId, Math.max(0, built - 1))}
      >
        −
      </button>
      <span className={`count ${built >= required ? 'met' : ''}`}>{built}</span>
      <button
        type="button"
        disabled={disabled || built >= required}
        onClick={() => execution.onSetBuilt(step.id, buildableId, Math.min(required, built + 1))}
      >
        +
      </button>
      <span className="req">/ {required}</span>
    </div>
  );
}

/**
 * The order's aggregated build cost. Remaining cost only exists for a live
 * order (it needs built counts) — snapshots pass only `steps`.
 */
export function BuildCostSection({
  steps,
  liveSteps,
}: {
  steps: WorkOrderStepDef[];
  liveSteps?: WorkOrderStep[];
}): React.JSX.Element | null {
  const total = totalCost(steps);
  if (total.length === 0) {
    return null;
  }
  const remaining = liveSteps !== undefined ? remainingCost(liveSteps) : null;
  const partlyBuilt = remaining !== null && fmtCost(remaining) !== fmtCost(total);
  return (
    <div className="section">
      <span className="label">Build Cost</span>
      <div className="checks materials">
        <span className="check-body">Total: {fmtCost(total)}</span>
        {partlyBuilt ? (
          <span className="check-note">
            {remaining.length > 0 ? `Remaining: ${fmtCost(remaining)}` : 'All buildables built.'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
