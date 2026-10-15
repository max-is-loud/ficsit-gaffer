// Before/after table of field changes between two work-order revisions. Renders
// nothing for an empty diff.

import type { WorkOrderRevisionDiff } from '../../api/types.js';
import { summarise } from './format.js';

/** The field-level before/after table for a revision diff. */
export function DiffTable({ diff }: { diff: WorkOrderRevisionDiff }): React.JSX.Element | null {
  if (diff.changes.length === 0) {
    return null;
  }
  return (
    <table className="diff">
      <thead>
        <tr>
          <th>Field</th>
          <th>Before (R{diff.fromRevision})</th>
          <th>After (R{diff.toRevision})</th>
        </tr>
      </thead>
      <tbody>
        {diff.changes.map((c) => (
          <tr key={c.field}>
            <td className="diff-field">{c.field}</td>
            <td className="diff-before">{summarise(c.before)}</td>
            <td className="diff-after">{summarise(c.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
