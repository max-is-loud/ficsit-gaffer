// Generic right-edge drawer dock: a rail of tabs, one open drawer at a time, pin
// and auto-hide behaviour, and the open state persisted in localStorage. It knows
// nothing about drawer contents, which callers supply through DrawerDef.

import { useCallback, useEffect, useRef, useState } from 'react';

/** API handed to a drawer's render fn so its content can drive the dock. */
export interface DrawerApi {
  /** Collapse the dock back to the rail — unless it is pinned open. */
  requestClose: () => void;
  pinned: boolean;
}

export interface DrawerDef {
  id: string;
  /** Shown on the rail tab and the open panel's header. */
  label: string;
  render: (api: DrawerApi) => React.ReactNode;
}

interface DrawerDockProps {
  drawers: DrawerDef[];
}

const STORAGE_KEY = 'foreman.dock';

interface DockState {
  openId: string | null;
  pinned: boolean;
}

function readState(): DockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<DockState>;
      return { openId: parsed.openId ?? null, pinned: parsed.pinned ?? false };
    }
  } catch {
    /* ignore storage failures */
  }
  return { openId: null, pinned: false };
}

/**
 * A right-edge tool-window dock, in the spirit of Visual Studio's auto-hide
 * panels. A thin rail of vertical tabs is always visible; clicking a tab opens
 * its drawer. An open drawer can be **pinned** (docks in-flow, so the work-order
 * panel shrinks to fit) or left unpinned (floats over the panel and collapses
 * when you click outside or press Escape). Built to host more drawers later —
 * just pass additional entries in `drawers`.
 */
export function DrawerDock({ drawers }: DrawerDockProps): React.JSX.Element {
  const initial = readState();
  // Only restore an open drawer that still exists.
  const [openId, setOpenId] = useState<string | null>(
    initial.openId !== null && drawers.some((d) => d.id === initial.openId) ? initial.openId : null,
  );
  const [pinned, setPinned] = useState(initial.pinned);
  const dockRef = useRef<HTMLElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ openId, pinned } satisfies DockState));
    } catch {
      /* ignore storage failures */
    }
  }, [openId, pinned]);

  const collapse = useCallback(() => setOpenId(null), []);
  const requestClose = useCallback(() => {
    if (!pinned) {
      setOpenId(null);
    }
  }, [pinned]);

  // Auto-hide: an unpinned, open drawer collapses on an outside click or Escape.
  useEffect(() => {
    if (openId === null || pinned) {
      return;
    }
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      const insideDock = dockRef.current?.contains(target) ?? false;
      const insideFloat = floatRef.current?.contains(target) ?? false;
      if (!insideDock && !insideFloat) {
        collapse();
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        collapse();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openId, pinned, collapse]);

  const open = openId !== null ? (drawers.find((d) => d.id === openId) ?? null) : null;

  const panel =
    open !== null ? (
      <div className="dock-panel" role="dialog" aria-label={open.label}>
        <div className="dock-panel-head">
          <span className="label">{open.label}</span>
          <span className="spacer" />
          <button
            type="button"
            className={`dock-pin${pinned ? ' active' : ''}`}
            aria-pressed={pinned}
            title={pinned ? 'Unpin (auto-hide)' : 'Pin open'}
            onClick={() => setPinned((p) => !p)}
          >
            📌
          </button>
          <button type="button" className="dock-collapse" title="Collapse" onClick={collapse}>
            ⟩
          </button>
        </div>
        <div className="dock-panel-body">{open.render({ requestClose, pinned })}</div>
      </div>
    ) : null;

  return (
    <>
      {/* The dock column: the always-visible rail, plus the panel in-flow when
          pinned (so the work-order panel reflows to fit). */}
      <aside ref={dockRef} className="dock">
        {open !== null && pinned ? panel : null}
        <div className="dock-rail">
          {drawers.map((d) => (
            <button
              type="button"
              key={d.id}
              className={`dock-tab${d.id === openId ? ' active' : ''}`}
              aria-expanded={d.id === openId}
              onClick={() => setOpenId((cur) => (cur === d.id ? null : d.id))}
            >
              {d.label}
            </button>
          ))}
        </div>
      </aside>

      {/* Unpinned + open: float over the work-order panel (no reflow), pushed to
          the right edge by the flex layer and clearing the rail. */}
      {open !== null && !pinned ? (
        <div className="dock-float" ref={floatRef}>
          {panel}
        </div>
      ) : null}
    </>
  );
}
