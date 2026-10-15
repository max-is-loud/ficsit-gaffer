// Collapsed-by-default section wrapper built on native details/summary, used for
// secondary work-order sections.

/** A collapsed-by-default secondary section (native details/summary). */
export function Collapsible({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details className="collapsible">
      <summary>
        <span className="label">{label}</span>
        <span className="chevron">▸</span>
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}
