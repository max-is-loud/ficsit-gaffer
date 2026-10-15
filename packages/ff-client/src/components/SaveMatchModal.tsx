// Modal shown when an uploaded save matches existing playthroughs: lets the user
// add it to one of them or create a new playthrough anyway. It never resolves
// ambiguous matches itself.

import type { SaveMatch } from '../api/types.js';

interface SaveMatchModalProps {
  matches: SaveMatch[];
  /** The uploaded file's name, for context. */
  fileName: string;
  busy: boolean;
  onUseExisting: (playthroughId: string) => void;
  onCreateNew: () => void;
  onCancel: () => void;
}

function playtime(seconds: number | undefined): string {
  return seconds === undefined ? '' : `${Math.round(seconds / 360) / 10}h`;
}

/**
 * Shown when an uploaded save looks like a game the user already has a playthrough
 * for (matched on session + map). Offers to update an existing playthrough rather
 * than silently creating a duplicate — or to create a new one anyway. Ambiguity
 * (multiple matches, regressed play time) is surfaced, never auto-resolved.
 */
export function SaveMatchModal({
  matches,
  fileName,
  busy,
  onUseExisting,
  onCreateNew,
  onCancel,
}: SaveMatchModalProps): React.JSX.Element {
  return (
    <div className="overlay nested-overlay" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Save matches an existing playthrough"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>This looks like an existing game</h2>
        <p className="hint">
          <strong>{fileName}</strong> matches{' '}
          {matches.length === 1
            ? 'a playthrough you already have'
            : `${matches.length} playthroughs`}
          . Update one with this save, or create a new playthrough anyway.
        </p>

        <div className="save-matches">
          {matches.map((m) => (
            <div key={m.playthroughId} className="save-match">
              <div className="save-row-main">
                <span className="save-name">
                  {m.playthroughName ?? m.currentSave.saveName ?? 'Untitled'}
                </span>
                <span className="save-meta">
                  current: {playtime(m.currentSave.playDurationSeconds) || 'unknown'}
                  {m.playtimeRegressed ? ' · ⚠ this save has less play time' : ''}
                </span>
              </div>
              <button
                type="button"
                className="ghost-btn tiny"
                disabled={busy}
                onClick={() => onUseExisting(m.playthroughId)}
              >
                Update this
              </button>
            </div>
          ))}
        </div>

        <div className="actions">
          <button type="button" className="icon-button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="send" onClick={onCreateNew} disabled={busy}>
            Create new anyway
          </button>
        </div>
      </div>
    </div>
  );
}
