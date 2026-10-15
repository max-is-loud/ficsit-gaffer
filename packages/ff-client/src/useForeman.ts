// The client's single state hook: auth and session, playthroughs, the foreman
// library, saves, the chat stream, work-order state and mutations, and the
// browser-held LLM settings. Components receive everything through the
// ForemanState it returns; HTTP lives in api/client.ts and api/auth.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchCurrentUser,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUp as apiSignUp,
  verifyBackupCode as apiVerifyBackupCode,
  verifyTotp as apiVerifyTotp,
  type AuthUser,
} from './api/auth.js';
import {
  acknowledgeRevision,
  claimPlaythrough,
  createForeman,
  createPlaythrough,
  deleteForeman,
  deletePlaythrough,
  getForeman,
  activateSave,
  deleteSave,
  getPlaythrough,
  listForemen,
  listMessages,
  listPlaythroughs,
  listSaves,
  listWorkOrders,
  logHours,
  previewSave,
  patchForeman,
  patchPlaythrough,
  revertToRevision,
  setBuildableBuiltCount,
  setStepChecked,
  setWaypointCollected,
  streamChat,
  transitionWorkOrder,
  uploadSave,
  type ClientLlmConfig,
  type TransitionOptions,
} from './api/client.js';
import {
  TERMINAL_STATES,
  type Foreman,
  type Playthrough,
  type Save,
  type SavePreviewResult,
  type SaveUploadResult,
  type SaveWarning,
  type StoredMessage,
  type WorkOrder,
  type WorkOrderAction,
} from './api/types.js';

const PLAYTHROUGH_KEY = 'foreman.playthroughId';
// Pre-#86 builds stored the working id under this key; read it once as a
// fallback so an existing browser keeps its playthrough after the rename.
const LEGACY_SESSION_KEY = 'foreman.sessionId';
// The user's own LLM provider key is deliberately persisted in localStorage so
// they need not re-enter it every browser session. This is an accepted trade-off
// (it trips CodeQL's clear-text-storage rule): the key is the user's own, lives
// only in their browser, is sent solely as the request header they authorised,
// and is never stored server-side. Do not "fix" this by dropping persistence —
// that regresses the UX; see the dismissed code-scanning alert for the rationale.
const API_KEY = 'foreman.apiKey';
const PROVIDER_KEY = 'foreman.provider';
const MODEL_KEY = 'foreman.model';
const BASE_URL_KEY = 'foreman.baseUrl';
// Conversation history window (message count). Like the other LLM settings it is
// client-held and sent per request; it is BYOK-only (the server applies it only
// when a client key is supplied). 0 / empty = use the server default.
const HISTORY_WINDOW_KEY = 'foreman.historyWindow';

/** Default name for the foreman minted during onboarding (renamed later via Settings). */
const DEFAULT_FOREMAN_NAME = 'Foreman';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools: string[];
  error?: string;
  streaming: boolean;
}

/** LLM settings the user can configure (empty = use the server default). */
export interface LlmSettings {
  apiKey: string;
  provider: string;
  model: string;
  baseUrl: string;
  /** Conversation history window (message count); 0 = use the server default. BYOK-only. */
  historyWindow: number;
}

/** Whether the auth check is still running, finished signed-out, or signed-in. */
export type AuthStatus = 'loading' | 'anon' | 'authed';

/** Fields for creating a new playthrough from the new-playthrough modal. */
export interface NewPlaythroughInput {
  foremanId: string;
  name?: string;
  pioneerProfile?: string;
  saveFile?: File;
}

