// Global header bar. It lays out the wordmark, the playthrough switcher and save
// drop-zone passed in by App, and the user menu.

import { UserMenu } from './UserMenu.js';

interface HeaderProps {
  /** The playthrough switcher control, rendered next to the wordmark. */
  switcher?: React.ReactNode;
  /** The save drop-zone, rendered beside the switcher. */
  saveDrop?: React.ReactNode;
  userName: string | null;
  userEmail: string | null;
  onOpenAccountSettings: () => void;
  onSignOut: () => void;
}

/** Global header: wordmark, playthrough switcher, live dot, and account menu. */
export function Header({
  switcher,
  saveDrop,
  userName,
  userEmail,
  onOpenAccountSettings,
  onSignOut,
}: HeaderProps): React.JSX.Element {
  return (
    <header className="header">
      <div className="wordmark">
        <span className="glyph" aria-hidden="true" />
        FOREMAN
      </div>
      {switcher !== undefined ? <div className="header-switcher">{switcher}</div> : null}
      {saveDrop !== undefined ? <div className="header-savedrop">{saveDrop}</div> : null}
      <div className="spacer" />
      <span className="status">
        <span className="pulse-dot" aria-hidden="true" />
        <span className="label">ONLINE</span>
      </span>
      <UserMenu
        name={userName}
        email={userEmail}
        onOpenAccountSettings={onOpenAccountSettings}
        onSignOut={onSignOut}
      />
    </header>
  );
}
