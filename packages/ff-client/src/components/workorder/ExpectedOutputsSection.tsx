// Plan-only sections for what an order delivers (power as the hero figure, other
// outputs as a ledger) and the foreman's freeform notes.

import type { ExpectedOutput } from '../../api/types.js';
import { outputLine } from './format.js';

/**
 * What the order delivers — the goal made concrete. Power gets the hero
 * treatment; other outputs are a compact ledger. Plan-only.
 */
export function ExpectedOutputsSection({
  outputs,
}: {
  outputs: ExpectedOutput[];
}): React.JSX.Element | null {
  if (outputs.length === 0) {
    return null;
  }
  const power = outputs.find((out) => out.kind === 'power');
  const others = outputs.filter((out) => out.kind !== 'power');
  return (
    <div className="section output">
      <span className="label">Expected Output</span>
      {power !== undefined && power.kind === 'power' ? (
        <div className="power-hero">
          <span className="power-num">{power.megawatts}</span>
          <span className="power-unit">MW</span>
          <span className="power-tag">⚡ NET</span>
        </div>
      ) : null}
      {others.length > 0 ? (
        <div className="ledger">
          {others.map((out, i) => {
            const line = outputLine(out);
            return (
              <div className="row" key={i}>
                <span>{line.label}</span>
                <span className="qty">{line.value}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The Foreman's freeform build notes. Plan-only. */
export function NotesSection({ notes }: { notes?: string[] }): React.JSX.Element | null {
  if (notes === undefined || notes.length === 0) {
    return null;
  }
  return (
    <div className="section notes">
      <span className="label">FM Notes</span>
      <ul className="fm-notes">
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