export interface ForemanState {
  authStatus: AuthStatus;
  user: AuthUser | null;
  /** Resolves `{ twoFactorRequired }`; when true, call {@link verifyTwoFactor}. */
  signIn(email: string, password: string): Promise<{ twoFactorRequired: boolean }>;
  signUp(name: string, email: string, password: string): Promise<void>;
  verifyTwoFactor(code: string, trustDevice: boolean): Promise<void>;
  verifyBackupCode(code: string, trustDevice: boolean): Promise<void>;
  /** Re-reads the current user (e.g. after enabling/disabling MFA). */
  refreshUser(): Promise<void>;
  signOut(): Promise<void>;
  /** The active playthrough and its attached foreman. */
  playthrough: Playthrough | null;
  foreman: Foreman | null;
  /** All of the user's playthroughs / foremen (for the switcher + library). */
  playthroughs: Playthrough[];
  foremen: Foreman[];
  messages: ChatMsg[];
  /** The order the work-order panel should display (active, else latest). */
  currentOrder: WorkOrder | null;
  /** The order to actually render: a history selection if any, else currentOrder. */
  displayedOrder: WorkOrder | null;
  /** The order being viewed from history, or null when on the live active order. */
  viewingId: string | null;
  /** View a past order from history (read-only); null returns to the active order. */
  viewOrder(id: string | null): void;
  history: WorkOrder[];
  workOrders: WorkOrderActions;
  /** Advisories from the most recent save upload (e.g. build-version mismatch). */
  saveWarnings: SaveWarning[];
  /** Dismiss the save advisories. */
  dismissSaveWarnings(): void;
  /** The active playthrough's save version history (loaded on demand). */
  saveHistory: Save[];
  /** (Re)load the active playthrough's save history. */
  loadSaveHistory(): Promise<void>;
  /** Re-activate an older save version as current. */
  activateSaveVersion(saveId: string): Promise<void>;
  /** Delete a save version. */
  deleteSaveVersion(saveId: string): Promise<void>;
  /** Same-game preview for a candidate upload (identity + matching playthroughs). */
  previewSaveFile(file: File): Promise<SavePreviewResult>;
  /** Append an uploaded save to an existing matched playthrough and open it. */
  addSaveToExisting(playthroughId: string, file: File): Promise<void>;
  sending: boolean;
  booting: boolean;
  needsOnboarding: boolean;
  bootError: string | null;
  llm: LlmSettings;
  keyNeeded: boolean;
  send(text: string): void;
  completeOnboarding(input: { personality: string; pioneerProfile: string }): Promise<void>;
  /** Persist the browser-held LLM settings (account settings; localStorage only). */
  saveLlm(llm: LlmSettings): void;
  /** Save the active playthrough's settings: name, pioneer profile and attached foreman. */
  savePlaythroughSettings(input: {
    name: string;
    pioneerProfile: string;
    foremanId: string;
  }): Promise<void>;
  // Playthrough management (switcher + new-playthrough modal).
  switchPlaythrough(id: string): Promise<void>;
  newPlaythrough(input: NewPlaythroughInput): Promise<void>;
  /** Upload (replace) the active playthrough's save, then refresh it. */
  uploadCurrentSave(file: File): Promise<void>;
  removePlaythrough(id: string): Promise<void>;
  // Foreman library (account settings).
  addForeman(input: { name: string; personality?: string }): Promise<Foreman>;
  editForeman(id: string, patch: { name?: string; personality?: string }): Promise<void>;
  removeForeman(id: string): Promise<void>;
}

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore storage failures */
  }
}

/** The working playthrough id, falling back to the pre-#86 storage key. */
function readPlaythroughId(): string {
  return readStorage(PLAYTHROUGH_KEY) || readStorage(LEGACY_SESSION_KEY);
}

/** A stored message hydrated into the chat view (no live streaming state). */
function toChatMsg(message: StoredMessage): ChatMsg {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    tools: [],
    streaming: false,
  };
}

/**
 * A playthrough is un-onboarded until its foreman carries a personality or it
 * carries a pioneer profile. A playthrough with no resolvable foreman is treated
 * as un-onboarded so the flow re-mints one.
 */
function isUnonboarded(playthrough: Playthrough, foreman: Foreman | null): boolean {
  const persona = foreman?.personality.trim() ?? '';
  return persona.length === 0 && playthrough.pioneerProfile.trim().length === 0;
}

function isTerminal(order: WorkOrder): boolean {
  return TERMINAL_STATES.includes(order.state);
}

