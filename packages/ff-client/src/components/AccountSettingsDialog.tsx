// Tabbed account-level settings dialog (profile, foremen, LLM, security, billing
// placeholder). Profile, foremen and security are delegated to their own
// components; this file owns tab selection, the LLM form and the footer Save.

import { useMemo, useState } from 'react';

import { updateDisplayName, type AuthUser } from '../api/auth.js';
import type { Foreman, Playthrough } from '../api/types.js';
import type { LlmSettings } from '../useForeman.js';
import {
  DEFAULT_HISTORY_WINDOW,
  MAX_HISTORY_WINDOW,
  MIN_HISTORY_WINDOW,
  parseHistoryWindow,
} from '../llmSettings.js';
import { ForemanLibrary } from './ForemanLibrary.js';
import { ProfileSettings } from './ProfileSettings.js';
import { SecurityDialog } from './SecurityDialog.js';

export type AccountSection = 'profile' | 'foremen' | 'llm' | 'security' | 'billing';

const SECTIONS: { key: AccountSection; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'foremen', label: 'Foremen' },
  { key: 'llm', label: 'LLM' },
  { key: 'security', label: 'Security' },
  { key: 'billing', label: 'Billing' },
];

interface AccountSettingsDialogProps {
  user: AuthUser;
  foremen: Foreman[];
  /** All playthroughs, to badge which foremen are attached somewhere. */
  playthroughs: Playthrough[];
  llm: LlmSettings;
  /** Whether the account has two-factor enabled (for the Security section). */
  twoFactorEnabled: boolean;
  /** Which tab to open on (e.g. the add-a-key banner lands on LLM). */
  initialSection?: AccountSection;
  onClose: () => void;
  /** Persist the browser-held LLM settings (synchronous, localStorage only). */
  onSaveLlm: (llm: LlmSettings) => void;
  onAddForeman: (input: { name: string; personality?: string }) => Promise<Foreman>;
  onEditForeman: (id: string, patch: { name?: string; personality?: string }) => Promise<void>;
  onRemoveForeman: (id: string) => Promise<void>;
  /** Re-reads the user after MFA or profile changes (header name, 2FA badge). */
  onRefreshUser: () => Promise<void> | void;
}

/**
 * Account-level settings reached from the user menu — everything global to the
 * user, independent of any one playthrough. Profile holds the display name
 * (saved via the footer) and password change (applies immediately); Foremen
 * holds the reusable persona library (edits apply immediately); LLM holds the
 * provider/model/key (kept only in this browser, saved via the footer);
 * Security manages two-factor (its setup opens a second-level dialog); Billing
 * is a placeholder. The per-playthrough counterpart is the
 * playthrough-settings dialog.
 */
