// Body of the Save History drawer: the playthrough's uploaded saves, newest
// first, with the current one badged and older ones activatable or deletable
// through callbacks.

import { useEffect } from 'react';

import type { Save } from '../api/types.js';

interface SaveHistoryProps {
  saves: Save[];
  /** Id of the current save (what feeds the foreman), if any. */
  currentId: string | null;
  /** Whether the active playthrough has a save at all (drives the empty copy). */
  hasPlaythrough: boolean;
  onLoad: () => void;
  onActivate: (saveId: string) => void;
  onDelete: (saveId: string) => void;
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function uploaded(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? '' : DATE_FMT.format(when);
}

function playtime(seconds: number | undefined): string {
  if (seconds === undefined) {
    return '';
  }
  return `${Math.round(seconds / 360) / 10}h`;
}

/**
 * The Save History drawer body: the active playthrough's uploaded `.sav` versions,
 * newest first. The current version (what the foreman reads) is badged; older
 * versions can be re-activated or deleted. Loads on open.
 */
export function SaveHistory({
  saves,
  currentId,
  hasPlaythrough,
  onLoad,
  onActivate,
  onDelete,
}: SaveHistoryProps): React.JSX.Element {
  useEffect(() => {
    onLoad();
  }, [onLoad]);

  if (!hasPlaythrough) {
    return <p className="empty">Open a playthrough to see its save history.</p>;
  }
  if (saves.length === 0) {
    return <p className="empty">No saves uploaded yet. Drop a .sav in the header to add one.</p>;
  }

  return (
    <div className="save-history">
      {saves.map((save) => {
        const current = save.id === currentId;
        return (
          <div key={save.id} className={`save-row${current ? ' current' : ''}`}>
            <div className="save-row-main">
              <span className="save-name">{save.saveName ?? save.fileName}</span>
              <span className="save-meta">
                {playtime(save.playDurationSeconds)}
                {save.playDurationSeconds !== undefined ? ' · ' : ''}
                {uploaded(save.uploadedAt)}
              </span>
            </div>
            {current ? (
              <span className="chip state-active">Current</span>
            ) : (
              <div className="save-row-actions">
                <button
                  type="button"
                  className="ghost-btn tiny"
                  onClick={() => onActivate(save.id)}
                >
                  Make current
                </button>
                <button type="button" className="ghost-btn tiny" onClick={() => onDelete(save.id)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
