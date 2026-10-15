// Top-level shell. Gates on auth state, boot and onboarding, then lays out the
// header, the resizable chat/work-order split (width persisted in localStorage),
// the drawer dock and the settings and new-playthrough dialogs. All state and
// server calls come from useForeman.

import { useCallback, useEffect, useRef, useState } from 'react';

import { AuthScreen } from './components/AuthScreen.js';
import { ChatColumn } from './components/ChatColumn.js';
import { Header } from './components/Header.js';
import { NewPlaythroughModal } from './components/NewPlaythroughModal.js';
import { Onboarding } from './components/Onboarding.js';
import { PlaythroughSwitcher } from './components/PlaythroughSwitcher.js';
import { SaveDropZone } from './components/SaveDropZone.js';
import { SaveHistory } from './components/SaveHistory.js';
import { SaveWarningBanner } from './components/SaveWarningBanner.js';
import { DrawerDock } from './components/DrawerDock.js';
import { AccountSettingsDialog, type AccountSection } from './components/AccountSettingsDialog.js';
import { PlaythroughSettingsDialog } from './components/PlaythroughSettingsDialog.js';
import { WorkHistoryDrawerBody } from './components/WorkHistoryDrawer.js';
import { WorkOrderPanel } from './components/WorkOrderPanel.js';
import { useForeman } from './useForeman.js';

const SPLIT_KEY = 'foreman.chatSplit';
const MIN_PCT = 20;
const MAX_PCT = 75;

function clampPct(value: number): number {
  return Math.min(MAX_PCT, Math.max(MIN_PCT, value));
}

function initialSplit(): number {
  try {
    const stored = Number.parseFloat(localStorage.getItem(SPLIT_KEY) ?? '');
    if (Number.isFinite(stored)) {
      return clampPct(stored);
    }
  } catch {
    /* ignore storage failures */
  }
  return 30;
}

