// Header dropdown for switching playthroughs and opening new-playthrough and
// settings. Also exports playthroughLabel, the display-name fallback used by
// other components.

import { useEffect, useState } from 'react';

import type { Playthrough } from '../api/types.js';

interface PlaythroughSwitcherProps {
  playthroughs: Playthrough[];
  current: Playthrough | null;
  onSwitch: (id: string) => void;
  onNew: () => void;
  /** Open the active playthrough's settings (name, foreman, pioneer profile, delete). */
  onOpenSettings: () => void;
}

/** A playthrough's display name: its set name, else a short id fallback. */
export function playthroughLabel(playthrough: Playthrough | null): string {
  if (playthrough === null) {
    return 'No playthrough';
  }
  return playthrough.name !== undefined && playthrough.name.length > 0
    ? playthrough.name
    : `Playthrough ${playthrough.id.slice(0, 8)}`;
}

/**
 * Header dropdown to switch between playthroughs and reach the lifecycle actions
 * (new / settings). Renaming and deletion live in the playthrough-settings
 * dialog. The current playthrough's chat history and work orders are resumed by
 * the parent when {@link onSwitch} fires.
 */
export function PlaythroughSwitcher({
  playthroughs,
  current,
  onSwitch,
  onNew,
  onOpenSettings,
}: PlaythroughSwitcherProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  // Close the menu whenever the active playthrough changes.
  useEffect(() => {
    setOpen(false);
  }, [current?.id]);

  const close = (): void => setOpen(false);

  return (
    <div className="switcher">
      <button
        type="button"
        className="switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="switcher-name">{playthroughLabel(current)}</span>
        <span className="switcher-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <>
          <div className="switcher-backdrop" onClick={close} aria-hidden="true" />
          <div className="switcher-menu" role="menu">
            <div className="switcher-list">
              {playthroughs.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  role="menuitemradio"
                  aria-checked={p.id === current?.id}
                  className={`switcher-item${p.id === current?.id ? ' selected' : ''}`}
                  onClick={() => {
                    onSwitch(p.id);
                    close();
                  }}
                >
                  <span className="switcher-tick" aria-hidden="true">
                    {p.id === current?.id ? '✓' : ''}
                  </span>
                  {playthroughLabel(p)}
                </button>
              ))}
            </div>

            <div className="switcher-divider" />

            <button
              type="button"
              className="switcher-action"
              onClick={() => {
                onNew();
                close();
              }}
            >
              + New playthrough
            </button>

            {current !== null ? (
              <button
                type="button"
                className="switcher-action"
                onClick={() => {
                  onOpenSettings();
                  close();
                }}
              >
                ⚙ Playthrough settings
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
