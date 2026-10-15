// Plan-only briefing at the top of an order: objective, goal, strategic rationale
// and definition of done.

interface PlanNarrativeProps {
  goal: string;
  objective?: string;
  strategicSignificance?: string;
  successCondition?: string;
}

/**
 * The briefing narrative at the top of a plan: the objective leads, backed by
 * the underlying goal, why it matters strategically, and what "done" means.
 * Plan-only — renders identically for the live order and a revision snapshot.
 */
export function PlanNarrative({
  goal,
  objective,
  strategicSignificance,
  successCondition,
}: PlanNarrativeProps): React.JSX.Element {
  return (
    <div className="wo-narrative">
      <p className="wo-objective">
        <span className="loc-tag">OBJ</span> {objective ?? goal}
      </p>
      {objective !== undefined && goal !== objective ? (
        <p className="wo-objective secondary">
          <span className="loc-tag">GOAL</span> {goal}
        </p>
      ) : null}
      {strategicSignificance !== undefined ? (
        <p className="wo-objective secondary">
          <span className="loc-tag">WHY</span> {strategicSignificance}
        </p>
      ) : null}
      {successCondition !== undefined ? (
        <p className="wo-objective secondary">
          <span className="loc-tag">DONE</span> {successCondition}
        </p>
      ) : null}
    </div>
  );
}
