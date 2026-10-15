// Per-playthrough settings dialog: name, attached foreman, pioneer profile, and a
// delete danger zone gated on typing the playthrough name. Changes are applied
// together by the footer Save through callbacks.

import { useState } from 'react';

import type { Foreman, Playthrough } from '../api/types.js';
import { PioneerProfileFields } from './PioneerProfile.js';
import { playthroughLabel } from './PlaythroughSwitcher.js';

interface PlaythroughSettingsDialogProps {
  playthrough: Playthrough;
  foremen: Foreman[];
  onClose: () => void;
  /** Persist name, pioneer profile and attached foreman in one save. */
  onSave: (input: { name: string; pioneerProfile: string; foremanId: string }) => Promise<void>;
  /** Jump to the foreman library in account settings (closes this dialog). */
  onManageForemen: () => void;
  /** Delete this playthrough (the parent picks the next one / re-onboards). */
  onDelete: () => Promise<void>;
}

/**
 * Settings scoped to the active playthrough, reached from the playthrough
 * switcher: its name, which reusable foreman persona is attached, and the
 * pioneer profile (play style lives per-run, not on the user). Everything is
 * applied together by the footer Save. Deletion lives in a danger zone gated
 * on typing the playthrough's display name. The account-level counterpart is
 * the account-settings dialog, where the persona library itself is managed.
 */
export function PlaythroughSettingsDialog({
  playthrough,
  foremen,
  onClose,
  onSave,
  onManageForemen,
  onDelete,
}: PlaythroughSettingsDialogProps): React.JSX.Element {
  const [name, setName] = useState(playthrough.name ?? '');
  const [foremanId, setForemanId] = useState(playthrough.foremanId);
  const [pioneerProfile, setPioneerProfile] = useState(playthrough.pioneerProfile ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteDraft, setDeleteDraft] = useState('');
  const [deleting, setDeleting] = useState(false);

  // The confirmation phrase is the display label, so unnamed playthroughs
  // require their "Playthrough <id>" fallback rather than an empty string.
  const label = playthroughLabel(playthrough);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), pioneerProfile, foremanId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save playthrough settings.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the playthrough.');
      setDeleting(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog settings-dialog"
        role="dialog"
        aria-label="Playthrough settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Playthrough settings</h2>

        <div className="settings-section">
          <div className="field">
            <label htmlFor="pt-name">Name</label>
            <input
              id="pt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Playthrough name"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="pt-foreman">Foreman</label>
            <select
              id="pt-foreman"
              value={foremanId}
              onChange={(e) => setForemanId(e.target.value)}
            >
              {foremen.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <span className="hint">
              The persona running this playthrough.{' '}
              <button type="button" className="link-button" onClick={onManageForemen}>
                Manage your foreman library in account settings
              </button>
              .
            </span>
          </div>

          <div className="settings-subsection">
            <span className="label">Pioneer profile</span>
            <p className="hint">Your play style for this playthrough. Takes effect next message.</p>
            <PioneerProfileFields value={pioneerProfile} onChange={setPioneerProfile} />
          </div>

          <div className="settings-subsection">
            <span className="label">Danger zone</span>
            <p className="hint">
              Deleting this playthrough removes its chat, work orders and saves. This cannot be
              undone.
            </p>
            {!confirmingDelete ? (
              <button
                type="button"
                className="icon-button danger"
                onClick={() => {
                  setDeleteDraft('');
                  setConfirmingDelete(true);
                }}
              >
                Delete this playthrough
              </button>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="pt-delete-confirm">
                    Type &ldquo;{label}&rdquo; to confirm deletion
                  </label>
                  <input
                    id="pt-delete-confirm"
                    value={deleteDraft}
                    onChange={(e) => setDeleteDraft(e.target.value)}
                    placeholder={label}
                    autoComplete="off"
                  />
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    disabled={deleteDraft !== label || deleting}
                    onClick={() => void remove()}
                  >
                    {deleting ? 'Deleting' : 'Delete playthrough'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {error !== null ? <p className="err">{error}</p> : null}

        <div className="actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="send" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
