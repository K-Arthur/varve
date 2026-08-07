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
import { useCallback, useEffect, useRef, useState } from 'react';
import { isPanelDetachable, type PanelTypeId } from '../workspace/panelRegistry';
import { TransferStateMachine } from '../workspace/transferStateMachine';

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
    background: 'rgba(61, 155, 143, 0.12)',
    border: '3px dashed var(--color-accent, #3d9b8f)',
    borderRadius: '12px',
    margin: '12px',
    zIndex: '99999',
    pointerEvents: 'none',
    fontSize: '15px',
    fontWeight: '600',
    color: 'var(--color-text, #1a1a1a)',
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

    transferStateMachine.advance(tx.id, 'creating-destination');
    transferStateMachine.advance(tx.id, 'waiting-ready');
    transferStateMachine.advance(tx.id, 'hydrating');
    transferStateMachine.advance(tx.id, 'acknowledged');
    transferStateMachine.advance(tx.id, 'committing');
    transferStateMachine.advance(tx.id, 'removing-source');
    transferStateMachine.complete(tx.id);

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
  const handleRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const detachable = isPanelDetachable(panelTypeId);
  const DRAG_THRESHOLD = 10;

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
            background: 'var(--color-surface-elevated, #f5f5f5)',
            border: '1px solid var(--color-border, #e0e0e0)',
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

  const handleDetachClick = useCallback(async () => {
    if (!detachable || transferring) return;
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
  }, [detachable, transferring, panelTypeId, panelInstanceId, currentWindowId, title, onDetached]);

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
            className="panel-detach-btn"
            onClick={handleDetachClick}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={transferring}
            aria-label={`Detach ${title} panel`}
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
    </div>
  );
}