export function AccountSettingsDialog({
  user,
  foremen,
  playthroughs,
  llm,
  twoFactorEnabled,
  initialSection,
  onClose,
  onSaveLlm,
  onAddForeman,
  onEditForeman,
  onRemoveForeman,
  onRefreshUser,
}: AccountSettingsDialogProps): React.JSX.Element {
  const [section, setSection] = useState<AccountSection>(initialSection ?? 'profile');
  const [displayName, setDisplayName] = useState(user.name);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [provider, setProvider] = useState(llm.provider);
  const [model, setModel] = useState(llm.model);
  const [baseUrl, setBaseUrl] = useState(llm.baseUrl);
  const [apiKey, setApiKey] = useState(llm.apiKey);
  // Empty string = use the server default (stored as 0). Kept as text so the field
  // can be cleared back to "default" rather than forced to a number.
  const [historyWindow, setHistoryWindow] = useState(
    llm.historyWindow > 0 ? String(llm.historyWindow) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Foremen attached to any playthrough are badged "in use" with delete
  // disabled — the server refuses to delete an attached persona anyway.
  const inUseIds = useMemo(() => new Set(playthroughs.map((p) => p.foremanId)), [playthroughs]);

  const modelPlaceholder =
    provider === 'openai'
      ? 'gpt-4.1'
      : provider === 'anthropic'
        ? 'claude-sonnet-4-6'
        : 'server default';

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      onSaveLlm({
        apiKey,
        provider,
        model,
        baseUrl,
        historyWindow: parseHistoryWindow(historyWindow),
      });
      const trimmedName = displayName.trim();
      if (trimmedName.length > 0 && trimmedName !== user.name) {
        await updateDisplayName(trimmedName);
        await onRefreshUser();
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog settings-dialog"
        role="dialog"
        aria-label="Account settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Account settings</h2>

        <div className="settings-tabs" role="tablist">
          {SECTIONS.map((s) => (
            <button
              type="button"
              key={s.key}
              role="tab"
              aria-selected={section === s.key}
              className={`settings-tab${section === s.key ? ' selected' : ''}`}
              onClick={() => setSection(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {section === 'profile' ? (
          <div className="settings-section">
            <ProfileSettings
              email={user.email}
              displayName={displayName}
              onDisplayNameChange={setDisplayName}
            />
          </div>
        ) : null}

        {section === 'foremen' ? (
          <div className="settings-section">
            <ForemanLibrary
              foremen={foremen}
              inUseIds={inUseIds}
              onAdd={onAddForeman}
              onEdit={onEditForeman}
              onRemove={onRemoveForeman}
              onError={setError}
            />
          </div>
        ) : null}

        {section === 'llm' ? (
          <div className="settings-section">
            <div className="field">
              <label htmlFor="provider">LLM provider</label>
              <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="">Server default</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI-compatible</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="model">Model</label>
              <input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={modelPlaceholder}
                autoComplete="off"
              />
            </div>
            {provider === 'openai' ? (
              <div className="field">
                <label htmlFor="baseurl">Base URL (optional)</label>
                <input
                  id="baseurl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  autoComplete="off"
                />
                <span className="hint">
                  For OpenAI-compatible providers: OpenAI, OpenRouter, Gemini (OpenAI-compatible),
                  Azure OpenAI. Leave blank for OpenAI.
                </span>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="apikey">LLM API key</label>
              <input
                id="apikey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Your provider key (stored only in this browser)"
                autoComplete="off"
              />
              <span className="hint">
                Needed unless the server has its own key. Sent with each message; never stored on
                the server. A key also unlocks the provider/model override above.
              </span>
            </div>
            {apiKey.length > 0 ? (
              <div className="field">
                <label htmlFor="historywindow">Conversation history window</label>
                <input
                  id="historywindow"
                  type="number"
                  min={MIN_HISTORY_WINDOW}
                  max={MAX_HISTORY_WINDOW}
                  value={historyWindow}
                  onChange={(e) => setHistoryWindow(e.target.value)}
                  placeholder={`${DEFAULT_HISTORY_WINDOW} (server default)`}
                  autoComplete="off"
                />
                <span className="hint">
                  How many recent messages the foreman keeps in context each turn. Higher remembers
                  more but costs more tokens; lower is cheaper. Leave blank for the default (
                  {DEFAULT_HISTORY_WINDOW}). Available because you supply your own API key.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {section === 'security' ? (
          <div className="settings-section">
            <p className="hint">
              Two-factor authentication is{' '}
              <strong>{twoFactorEnabled ? 'enabled' : 'not enabled'}</strong>. When enabled, a code
              from your authenticator app (or a recovery code) is required at every sign-in.
            </p>
            <button type="button" className="icon-button" onClick={() => setSecurityOpen(true)}>
              {twoFactorEnabled ? 'Manage two-factor' : 'Set up two-factor'}
            </button>

            {securityOpen ? (
              <SecurityDialog
                twoFactorEnabled={twoFactorEnabled}
                onChanged={onRefreshUser}
                onClose={() => setSecurityOpen(false)}
              />
            ) : null}
          </div>
        ) : null}

        {section === 'billing' ? (
          <div className="settings-section">
            <p className="hint">Billing &amp; subscription management is coming soon.</p>
          </div>
        ) : null}

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
