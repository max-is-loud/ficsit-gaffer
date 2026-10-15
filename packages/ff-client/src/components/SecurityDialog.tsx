// Two-factor management dialog: enrol with a locally rendered QR code and
// recovery codes, verify a code to enable it, or disable it with a password.
// Calls the auth helpers in api/auth.ts directly.

import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

import { disableTwoFactor, enableTwoFactor, verifyTotp } from '../api/auth.js';

interface SecurityDialogProps {
  /** Whether MFA is currently enabled for the account. */
  twoFactorEnabled: boolean;
  onClose: () => void;
  /** Called after MFA is enabled or disabled, so the app can refresh the user. */
  onChanged: () => Promise<void> | void;
}

type Step = 'status' | 'enable-password' | 'enable-confirm' | 'disable-password';

/** Pulls the base32 secret out of an `otpauth://` URI for manual entry. */
function secretFromUri(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

/**
 * Account security: enrol or remove two-factor authentication (TOTP + single-use
 * recovery codes). Enrolment is a three-step flow — confirm password, scan/enter
 * the secret and save the recovery codes, then verify a code to switch it on.
 * The pioneer scans the QR with their authenticator app, or enters the secret
 * manually. The QR is rendered locally from the `otpauth://` URI (qrcode.react,
 * inline SVG) — no external QR service, keeping the app free of third-party
 * network calls.
 */
export function SecurityDialog({
  twoFactorEnabled,
  onClose,
  onChanged,
}: SecurityDialogProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('status');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [totpURI, setTotpURI] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown, fallback: string): void => {
    setError(e instanceof Error ? e.message : fallback);
    setBusy(false);
  };

  const beginEnable = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const enrolment = await enableTwoFactor(password);
      setTotpURI(enrolment.totpURI);
      setBackupCodes(enrolment.backupCodes);
      setPassword('');
      setStep('enable-confirm');
      setBusy(false);
    } catch (e) {
      fail(e, 'Could not start two-factor setup.');
    }
  };

  const confirmEnable = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(code.trim(), false);
      await onChanged();
      onClose();
    } catch (e) {
      fail(e, 'That code was not accepted.');
    }
  };

  const confirmDisable = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await disableTwoFactor(password);
      await onChanged();
      onClose();
    } catch (e) {
      fail(e, 'Could not disable two-factor.');
    }
  };

  return (
    <div className="overlay nested-overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Account security"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Account security</h2>

        {step === 'status' ? (
          <>
            <p className="hint">
              Two-factor authentication is{' '}
              <strong>{twoFactorEnabled ? 'enabled' : 'not enabled'}</strong>. When enabled, a code
              from your authenticator app (or a recovery code) is required at every sign-in.
            </p>
            <div className="actions">
              <button type="button" className="icon-button" onClick={onClose}>
                Close
              </button>
              {twoFactorEnabled ? (
                <button
                  type="button"
                  className="send"
                  onClick={() => {
                    setError(null);
                    setStep('disable-password');
                  }}
                >
                  Disable two-factor
                </button>
              ) : (
                <button
                  type="button"
                  className="send"
                  onClick={() => {
                    setError(null);
                    setStep('enable-password');
                  }}
                >
                  Set up two-factor
                </button>
              )}
            </div>
          </>
        ) : null}

        {step === 'enable-password' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void beginEnable();
            }}
          >
            <p className="hint">Confirm your password to begin setup.</p>
            <div className="field">
              <label htmlFor="sec-password">Password</label>
              <input
                id="sec-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error !== null ? <p className="err">{error}</p> : null}
            <div className="actions">
              <button type="button" className="icon-button" onClick={() => setStep('status')}>
                Back
              </button>
              <button type="submit" className="send" disabled={busy || password.length === 0}>
                {busy ? 'Working' : 'Continue'}
              </button>
            </div>
          </form>
        ) : null}

        {step === 'enable-confirm' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmEnable();
            }}
          >
            <p className="hint">
              Scan this with your authenticator app (or enter the key manually), then enter the
              6-digit code it shows to switch on two-factor.
            </p>
            <div className="field">
              <label>Scan QR code</label>
              <div className="qr-box">
                <QRCodeSVG value={totpURI} size={176} marginSize={2} />
              </div>
            </div>
            <div className="field">
              <label>Or enter this key manually</label>
              <code className="secret-block">{secretFromUri(totpURI)}</code>
            </div>
            <div className="field">
              <label>Recovery codes — save these now</label>
              <code className="secret-block">{backupCodes.join('\n')}</code>
              <span className="hint">
                Each code works once. They are your way back in if you lose your authenticator.
              </span>
            </div>
            <div className="field">
              <label htmlFor="sec-code">Authenticator code</label>
              <input
                id="sec-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error !== null ? <p className="err">{error}</p> : null}
            <div className="actions">
              <button type="button" className="icon-button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="send" disabled={busy || code.trim().length === 0}>
                {busy ? 'Verifying' : 'Turn on two-factor'}
              </button>
            </div>
          </form>
        ) : null}

        {step === 'disable-password' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmDisable();
            }}
          >
            <p className="hint">Confirm your password to turn off two-factor authentication.</p>
            <div className="field">
              <label htmlFor="sec-disable-password">Password</label>
              <input
                id="sec-disable-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error !== null ? <p className="err">{error}</p> : null}
            <div className="actions">
              <button type="button" className="icon-button" onClick={() => setStep('status')}>
                Back
              </button>
              <button type="submit" className="send" disabled={busy || password.length === 0}>
                {busy ? 'Working' : 'Disable two-factor'}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
