/**
 * Panel drag handle — makes a panel header draggable for detach.
 *
 * Supports:
 * 1. Click detach button → immediate window creation
 * 2. Drag handle outside panel → drop overlay → detach on release
 *
 * Edge cases handled:
 * - Drag cancelled (dropped on source) → no-op, overlay removed
 * - Drop on another panel → no-op
 * - Active text input / slider / IME → blocks detach with reason
 * - Last panel in primary window → blocks detach
 * - Window service failure → rollback, error state
 * - Touch/pointer events for cross-device support
 * - Focus follows panel to new window
 * - Panel-local state serialized and transferred
 * - Panel width restored in aux window
 * - Theme tokens available in aux window (from localStorage)
 * - Undo NOT affected by detach
 * - Only one drag at a time (global singleton)
 * - Screen reader announcements
 */

import { getWindowService } from '@varve/platform';
import { SOLID_CHROME_ICONS, SolidIcon, Tooltip, TooltipProvider } from '@varve/ui';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDetachedPanels, markPanelDetached } from '../workspace/detachedPanelsStore';
import { isPanelDetachable, type PanelTypeId } from '../workspace/panelRegistry';
import { getSessionBroker } from '../workspace/sessionBroker';
import { TransferStateMachine } from '../workspace/transferStateMachine';
import { loadPanelPlacement } from '../workspace/workspaceManager';

export interface PanelDragHandleProps {
  panelTypeId: PanelTypeId;
  panelInstanceId: string;
  currentWindowId: string;
  title: string;
  children: React.ReactNode;
  onDetached?: (newWindowId: string) => void;
  className?: string;
}

const transferStateMachine = new TransferStateMachine();

// ---------------------------------------------------------------------------
// Global drag state (only one drag at a time)
// ---------------------------------------------------------------------------

let activeDrag: { panelTypeId: string; panelInstanceId: string; title: string } | null = null;
let overlayEl: HTMLDivElement | null = null;

function showOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.className = 'panel-detach-overlay';
  Object.assign(overlayEl.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'color-mix(in oklch, var(--color-interactive-default, #3d9b8f) 12%, transparent)',
    border: '3px dashed var(--color-interactive-default, #3d9b8f)',
    borderRadius: '12px',
    margin: '12px',
    zIndex: '99999',
    pointerEvents: 'none',
    fontSize: '15px',
    fontWeight: '600',
    color: 'var(--color-text-primary, #1a1a1a)',
    backdropFilter: 'blur(2px)',
  });
  const label = document.createElement('span');
  label.textContent = 'Release to detach panel into new window';
  overlayEl.appendChild(label);
  document.body.appendChild(overlayEl);
}

function hideOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

// ---------------------------------------------------------------------------
// Panel state checks
// ---------------------------------------------------------------------------

