// Modal for starting a playthrough: name, foreman (existing or newly created),
// optional .sav upload with name defaulted from the save, and optional pioneer
// profile. It collects the input; creation and the same-game save match check are
// left to the parent.

import { useRef, useState } from 'react';

import type { Foreman, SaveMatch } from '../api/types.js';
import type { NewPlaythroughInput } from '../useForeman.js';
import { NewForemanModal } from './NewForemanModal.js';
import { PioneerProfileFields } from './PioneerProfile.js';
import { SaveMatchModal } from './SaveMatchModal.js';

interface NewPlaythroughModalProps {
  foremen: Foreman[];
  onCreateForeman: (input: { name: string; personality?: string }) => Promise<Foreman>;
  onCreate: (input: NewPlaythroughInput) => Promise<void>;
  /** Same-game preview for a chosen save, before committing a new playthrough. */
  onPreviewSave: (file: File) => Promise<SaveMatch[]>;
  /** Append the chosen save to an existing matched playthrough and open it. */
  onUseExisting: (playthroughId: string, file: File) => Promise<void>;
  onClose: () => void;
}

/**
 * Lightweight "new playthrough" flow: name it, pick (or create) a foreman,
 * optionally drop in a `.sav` (the name defaults from the save when left blank),
 * and optionally describe the pioneer's play style for this run. Creating a
 * foreman opens the shared preset-first modal, so a foreman is born the same way
 * here as in onboarding and Settings.
 */
export function NewPlaythroughModal({
  foremen,
  onCreateForeman,
  onCreate,
  onPreviewSave,
  onUseExisting,
  onClose,
}: NewPlaythroughModalProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [foremanChoice, setForemanChoice] = useState(foremen[0]?.id ?? '');
  const [addingForeman, setAddingForeman] = useState(false);
  const [pioneerProfile, setPioneerProfile] = useState('');
  const [saveFile, setSaveFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<SaveMatch[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const canCreate = foremanChoice.length > 0;

  const pickFile = (files: FileList | null): void => {
    const file = files?.[0];
    if (file !== undefined) {
      setSaveFile(file);
    }
  };

  const createNew = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        foremanId: foremanChoice,
        name: name.trim() || undefined,
        pioneerProfile: pioneerProfile.trim() || undefined,
        saveFile: saveFile ?? undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the playthrough.');
      setSubmitting(false);
    }
  };

  // On submit, if a save was chosen, check whether it belongs to an existing
  // playthrough first; if so, let the pioneer choose update-vs-create-new.
  const submit = async (): Promise<void> => {
    if (saveFile === null) {
      await createNew();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const found = await onPreviewSave(saveFile);
      if (found.length > 0) {
        setMatches(found);
        setSubmitting(false);
        return;
      }
      await createNew();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the save file.');
      setSubmitting(false);
    }
  };

  const useExisting = async (playthroughId: string): Promise<void> => {
    if (saveFile === null) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onUseExisting(playthroughId, saveFile);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the playthrough.');
      setSubmitting(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="New playthrough"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>New playthrough</h2>
        <p className="hint">
          Pick a foreman and optionally upload a save. Leave the name blank to use the save&apos;s
          name.
        </p>

        <div className="field">
          <label htmlFor="pt-name">Name</label>
          <input
            id="pt-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Iron World (or leave blank to use the save name)"
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="pt-foreman">Foreman</label>
          {foremen.length > 0 ? (
            <select
              id="pt-foreman"
              value={foremanChoice}
              onChange={(e) => setForemanChoice(e.target.value)}
            >
              {foremen.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="hint">No foremen yet — create one to get started.</span>
          )}
          <button type="button" className="icon-button" onClick={() => setAddingForeman(true)}>
            + New foreman
          </button>
        </div>

        <div className="field">
          <label htmlFor="pt-save">Save file (optional)</label>
          <div
            className={`dropzone${dragging ? ' dragging' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInput.current?.click();
              }
            }}
          >
            {saveFile !== null ? (
              <span className="dropzone-file">{saveFile.name}</span>
            ) : (
              <span className="dropzone-hint">Drop a .sav here, or click to choose a file</span>
            )}
          </div>
          <input
            id="pt-save"
            ref={fileInput}
            type="file"
            accept=".sav"
            hidden
            onChange={(e) => pickFile(e.target.files)}
          />
        </div>

        <div className="settings-section">
          <p className="hint">Optionally describe your play style for this run.</p>
          <PioneerProfileFields value={pioneerProfile} onChange={setPioneerProfile} />
        </div>

        {error !== null ? <p className="err">{error}</p> : null}

        <div className="actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="send"
            onClick={() => void submit()}
            disabled={!canCreate || submitting}
          >
            {submitting ? 'Creating' : 'Create'}
          </button>
        </div>

        {addingForeman ? (
          <NewForemanModal
            onCreate={onCreateForeman}
            onCreated={(f) => setForemanChoice(f.id)}
            onClose={() => setAddingForeman(false)}
          />
        ) : null}

        {matches !== null && saveFile !== null ? (
          <SaveMatchModal
            matches={matches}
            fileName={saveFile.name}
            busy={submitting}
            onUseExisting={(id) => void useExisting(id)}
            onCreateNew={() => void createNew()}
            onCancel={() => setMatches(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
