// The Profile tab of account settings: display name field (saved by the dialog
// footer) and a change-password form that applies immediately.

import { useState } from 'react';

import { changePassword } from '../api/auth.js';

interface ProfileSettingsProps {
  /** The account email (display only — sign-in identity, not editable here). */
  email: string;
  /** Display-name draft, owned by the dialog so its footer Save persists it. */
  displayName: string;
  onDisplayNameChange: (name: string) => void;
}

/**
 * The Profile section of account settings: the display name (persisted by the
 * dialog's footer Save) and a self-contained change-password form, which
 * applies immediately with its own button since it requires the current
 * password and signs other sessions out.
 */
export function ProfileSettings({
  email,
  displayName,
  onDisplayNameChange,
}: ProfileSettingsProps): React.JSX.Element {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const submitPassword = async (): Promise<void> => {
    setError(null);
    setChanged(false);
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setChanged(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  };

  const submittable = currentPassword.length > 0 && newPassword.length > 0 && !busy;

  return (
    <>
      <div className="field">
        <label htmlFor="profile-name">Display name</label>
        <input
          id="profile-name"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          autoComplete="name"
        />
        <span className="hint">Shown in the header account menu. Saved via the footer.</span>
      </div>

      <div className="field">
        <label htmlFor="profile-email">Email</label>
        <input id="profile-email" value={email} disabled autoComplete="off" />
        <span className="hint">Your sign-in identity — not editable here.</span>
      </div>

      <div className="settings-subsection">
        <span className="label">Change password</span>
        <p className="hint">
          Requires your current password. Other signed-in sessions are signed out; this one stays
          active.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPassword();
          }}
        >
          <div className="field">
            <label htmlFor="profile-current-password">Current password</label>
            <input
              id="profile-current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="field">
            <label htmlFor="profile-new-password">New password</label>
            <input
              id="profile-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <label htmlFor="profile-confirm-password">Confirm new password</label>
            <input
              id="profile-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error !== null ? <p className="err">{error}</p> : null}
          {changed ? <p className="hint">Password changed.</p> : null}
          <div className="actions">
            <button type="submit" className="send" disabled={!submittable}>
              {busy ? 'Working' : 'Change password'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
