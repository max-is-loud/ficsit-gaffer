// Modal for creating a foreman: pick a starting persona preset, then edit the
// name and personality before saving. Shared by the account foreman library and
// the new-playthrough modal.

import { useState } from 'react';

import type { Foreman } from '../api/types.js';
import type { ForemanPreset } from '../foremanPresets.js';
import { ForemanPresetGrid } from './ForemanPresetGrid.js';

interface NewForemanModalProps {
  /** Persists the foreman (Settings + new-playthrough both create immediately). */
  onCreate: (input: { name: string; personality: string }) => Promise<Foreman>;
  /** Called with the created foreman so the caller can select it. */
  onCreated?: (foreman: Foreman) => void;
  onClose: () => void;
}

/**
 * Create a foreman the way onboarding does: pick one of the five starting
 * personas, then edit. Rendered as a modal over whichever dialog opened it
 * (Settings' foreman library or the new-playthrough modal), so both reach the
 * library through the same preset-first flow.
 */
export function NewForemanModal({
  onCreate,
  onCreated,
  onClose,
}: NewForemanModalProps): React.JSX.Element {
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [personality, setPersonality] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Choosing a preset seeds both the name and the personality; either can then
  // be edited. Editing the personality clears the selection (it's now bespoke).
  const choosePreset = (preset: ForemanPreset): void => {
    setPresetKey(preset.key);
    setName(preset.name);
    setPersonality(preset.seed);
  };

  const canCreate = name.trim().length > 0 && personality.trim().length > 0;

  const create = async (): Promise<void> => {
    if (!canCreate) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await onCreate({ name: name.trim(), personality: personality.trim() });
      onCreated?.(created);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the foreman.');
      setSubmitting(false);
    }
  };

  return (
    <div className="overlay nested-overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="New foreman"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>New foreman</h2>
        <p className="hint">Pick a starting character, then make it your own.</p>

        <ForemanPresetGrid selectedKey={presetKey} onChoose={choosePreset} />

        <div className="field">
          <label htmlFor="nf-name">Name</label>
          <input
            id="nf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ADA"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="nf-persona">Personality (edit freely)</label>
          <textarea
            id="nf-persona"
            value={personality}
            onChange={(e) => {
              setPersonality(e.target.value);
              setPresetKey(null);
            }}
            placeholder="e.g. Calm, methodical planner who explains trade-offs."
          />
        </div>

        {error !== null ? <p className="err">{error}</p> : null}

        <div className="actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="send"
            onClick={() => void create()}
            disabled={!canCreate || submitting}
          >
            {submitting ? 'Creating' : 'Add foreman'}
          </button>
        </div>
      </div>
    </div>
  );
}
