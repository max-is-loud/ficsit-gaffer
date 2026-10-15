// Presentational grid of the starting foreman personas from foremanPresets. The
// parent owns which one is selected.

import { FOREMAN_PRESETS, type ForemanPreset } from '../foremanPresets.js';

interface ForemanPresetGridProps {
  /** Key of the currently-selected preset, or null when none/edited. */
  selectedKey: string | null;
  /** Called with the chosen preset (seeds name + personality upstream). */
  onChoose: (preset: ForemanPreset) => void;
}

/** The grid of starting foreman personas, shared by onboarding and the
 * new-foreman flow. Purely presentational — the parent owns the selection. */
export function ForemanPresetGrid({
  selectedKey,
  onChoose,
}: ForemanPresetGridProps): React.JSX.Element {
  return (
    <div className="preset-grid">
      {FOREMAN_PRESETS.map((preset) => (
        <button
          type="button"
          key={preset.key}
          className={`preset-card${selectedKey === preset.key ? ' selected' : ''}`}
          onClick={() => onChoose(preset)}
          aria-pressed={selectedKey === preset.key}
        >
          <span className="preset-name">{preset.name}</span>
          <span className="preset-tagline">{preset.tagline}</span>
        </button>
      ))}
    </div>
  );
}