export function App(): React.JSX.Element {
  const foreman = useForeman();
  // Which account-settings tab the dialog is open on (null = closed): the user
  // menu opens the first tab, the add-a-key banner jumps straight to LLM.
  const [accountSection, setAccountSection] = useState<AccountSection | null>(null);
  const [playthroughSettingsOpen, setPlaythroughSettingsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [chatPct, setChatPct] = useState(initialSplit);
  const mainRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(chatPct));
    } catch {
      /* ignore storage failures */
    }
  }, [chatPct]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || mainRef.current === null) {
      return;
    }
    const rect = mainRef.current.getBoundingClientRect();
    setChatPct(clampPct(((e.clientX - rect.left) / rect.width) * 100));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      setChatPct((p) => clampPct(p - 2));
    } else if (e.key === 'ArrowRight') {
      setChatPct((p) => clampPct(p + 2));
    }
  }, []);

  // Auth check still running: hold on the splash before deciding what to show.
  if (foreman.authStatus === 'loading') {
    return (
      <div className="splash">
        <span className="label">Checking your credentials…</span>
      </div>
    );
  }

  // Signed out: the account gate stands before everything else.
  if (foreman.authStatus === 'anon') {
    return (
      <AuthScreen
        onSignIn={foreman.signIn}
        onSignUp={foreman.signUp}
        onVerifyTotp={foreman.verifyTwoFactor}
        onVerifyBackupCode={foreman.verifyBackupCode}
      />
    );
  }

  if (foreman.booting) {
    return (
      <div className="splash">
        <span className="label">Bringing the foreman online…</span>
      </div>
    );
  }

  if (foreman.needsOnboarding && foreman.bootError === null) {
    return <Onboarding onComplete={foreman.completeOnboarding} />;
  }

  return (
    <div className="app">
      <Header
        switcher={
          <PlaythroughSwitcher
            playthroughs={foreman.playthroughs}
            current={foreman.playthrough}
            onSwitch={(id) => void foreman.switchPlaythrough(id)}
            onNew={() => setNewOpen(true)}
            onOpenSettings={() => setPlaythroughSettingsOpen(true)}
          />
        }
        saveDrop={
          <SaveDropZone
            onUpload={foreman.uploadCurrentSave}
            disabled={foreman.playthrough === null}
          />
        }
        userName={foreman.user?.name ?? null}
        userEmail={foreman.user?.email ?? null}
        onOpenAccountSettings={() => setAccountSection('profile')}
        onSignOut={() => void foreman.signOut()}
      />

      {foreman.keyNeeded ? (
        <div className="banner">
          <span>An API key is required to talk to the foreman.</span>
          <button type="button" onClick={() => setAccountSection('llm')}>
            Add a key
          </button>
        </div>
      ) : null}

      {foreman.bootError !== null ? (
        <div className="banner">
          <span>{foreman.bootError}</span>
        </div>
      ) : null}

      <SaveWarningBanner warnings={foreman.saveWarnings} onDismiss={foreman.dismissSaveWarnings} />

      <main
        className="main"
        ref={mainRef}
        style={{ ['--chat-pct']: `${chatPct}%` } as React.CSSProperties}
      >
        <ChatColumn messages={foreman.messages} sending={foreman.sending} onSend={foreman.send} />
        <div
          className="divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat and work-order panels"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        />
        <WorkOrderPanel
          playthroughId={foreman.playthrough?.id ?? null}
          current={foreman.displayedOrder}
          history={foreman.history}
          actions={foreman.workOrders}
          isViewingHistory={
            foreman.viewingId !== null && foreman.viewingId !== foreman.currentOrder?.id
          }
          onBackToActive={() => foreman.viewOrder(null)}
          onViewOrder={(id) => foreman.viewOrder(id === foreman.currentOrder?.id ? null : id)}
        />
        <DrawerDock
          drawers={[
            {
              id: 'history',
              label: 'Work History',
              render: ({ requestClose }) => (
                <WorkHistoryDrawerBody
                  history={foreman.history}
                  currentId={foreman.currentOrder?.id ?? null}
                  viewingId={foreman.viewingId}
                  onSelect={(id) => {
                    foreman.viewOrder(id === foreman.currentOrder?.id ? null : id);
                    requestClose();
                  }}
                />
              ),
            },
            {
              id: 'saves',
              label: 'Saves',
              render: () => (
                <SaveHistory
                  saves={foreman.saveHistory}
                  currentId={foreman.playthrough?.save?.id ?? null}
                  hasPlaythrough={foreman.playthrough !== null}
                  onLoad={() => void foreman.loadSaveHistory()}
                  onActivate={(id) => void foreman.activateSaveVersion(id)}
                  onDelete={(id) => void foreman.deleteSaveVersion(id)}
                />
              ),
            },
          ]}
        />
      </main>

      {accountSection !== null && foreman.user !== null ? (
        <AccountSettingsDialog
          user={foreman.user}
          foremen={foreman.foremen}
          playthroughs={foreman.playthroughs}
          llm={foreman.llm}
          twoFactorEnabled={foreman.user?.twoFactorEnabled ?? false}
          initialSection={accountSection}
          onClose={() => setAccountSection(null)}
          onSaveLlm={foreman.saveLlm}
          onAddForeman={foreman.addForeman}
          onEditForeman={foreman.editForeman}
          onRemoveForeman={foreman.removeForeman}
          onRefreshUser={foreman.refreshUser}
        />
      ) : null}

      {playthroughSettingsOpen && foreman.playthrough !== null ? (
        <PlaythroughSettingsDialog
          playthrough={foreman.playthrough}
          foremen={foreman.foremen}
          onClose={() => setPlaythroughSettingsOpen(false)}
          onSave={foreman.savePlaythroughSettings}
          onManageForemen={() => {
            setPlaythroughSettingsOpen(false);
            setAccountSection('foremen');
          }}
          onDelete={async () => {
            if (foreman.playthrough !== null) {
              await foreman.removePlaythrough(foreman.playthrough.id);
            }
          }}
        />
      ) : null}

      {newOpen ? (
        <NewPlaythroughModal
          foremen={foreman.foremen}
          onCreateForeman={foreman.addForeman}
          onCreate={foreman.newPlaythrough}
          onPreviewSave={(file) => foreman.previewSaveFile(file).then((r) => r.matches)}
          onUseExisting={foreman.addSaveToExisting}
          onClose={() => setNewOpen(false)}
        />
      ) : null}
    </div>
  );
}
