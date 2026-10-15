// Header dropdown for the signed-in user: shows their email and offers Account
// settings and Sign out.

import { useState } from 'react';

interface UserMenuProps {
  /** The signed-in user's display name (falls back to their email). */
  name: string | null;
  email: string | null;
  onOpenAccountSettings: () => void;
  onSignOut: () => void;
}

/**
 * Header account menu: the user's name as a dropdown trigger, opening their
 * email (display only), Account settings, and Sign out. Mirrors the playthrough
 * switcher's dropdown so the two header controls read as siblings; the menu is
 * right-aligned since it sits at the far end of the header.
 */
export function UserMenu({
  name,
  email,
  onOpenAccountSettings,
  onSignOut,
}: UserMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const close = (): void => setOpen(false);
  const label = name !== null && name.length > 0 ? name : (email ?? 'Account');

  return (
    <div className="switcher user-menu">
      <button
        type="button"
        className="switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="switcher-name">{label}</span>
        <span className="switcher-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <>
          <div className="switcher-backdrop" onClick={close} aria-hidden="true" />
          <div className="switcher-menu" role="menu">
            {email !== null ? <div className="user-menu-email">{email}</div> : null}
            <div className="switcher-divider" />
            <button
              type="button"
              className="switcher-action"
              role="menuitem"
              onClick={() => {
                onOpenAccountSettings();
                close();
              }}
            >
              Account settings
            </button>
            <button
              type="button"
              className="switcher-action"
              role="menuitem"
              onClick={() => {
                onSignOut();
                close();
              }}
            >
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
