// The effort-level picker of the LLM settings, shown next to the model field.

import { EFFORT_LEVELS } from '../llmSettings.js';

interface EffortFieldProps {
  /** One of the effort levels, or empty for the server default. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * How hard the model works on each turn. A higher level suits hard planning and costs more tokens
 * and time. Whether the chosen model accepts the level is checked by the server, which refuses
 * a level the model cannot take with a clear message.
 */
export function EffortField({ value, onChange }: EffortFieldProps): React.JSX.Element {
  return (
    <div className="field">
      <label htmlFor="effort">Effort</label>
      <select id="effort" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Server default</option>
        {EFFORT_LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
      <span className="hint">
        How hard the model works on each turn. Higher costs more tokens and time. Not every model
        accepts every level; the server says so if yours does not. Applies when you use your own API
        key.
      </span>
    </div>
  );
}