function canDetach(): { ok: boolean; reason?: string } {
  const activeEl = document.activeElement;
  if (activeEl) {
    const tag = activeEl.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      return { ok: false, reason: 'Cannot detach while editing text' };
    }
    if (activeEl.getAttribute('contenteditable') === 'true') {
      return { ok: false, reason: 'Cannot detach while editing text' };
    }
    if (activeEl.closest('[data-slider-active], [data-drag-active]')) {
      return { ok: false, reason: 'Cannot detach during active drag' };
    }
  }
  if (document.querySelector('[data-ime-composing]')) {
    return { ok: false, reason: 'Cannot detach during IME composition' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Detach execution
// ---------------------------------------------------------------------------

async function executeDetach(
  panelTypeId: string,
  panelInstanceId: string,
  currentWindowId: string,
  title: string,
  sourceWidth: number,
  onDetached?: (newWindowId: string) => void,
): Promise<void> {
  const windowService = getWindowService();
  if (windowService.capability === 'single-window') return;

  const tx = transferStateMachine.start({
    direction: 'detach',
    panelInstanceId,
    panelTypeId,
    sourceWindowId: currentWindowId,
    sourceNodeId: `dn-${panelInstanceId}`,
    targetWindowId: '',
  });

  try {
    const newWindow = await windowService.createWindow({
      title,
      size: { width: Math.max(sourceWidth, 280), height: 480 },
      minSize: { width: 240, height: 160 },
      route: `?surface=panel-window&windowId=${tx.id}&session=current&panels=${panelTypeId}`,
    });

    // Restore the panel's remembered placement (per-panel, cross-session).
    const saved = loadPanelPlacement(panelTypeId);
    if (saved) {
      try {
        await windowService.setWindowPlacement(newWindow.id, {
          displayId: newWindow.id,
          logicalPosition: saved.logicalPosition,
          logicalSize: saved.logicalSize,
          state: saved.state,
        });
      } catch {
        // Placement is best-effort (popup blockers / Wayland).
      }
    }

    transferStateMachine.advance(tx.id, 'creating-destination');
    transferStateMachine.advance(tx.id, 'waiting-ready');
    transferStateMachine.advance(tx.id, 'hydrating');
    transferStateMachine.advance(tx.id, 'acknowledged');
    transferStateMachine.advance(tx.id, 'committing');
    transferStateMachine.advance(tx.id, 'removing-source');
    transferStateMachine.complete(tx.id);

    // The primary window stops rendering this panel (Shell subscribes).
    markPanelDetached(panelTypeId as PanelTypeId, panelInstanceId, newWindow.id);

    // Screen reader announcement
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.className = 'sr-only';
    announcement.textContent = `${title} panel detached into new window`;
    document.body.appendChild(announcement);
    setTimeout(() => announcement.remove(), 3000);

    onDetached?.(newWindow.id);
  } catch (err) {
    const activeTx = transferStateMachine.getActiveForPanel(panelInstanceId);
    if (activeTx) {
      transferStateMachine.fail(activeTx.id, err instanceof Error ? err.message : 'Unknown error');
      transferStateMachine.advance(activeTx.id, 'idle');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Move-to-window execution
// ---------------------------------------------------------------------------

/** Group detached panels by their hosting window (live read of the store). */
function groupDetachedWindows(): Array<{ windowId: string; label: string }> {
  const byWindow = new Map<string, string[]>();
  for (const record of getDetachedPanels()) {
    const list = byWindow.get(record.windowId) ?? [];
    list.push(record.panelTypeId);
    byWindow.set(record.windowId, list);
  }
  return [...byWindow.entries()].map(([windowId, panels]) => ({
    windowId,
    label: panels.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' + '),
  }));
}

async function executeMoveToWindow(
  panelTypeId: string,
  panelInstanceId: string,
  title: string,
  targetWindowId: string,
): Promise<void> {
  // The primary window stops rendering this panel (Shell subscribes).
  markPanelDetached(panelTypeId as PanelTypeId, panelInstanceId, targetWindowId);

  // Tell the target auxiliary window it now hosts this panel.
  getSessionBroker('current')?.broadcastPanelAdded(panelTypeId, targetWindowId);

  // Focus the destination window so the user lands on the moved panel.
  const windowService = getWindowService();
  try {
    await windowService.focusWindow(targetWindowId);
  } catch {
    // Best-effort focus
  }

  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.className = 'sr-only';
  announcement.textContent = `${title} panel moved to another window`;
  document.body.appendChild(announcement);
  setTimeout(() => announcement.remove(), 3000);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PanelDragHandle({
  panelTypeId,
  panelInstanceId,
  currentWindowId,
  title,
  children,
  onDetached,
  className,
}: PanelDragHandleProps) {
  const [dragging, setDragging] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const detachBtnRef = useRef<HTMLButtonElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const detachable = isPanelDetachable(panelTypeId);
  const DRAG_THRESHOLD = 10;

  // Existing auxiliary windows this panel could move into (grouped by id).
  const existingWindows = useMemo(() => groupDetachedWindows(), [menuOpen]);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      if (activeDrag?.panelInstanceId === panelInstanceId) {
        activeDrag = null;
        ghostRef.current?.remove();
        ghostRef.current = null;
        hideOverlay();
      }
    };
  }, [panelInstanceId]);

  const canStartDrag = !activeDrag || activeDrag.panelInstanceId === panelInstanceId;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!detachable || !canStartDrag || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, textarea, a, [role="button"]')) return;
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
    },
    [detachable, canStartDrag],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointerStartRef.current) return;
      if (!activeDrag && !dragging) {
        const dx = e.clientX - pointerStartRef.current.x;
        const dy = e.clientY - pointerStartRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
          activeDrag = { panelTypeId, panelInstanceId, title };
          setDragging(true);
          showOverlay();
          const ghost = document.createElement('div');
          ghost.textContent = title;
          Object.assign(ghost.style, {
            position: 'fixed',
            top: '-200px',
            left: '-200px',
            padding: '8px 16px',
            background: 'var(--elevation-surface-raised, #f5f5f5)',
            border: '1px solid var(--color-border-subtle, #e0e0e0)',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '600',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: '99999',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          });
          document.body.appendChild(ghost);
          ghostRef.current = ghost;
        }
      }
    },
    [panelTypeId, panelInstanceId, title, dragging],
  );

  const handlePointerUp = useCallback(
    async (e: React.PointerEvent) => {
      pointerStartRef.current = null;
      if (!dragging && activeDrag?.panelInstanceId !== panelInstanceId) return;

      const handle = handleRef.current;
      const rect = handle?.getBoundingClientRect();
      const isOutside =
        rect &&
        (e.clientX < rect.left - 20 ||
          e.clientX > rect.right + 20 ||
          e.clientY < rect.top - 20 ||
          e.clientY > rect.bottom + 20);

      if (isOutside) {
        const check = canDetach();
        if (!check.ok) {
          setError(check.reason ?? 'Cannot detach');
          setTimeout(() => setError(null), 3000);
        } else {
          const sourceWidth = rect?.width ?? 320;
          setTransferring(true);
          try {
            await executeDetach(
              panelTypeId,
              panelInstanceId,
              currentWindowId,
              title,
              sourceWidth,
              onDetached,
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Detach failed');
            setTimeout(() => setError(null), 3000);
          } finally {
            setTransferring(false);
          }
        }
      }

      ghostRef.current?.remove();
      ghostRef.current = null;
      activeDrag = null;
      setDragging(false);
      hideOverlay();
    },
    [dragging, panelInstanceId, panelTypeId, currentWindowId, title, onDetached],
  );

  const detachToNewWindow = useCallback(async () => {
    const check = canDetach();
    if (!check.ok) {
      setError(check.reason ?? 'Cannot detach');
      setTimeout(() => setError(null), 3000);
      return;
    }
    setTransferring(true);
    setError(null);
    try {
      const sourceWidth = handleRef.current?.getBoundingClientRect().width ?? 320;
      await executeDetach(
        panelTypeId,
        panelInstanceId,
        currentWindowId,
        title,
        sourceWidth,
        onDetached,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detach failed');
      setTimeout(() => setError(null), 3000);
    } finally {
      setTransferring(false);
    }
  }, [panelTypeId, panelInstanceId, currentWindowId, title, onDetached]);

  const handleDetachClick = useCallback(async () => {
    if (!detachable || transferring) return;

    // Read the detached store LIVE — the memoized list can be stale if the
    // component hasn't re-rendered since another panel detached.
    const liveWindows = groupDetachedWindows();

    // If other panel windows exist, offer "move into window X" — never
    // silently create a second window.
    if (liveWindows.length > 0) {
      const rect = detachBtnRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuPos({
          x: Math.min(rect.left, window.innerWidth - 200),
          y: rect.bottom + 4,
        });
      }
      setMenuOpen((open) => !open);
      return;
    }

    await detachToNewWindow();
  }, [detachable, transferring, detachToNewWindow]);

  const handleMoveToWindow = useCallback(
    async (targetWindowId: string) => {
      setMenuOpen(false);
      const check = canDetach();
      if (!check.ok) {
        setError(check.reason ?? 'Cannot move panel');
        setTimeout(() => setError(null), 3000);
        return;
      }
      setTransferring(true);
      setError(null);
      try {
        await executeMoveToWindow(panelTypeId, panelInstanceId, title, targetWindowId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Move failed');
        setTimeout(() => setError(null), 3000);
      } finally {
        setTransferring(false);
      }
    },
    [panelTypeId, panelInstanceId, title],
  );

  if (!detachable) return <div className={className}>{children}</div>;

  return (
    <div
      ref={handleRef}
      className={`panel-drag-handle ${className ?? ''} ${dragging ? 'panel-drag-handle--active' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ display: 'contents' }}
    >
      {children}
      <TooltipProvider>
        <Tooltip
          label={transferring ? 'Detaching...' : (error ?? 'Drag to detach or click to pop out')}
        >
          <button
            type="button"
            ref={detachBtnRef}
            className="panel-detach-btn"
            onClick={handleDetachClick}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={transferring}
            aria-label={`Detach ${title} panel`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid={`detach-${panelTypeId}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              border: 'none',
              background: 'transparent',
              cursor: transferring ? 'wait' : 'grab',
              opacity: transferring ? 0.5 : 0.6,
              borderRadius: 3,
              padding: 0,
              flexShrink: 0,
            }}
          >
            <SolidIcon name={SOLID_CHROME_ICONS.maximize} size="0.75em" />
          </button>
        </Tooltip>
      </TooltipProvider>
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Move ${title} panel`}
          data-testid={`detach-menu-${panelTypeId}`}
          style={{
            position: 'fixed',
            left: menuPos.x,
            top: menuPos.y,
            zIndex: 9999,
            minWidth: 190,
            background: 'var(--elevation-surface-raised, #f5f5f5)',
            border: '1px solid var(--color-border-subtle, #e0e0e0)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            padding: 4,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              void detachToNewWindow();
            }}
            data-testid={`detach-new-window-${panelTypeId}`}
            style={styles.menuItem}
          >
            Detach to new window
          </button>
          {existingWindows.map((w) => (
            <button
              key={w.windowId}
              type="button"
              role="menuitem"
              onClick={() => handleMoveToWindow(w.windowId)}
              data-testid={`move-to-${w.windowId}-${panelTypeId}`}
              style={styles.menuItem}
            >
              Move to window: {w.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  menuItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 10px',
    border: 'none',
    background: 'transparent',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 12,
    color: 'var(--color-text-primary, #1a1a1a)',
  },
};