/**
 * The order the panel should show. A newly-issued order is `new` (not `active`),
 * so we can't rely on the /active endpoint alone: prefer the active order, then
 * the latest non-terminal one, then simply the latest (so a just-completed order
 * stays on screen in its terminal state).
 */
function pickCurrent(history: WorkOrder[]): WorkOrder | null {
  if (history.length === 0) {
    return null;
  }
  const bySeqDesc = [...history].sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  return (
    bySeqDesc.find((o) => o.state === 'active') ??
    bySeqDesc.find((o) => !isTerminal(o)) ??
    bySeqDesc[0] ??
    null
  );
}

/** Pioneer-driven work-order mutations. Each swaps the updated order into state. */
export interface WorkOrderActions {
  transition(id: string, action: WorkOrderAction, options?: TransitionOptions): Promise<void>;
  setStep(id: string, stepId: string, checked: boolean): Promise<void>;
  setBuildable(id: string, stepId: string, buildableId: string, builtCount: number): Promise<void>;
  setWaypointCollectible(
    id: string,
    waypointId: string,
    collectibleId: string,
    collected: boolean,
  ): Promise<void>;
  acknowledge(id: string, revisionNumber?: number): Promise<void>;
  revert(id: string, revisionNumber: number): Promise<void>;
  logHours(id: string, hours: number): Promise<void>;
}

/**
 * Fold a re-upload's collectible-sync summary into the save-advisory banner as a
 * `collectibles_synced` entry (#209-B), so a positive "Save synced" note rides the
 * same dismissible mechanism as build/playtime warnings.
 */
function withSyncBanner(result: SaveUploadResult): SaveWarning[] {
  const sync = result.collectibleSync;
  if (sync === undefined || sync.synced === 0) {
    return result.warnings;
  }
  const orders = sync.orders.map((o) => o.label).join(', ');
  const noun = sync.synced === 1 ? 'collectible' : 'collectibles';
  return [
    ...result.warnings,
    {
      kind: 'collectibles_synced',
      message: `Save synced: ${sync.synced} ${noun} marked collected${orders !== '' ? ` (${orders})` : ''}.`,
    },
  ];
}

export function useForeman(): ForemanState {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [playthrough, setPlaythrough] = useState<Playthrough | null>(null);
  const [foreman, setForeman] = useState<Foreman | null>(null);
  const [playthroughs, setPlaythroughs] = useState<Playthrough[]>([]);
  const [foremen, setForemen] = useState<Foreman[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [history, setHistory] = useState<WorkOrder[]>([]);
  const currentOrder = useMemo(() => pickCurrent(history), [history]);
  // A history order the pioneer is browsing (read-only). Resolves against the
  // live `history`, so SSE/mutation updates flow through; falls back to the
  // active order if the viewed order is gone (e.g. after a playthrough switch).
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Advisories from the most recent save upload (e.g. build-version mismatch),
  // surfaced as a dismissible banner. Cleared on dismiss and playthrough switch.
  const [saveWarnings, setSaveWarnings] = useState<SaveWarning[]>([]);
  // The active playthrough's save version history (loaded on demand by the drawer).
  const [saveHistory, setSaveHistory] = useState<Save[]>([]);
  const displayedOrder = useMemo(() => {
    if (viewingId !== null) {
      const viewed = history.find((o) => o.id === viewingId);
      if (viewed !== undefined) {
        return viewed;
      }
    }
    return currentOrder;
  }, [viewingId, history, currentOrder]);
  const viewOrder = useCallback((id: string | null) => setViewingId(id), []);
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [llm, setLlm] = useState<LlmSettings>(() => ({
    apiKey: readStorage(API_KEY),
    provider: readStorage(PROVIDER_KEY),
    model: readStorage(MODEL_KEY),
    baseUrl: readStorage(BASE_URL_KEY),
    historyWindow: Number.parseInt(readStorage(HISTORY_WINDOW_KEY), 10) || 0,
  }));
  const [keyNeeded, setKeyNeeded] = useState(false);
  const booted = useRef(false);

  const loadOrders = useCallback(async (playthroughId: string) => {
    setHistory(await listWorkOrders(playthroughId));
  }, []);

  /** Swap a mutated order into history in place (no full refetch / flicker). */
  const replaceOrder = useCallback((updated: WorkOrder) => {
    setHistory((prev) => {
      const idx = prev.findIndex((o) => o.id === updated.id);
      if (idx === -1) {
        return [...prev, updated];
      }
      const next = prev.slice();
      next[idx] = updated;
      return next;
    });
  }, []);

  /**
   * Makes a playthrough the active one: persists it locally, resolves its
   * foreman, and (when onboarded) hydrates its chat history and work orders.
   */
  const activate = useCallback(async (target: Playthrough, knownForemen: Foreman[]) => {
    setViewingId(null);
    setSaveWarnings([]);
    setSaveHistory([]);
    writeStorage(PLAYTHROUGH_KEY, target.id);
    const attached =
      knownForemen.find((f) => f.id === target.foremanId) ?? (await getForeman(target.foremanId));
    setPlaythrough(target);
    setForeman(attached);
    if (isUnonboarded(target, attached)) {
      setMessages([]);
      setHistory([]);
      setNeedsOnboarding(true);
      return;
    }
    setNeedsOnboarding(false);
    const [msgs, orders] = await Promise.all([listMessages(target.id), listWorkOrders(target.id)]);
    setMessages(msgs.map(toChatMsg));
    setHistory(orders);
  }, []);

  /**
   * Loads the signed-in user's workspace: their foremen + playthroughs, then the
   * active playthrough — the locally-remembered one (claimed if it predates
   * accounts), else the most recently updated, else onboarding when there are
   * none.
   */
  const loadWorkspace = useCallback(async () => {
    const [allForemen, listed] = await Promise.all([listForemen(), listPlaythroughs()]);
    setForemen(allForemen);
    let all = listed;

    const storedId = readPlaythroughId();
    let active: Playthrough | null = storedId ? (all.find((p) => p.id === storedId) ?? null) : null;
    if (active === null && storedId.length > 0) {
      // A locally-held id not in the list may be a pre-accounts anonymous
      // playthrough; claim it for this user, and fold it into the list.
      active = await claimPlaythrough(storedId);
      if (active !== null && !all.some((p) => p.id === active!.id)) {
        all = [active, ...all];
      }
    }
    if (active === null) {
      active = all[0] ?? null;
    }
    setPlaythroughs(all);

    if (active === null) {
      writeStorage(PLAYTHROUGH_KEY, '');
      setPlaythrough(null);
      setForeman(null);
      setMessages([]);
      setHistory([]);
      setNeedsOnboarding(true);
      return;
    }
    await activate(active, allForemen);
  }, [activate]);

  useEffect(() => {
    if (booted.current) {
      return;
    }
    booted.current = true;
    void (async () => {
      try {
        const current = await fetchCurrentUser();
        if (current === null) {
          setAuthStatus('anon');
          return;
        }
        setUser(current);
        setAuthStatus('authed');
        await loadWorkspace();
      } catch (error) {
        setBootError(error instanceof Error ? error.message : 'Failed to start a playthrough.');
      } finally {
        setBooting(false);
      }
    })();
  }, [loadWorkspace]);

  /** Runs the post-authentication workspace load, surfacing boot errors. */
  const enterApp = useCallback(
    async (current: AuthUser) => {
      setUser(current);
      setAuthStatus('authed');
      setBootError(null);
      setBooting(true);
      try {
        await loadWorkspace();
      } catch (error) {
        setBootError(error instanceof Error ? error.message : 'Failed to start a playthrough.');
      } finally {
        setBooting(false);
      }
    },
    [loadWorkspace],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await apiSignIn(email, password);
      if (result.kind === 'twoFactor') {
        // MFA enabled: hold here until the second factor is verified.
        return { twoFactorRequired: true };
      }
      await enterApp(result.user);
      return { twoFactorRequired: false };
    },
    [enterApp],
  );

  const verifyTwoFactor = useCallback(
    async (code: string, trustDevice: boolean) => {
      await enterApp(await apiVerifyTotp(code, trustDevice));
    },
    [enterApp],
  );

  const verifyBackupCode = useCallback(
    async (code: string, trustDevice: boolean) => {
      await enterApp(await apiVerifyBackupCode(code, trustDevice));
    },
    [enterApp],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      await enterApp(await apiSignUp(name, email, password));
    },
    [enterApp],
  );

  const refreshUser = useCallback(async () => {
    setUser(await fetchCurrentUser());
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    setUser(null);
    setAuthStatus('anon');
    setPlaythrough(null);
    setForeman(null);
    setPlaythroughs([]);
    setForemen([]);
    setMessages([]);
    setHistory([]);
    setNeedsOnboarding(false);
    setBootError(null);
    // The local playthrough id is kept so the next sign-in reclaims it.
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMsg>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || sending || playthrough === null) {
        return;
      }
      const playthroughId = playthrough.id;
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: trimmed, tools: [], streaming: false },
        { id: assistantId, role: 'assistant', content: '', tools: [], streaming: true },
      ]);
      setSending(true);
      setKeyNeeded(false);

      const override: ClientLlmConfig = {
        provider:
          llm.provider === 'anthropic' || llm.provider === 'openai' ? llm.provider : undefined,
        model: llm.model || undefined,
        baseUrl: llm.baseUrl || undefined,
        historyWindow: llm.historyWindow > 0 ? llm.historyWindow : undefined,
      };

      void streamChat(playthroughId, trimmed, llm.apiKey || undefined, override, {
        onText: (delta) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
          ),
        onToolUse: (name) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, tools: [...m.tools, name] } : m)),
          ),
        onWorkOrder: (order) => {
          // The foreman created/revised an order; reflect it immediately and
          // refetch the list so a freshly-issued order joins the history.
          replaceOrder(order);
          void loadOrders(playthroughId);
        },
        onError: (message) => {
          patchMessage(assistantId, { error: message });
          if (/api key/i.test(message)) {
            setKeyNeeded(true);
          }
        },
      })
        .catch((error: unknown) =>
          patchMessage(assistantId, {
            error: error instanceof Error ? error.message : 'Stream failed.',
          }),
        )
        .finally(() => {
          patchMessage(assistantId, { streaming: false });
          setSending(false);
        });
    },
    [llm, loadOrders, patchMessage, replaceOrder, sending, playthrough],
  );

  const workOrders = useMemo<WorkOrderActions>(() => {
    const pid = (): string => {
      if (playthrough === null) {
        throw new Error('No active playthrough.');
      }
      return playthrough.id;
    };
    return {
      transition: async (id, action, options) => {
        replaceOrder(await transitionWorkOrder(pid(), id, action, options));
      },
      setStep: async (id, stepId, checked) => {
        replaceOrder(await setStepChecked(pid(), id, stepId, checked));
      },
      setBuildable: async (id, stepId, buildableId, builtCount) => {
        replaceOrder(await setBuildableBuiltCount(pid(), id, stepId, buildableId, builtCount));
      },
      setWaypointCollectible: async (id, waypointId, collectibleId, collected) => {
        replaceOrder(await setWaypointCollected(pid(), id, waypointId, collectibleId, collected));
      },
      acknowledge: async (id, revisionNumber) => {
        replaceOrder(await acknowledgeRevision(pid(), id, revisionNumber));
      },
      revert: async (id, revisionNumber) => {
        replaceOrder(await revertToRevision(pid(), id, revisionNumber));
      },
      logHours: async (id, hours) => {
        replaceOrder(await logHours(pid(), id, hours));
      },
    };
  }, [replaceOrder, playthrough]);

  /** Upserts a playthrough into the list (keeping most-recent-first order). */
  const upsertPlaythrough = useCallback((updated: Playthrough) => {
    setPlaythroughs((prev) => {
      const without = prev.filter((p) => p.id !== updated.id);
      return [updated, ...without];
    });
  }, []);

  const completeOnboarding = useCallback(
    async (input: { personality: string; pioneerProfile: string }) => {
      // Reuse an existing playthrough + foreman (e.g. one left behind by an
      // abandoned first run) rather than orphaning them; otherwise mint a fresh
      // foreman and playthrough. Persona lives on the foreman, profile on the
      // playthrough.
      setViewingId(null);
      let nextForeman: Foreman;
      let nextPlaythrough: Playthrough;
      if (playthrough !== null && foreman !== null) {
        nextForeman = await patchForeman(foreman.id, { personality: input.personality });
        nextPlaythrough = await patchPlaythrough(playthrough.id, {
          pioneerProfile: input.pioneerProfile,
        });
      } else {
        nextForeman = await createForeman({
          name: DEFAULT_FOREMAN_NAME,
          personality: input.personality,
        });
        nextPlaythrough = await createPlaythrough({
          foremanId: nextForeman.id,
          pioneerProfile: input.pioneerProfile,
        });
      }
      writeStorage(PLAYTHROUGH_KEY, nextPlaythrough.id);
      setForemen(await listForemen());
      upsertPlaythrough(nextPlaythrough);
      setForeman(nextForeman);
      setPlaythrough(nextPlaythrough);
      setNeedsOnboarding(false);
      setMessages([]);
      await loadOrders(nextPlaythrough.id);
    },
    [loadOrders, playthrough, foreman, upsertPlaythrough],
  );

  const saveLlm = useCallback((next: LlmSettings) => {
    // The user's own provider key, held only in their browser so they need not
    // re-enter it each visit. It is sent solely as the request header they
    // authorised and never persisted server-side.
    writeStorage(API_KEY, next.apiKey);
    writeStorage(PROVIDER_KEY, next.provider);
    writeStorage(MODEL_KEY, next.model);
    writeStorage(BASE_URL_KEY, next.baseUrl);
    writeStorage(HISTORY_WINDOW_KEY, next.historyWindow > 0 ? String(next.historyWindow) : '');
    setLlm(next);
  }, []);

  const savePlaythroughSettings = useCallback(
    async (input: { name: string; pioneerProfile: string; foremanId: string }) => {
      if (playthrough === null) {
        return;
      }
      const updated = await patchPlaythrough(playthrough.id, input);
      setPlaythrough(updated);
      upsertPlaythrough(updated);
      if (input.foremanId !== playthrough.foremanId) {
        setForeman(
          foremen.find((f) => f.id === input.foremanId) ?? (await getForeman(input.foremanId)),
        );
      }
    },
    [foremen, playthrough, upsertPlaythrough],
  );

  const switchPlaythrough = useCallback(
    async (id: string) => {
      if (playthrough?.id === id) {
        return;
      }
      const target = playthroughs.find((p) => p.id === id) ?? (await getPlaythrough(id));
      if (target === null || target === undefined) {
        return;
      }
      await activate(target, foremen);
    },
    [activate, foremen, playthroughs, playthrough],
  );

  const newPlaythrough = useCallback(
    async (input: NewPlaythroughInput) => {
      const created = await createPlaythrough({
        foremanId: input.foremanId,
        name: input.name,
        pioneerProfile: input.pioneerProfile,
      });
      if (input.saveFile !== undefined) {
        setSaveWarnings(withSyncBanner(await uploadSave(created.id, input.saveFile)));
      }
      // Re-fetch so a save-derived default name + save metadata are reflected.
      const fresh = (await getPlaythrough(created.id)) ?? created;
      upsertPlaythrough(fresh);
      await activate(fresh, foremen);
    },
    [activate, foremen, upsertPlaythrough],
  );

  const uploadCurrentSave = useCallback(
    async (file: File) => {
      if (playthrough === null) {
        return;
      }
      setSaveWarnings(withSyncBanner(await uploadSave(playthrough.id, file)));
      // Re-fetch so the refreshed save metadata is reflected in state + the list.
      const fresh = (await getPlaythrough(playthrough.id)) ?? playthrough;
      setPlaythrough(fresh);
      upsertPlaythrough(fresh);
    },
    [playthrough, upsertPlaythrough],
  );

  /** Same-game preview for an upload: its identity + matching playthroughs. */
  const previewSaveFile = useCallback(
    (file: File): Promise<SavePreviewResult> => previewSave(file),
    [],
  );

  /** Append an uploaded save to an existing (matched) playthrough and open it. */
  const addSaveToExisting = useCallback(
    async (playthroughId: string, file: File) => {
      // Switch first: activating a playthrough resets save warnings, so set them
      // after, against the now-current playthrough.
      await switchPlaythrough(playthroughId);
      setSaveWarnings(withSyncBanner(await uploadSave(playthroughId, file)));
      const fresh = await getPlaythrough(playthroughId);
      if (fresh !== null) {
        setPlaythrough(fresh);
        upsertPlaythrough(fresh);
      }
    },
    [switchPlaythrough, upsertPlaythrough],
  );

  /** Load the active playthrough's save version history (for the drawer). */
  const loadSaveHistory = useCallback(async () => {
    if (playthrough === null) {
      setSaveHistory([]);
      return;
    }
    setSaveHistory(await listSaves(playthrough.id));
  }, [playthrough]);

  const refreshAfterSaveChange = useCallback(async () => {
    if (playthrough === null) {
      return;
    }
    const fresh = (await getPlaythrough(playthrough.id)) ?? playthrough;
    setPlaythrough(fresh);
    upsertPlaythrough(fresh);
    setSaveHistory(await listSaves(playthrough.id));
  }, [playthrough, upsertPlaythrough]);

  const activateSaveVersion = useCallback(
    async (saveId: string) => {
      if (playthrough === null) {
        return;
      }
      await activateSave(playthrough.id, saveId);
      await refreshAfterSaveChange();
    },
    [playthrough, refreshAfterSaveChange],
  );

  const deleteSaveVersion = useCallback(
    async (saveId: string) => {
      if (playthrough === null) {
        return;
      }
      await deleteSave(playthrough.id, saveId);
      await refreshAfterSaveChange();
    },
    [playthrough, refreshAfterSaveChange],
  );

  const removePlaythrough = useCallback(
    async (id: string) => {
      await deletePlaythrough(id);
      const remaining = playthroughs.filter((p) => p.id !== id);
      setPlaythroughs(remaining);
      if (playthrough?.id === id) {
        const next = remaining[0] ?? null;
        if (next === null) {
          writeStorage(PLAYTHROUGH_KEY, '');
          setPlaythrough(null);
          setForeman(null);
          setMessages([]);
          setHistory([]);
          setNeedsOnboarding(true);
        } else {
          await activate(next, foremen);
        }
      }
    },
    [activate, foremen, playthrough, playthroughs],
  );

  const addForeman = useCallback(async (input: { name: string; personality?: string }) => {
    const created = await createForeman(input);
    setForemen(await listForemen());
    return created;
  }, []);

  const editForeman = useCallback(
    async (id: string, patch: { name?: string; personality?: string }) => {
      const updated = await patchForeman(id, patch);
      setForemen((prev) => prev.map((f) => (f.id === id ? updated : f)));
      if (foreman?.id === id) {
        setForeman(updated);
      }
    },
    [foreman],
  );

  const removeForeman = useCallback(async (id: string) => {
    await deleteForeman(id);
    setForemen((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return {
    authStatus,
    user,
    signIn,
    signUp,
    verifyTwoFactor,
    verifyBackupCode,
    refreshUser,
    signOut,
    playthrough,
    foreman,
    playthroughs,
    foremen,
    messages,
    currentOrder,
    displayedOrder,
    viewingId,
    viewOrder,
    history,
    workOrders,
    saveWarnings,
    dismissSaveWarnings: () => setSaveWarnings([]),
    saveHistory,
    loadSaveHistory,
    activateSaveVersion,
    deleteSaveVersion,
    previewSaveFile,
    addSaveToExisting,
    sending,
    booting,
    needsOnboarding,
    bootError,
    llm,
    keyNeeded,
    send,
    completeOnboarding,
    saveLlm,
    savePlaythroughSettings,
    switchPlaythrough,
    newPlaythrough,
    uploadCurrentSave,
    removePlaythrough,
    addForeman,
    editForeman,
    removeForeman,
  };
}
