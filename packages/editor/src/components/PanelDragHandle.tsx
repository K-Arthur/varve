/**
 * Accessible primary-host affordance for transactional panel detachment.
 *
 * The button and optional drag gesture intentionally share `detachPanel`.
 * This component never changes host ownership itself: the coordinator waits
 * for the auxiliary React host to restore and acknowledge before the primary
 * store hides the source panel.
 */

import { getWindowService } from '@varve/platform';
import {
  ContextMenu,
  elementAnchor,
  type MenuEntry,
  type OverlayAnchor,
  pointAnchor,
  SOLID_CHROME_ICONS,
  SolidIcon,
  Tooltip,
  TooltipProvider,
  viewportPoint,
} from '@varve/ui';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePanelHost } from '../workspace/PanelHostContext';
import { isPanelDetachable, type PanelTypeId } from '../workspace/panelRegistry';
import { detachPanel } from '../workspace/panelTransferCoordinator';

export interface PanelDragHandleProps {
  panelTypeId: PanelTypeId;
  panelInstanceId: string;
  currentWindowId: string;
  title: string;
  children: React.ReactNode;
  onDetached?: (newWindowId: string) => void;
  className?: string;
}

const DRAG_THRESHOLD_CSS_PIXELS = 16;

interface DetachControlContextValue {
  panelTypeId: PanelTypeId;
  title: string;
  canOpenAuxiliaryWindow: boolean;
  disabledReason: string;
  transferring: boolean;
  error: string | null;
  detachBtnRef: React.RefObject<HTMLButtonElement | null>;
  requestDetach: () => Promise<void>;
}

const DetachControlContext = createContext<DetachControlContextValue | null>(null);

/**
 * Place the primary detachment affordance in a panel's actual header/action
 * slot. It shares the parent handle's transactional coordinator and remains
 * absent for an auxiliary projection or a non-detachable panel.
 */
export function PanelDetachButton() {
  const controls = useContext(DetachControlContext);
  if (!controls) return null;

  const {
    panelTypeId,
    title,
    canOpenAuxiliaryWindow,
    disabledReason,
    transferring,
    error,
    detachBtnRef,
    requestDetach,
  } = controls;

  return (
    <TooltipProvider>
      <Tooltip
        label={
          transferring
            ? 'Detaching panel…'
            : (error ??
              (canOpenAuxiliaryWindow ? 'Detach panel into a new window' : disabledReason))
        }
        disabledReason={
          transferring ? 'Detaching panel…' : !canOpenAuxiliaryWindow ? disabledReason : undefined
        }
      >
        <button
          type="button"
          ref={detachBtnRef}
          className={`panel-detach-btn${error ? ' panel-detach-btn--error' : ''}`}
          onClick={() => void requestDetach()}
          onPointerDown={(event) => event.stopPropagation()}
          disabled={transferring || !canOpenAuxiliaryWindow}
          aria-label={`Detach ${title} panel into a new window`}
          aria-describedby={
            !canOpenAuxiliaryWindow ? `detach-unavailable-${panelTypeId}` : undefined
          }
          aria-busy={transferring || undefined}
          data-testid={`detach-${panelTypeId}`}
          data-transferring={transferring ? 'true' : undefined}
        >
          <SolidIcon name={SOLID_CHROME_ICONS.maximize} size="1em" />
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}

// One pointer gesture owns the global temporary overlay. Panel headers can
// mount/unmount as the workspace changes, so keeping this independent from a
// particular React tree also guarantees cleanup during a transfer commit.
let activeDrag: { panelInstanceId: string; title: string } | null = null;
let overlayEl: HTMLDivElement | null = null;

function showOverlay(): void {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.className = 'panel-detach-overlay';
  overlayEl.setAttribute('aria-hidden', 'true');
  Object.assign(overlayEl.style, {
    position: 'fixed',
    inset: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'color-mix(in oklch, var(--color-interactive-default, #3d9b8f) 12%, transparent)',
    border: '3px dashed var(--color-interactive-default, #3d9b8f)',
    borderRadius: 'var(--radius-floating)',
    zIndex: '99999',
    pointerEvents: 'none',
    fontSize: '15px',
    fontWeight: '600',
    color: 'var(--color-text-primary, #1a1a1a)',
    backdropFilter: 'blur(2px)',
  });
  overlayEl.textContent = 'Release to detach panel into a new window';
  document.body.appendChild(overlayEl);
}

function hideOverlay(): void {
  overlayEl?.remove();
  overlayEl = null;
}

function canDetachWhileActive(): { ok: true } | { ok: false; reason: string } {
  const activeEl = document.activeElement;
  if (activeEl) {
    const tag = activeEl.tagName.toLowerCase();
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      activeEl.getAttribute('contenteditable') === 'true'
    ) {
      return { ok: false, reason: 'Finish editing text before detaching this panel.' };
    }
    if (activeEl.closest('[data-slider-active], [data-drag-active]')) {
      return {
        ok: false,
        reason: 'Finish the active control interaction before detaching this panel.',
      };
    }
  }
  if (document.querySelector('[data-ime-composing]')) {
    return { ok: false, reason: 'Finish text composition before detaching this panel.' };
  }
  return { ok: true };
}

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
  const [announcement, setAnnouncement] = useState('');
  const [contextMenuAnchor, setContextMenuAnchor] = useState<OverlayAnchor | null>(null);
  const detachBtnRef = useRef<HTMLButtonElement>(null);
  const handleRef = useRef<HTMLFieldSetElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const needsWindowPointerFallbackRef = useRef(false);
  const draggingRef = useRef(false);
  const { isAuxiliary } = usePanelHost();
  const isDetachable = !isAuxiliary && isPanelDetachable(panelTypeId);
  const canOpenAuxiliaryWindow = getWindowService().capability !== 'single-window';
  const disabledReason =
    'Panel detachment is available in the desktop app when an auxiliary window can be opened.';

  const cancelDrag = useCallback(() => {
    pointerStartRef.current = null;
    activePointerIdRef.current = null;
    needsWindowPointerFallbackRef.current = false;
    draggingRef.current = false;
    if (activeDrag?.panelInstanceId === panelInstanceId) activeDrag = null;
    hideOverlay();
    setDragging(false);
  }, [panelInstanceId]);

  const requestDetach = useCallback(async () => {
    if (transferring || !isDetachable) return;
    if (!canOpenAuxiliaryWindow) {
      setError(disabledReason);
      return;
    }
    const check = canDetachWhileActive();
    if (!check.ok) {
      setError(check.reason);
      return;
    }

    setError(null);
    setAnnouncement('');
    setTransferring(true);
    try {
      const result = await detachPanel({
        panelTypeId,
        panelInstanceId,
        sourceWindowId: currentWindowId,
        // The interaction wrapper intentionally uses display:contents to
        // preserve each panel header's layout, so its own rect is zero. Read
        // the semantic panel root instead; otherwise a narrow 0px measurement
        // would force a popup down to its minimum width and clip its controls.
        sourceWidth:
          handleRef.current
            ?.closest<HTMLElement>(`[data-panel-root="${panelTypeId}"]`)
            ?.getBoundingClientRect().width ?? undefined,
        focusSource: () => detachBtnRef.current?.focus(),
        announce: setAnnouncement,
        onDetached,
      });
      if (result.status === 'already-detached') {
        setAnnouncement(`${title} panel is already detached.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Panel detachment failed.');
    } finally {
      setTransferring(false);
    }
  }, [
    canOpenAuxiliaryWindow,
    currentWindowId,
    disabledReason,
    isDetachable,
    onDetached,
    panelInstanceId,
    panelTypeId,
    title,
    transferring,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || activeDrag?.panelInstanceId !== panelInstanceId) return;
      event.preventDefault();
      cancelDrag();
      setAnnouncement(`${title} panel detachment cancelled.`);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelDrag, panelInstanceId, title]);

  useEffect(() => {
    return () => {
      if (activeDrag?.panelInstanceId === panelInstanceId) cancelDrag();
    };
  }, [cancelDrag, panelInstanceId]);

  const advanceDrag = useCallback(
    (pointerId: number, clientX: number, clientY: number) => {
      if (activePointerIdRef.current !== pointerId) return;
      const start = pointerStartRef.current;
      if (!start || draggingRef.current) return;
      const dx = clientX - start.x;
      const dy = clientY - start.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_CSS_PIXELS) return;

      const check = canDetachWhileActive();
      if (!check.ok) {
        setError(check.reason);
        cancelDrag();
        return;
      }
      activeDrag = { panelInstanceId, title };
      draggingRef.current = true;
      setDragging(true);
      showOverlay();
    },
    [cancelDrag, panelInstanceId, title],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLFieldSetElement>) => {
      if (
        !isDetachable ||
        !canOpenAuxiliaryWindow ||
        transferring ||
        activePointerIdRef.current !== null ||
        (activeDrag && activeDrag.panelInstanceId !== panelInstanceId) ||
        event.button !== 0
      ) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest('button, input, select, textarea, a, [role="button"]')) return;
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      activePointerIdRef.current = event.pointerId;
      needsWindowPointerFallbackRef.current = false;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Some WebKitGTK builds reject capture on display:contents. Continue
        // tracking at window level so a release outside the header cannot
        // strand the overlay or global drag state.
        needsWindowPointerFallbackRef.current = true;
      }
    },
    [canOpenAuxiliaryWindow, isDetachable, panelInstanceId, transferring],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLFieldSetElement>) => {
      advanceDrag(event.pointerId, event.clientX, event.clientY);
    },
    [advanceDrag],
  );

  const finishDrag = useCallback(
    (pointerId: number) => {
      if (activePointerIdRef.current !== pointerId) return;
      const shouldDetach = draggingRef.current && activeDrag?.panelInstanceId === panelInstanceId;
      cancelDrag();
      if (shouldDetach) void requestDetach();
    },
    [cancelDrag, panelInstanceId, requestDetach],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLFieldSetElement>) => {
      if (activePointerIdRef.current !== event.pointerId) return;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Pointer capture may already have been released by the browser.
      }
      finishDrag(event.pointerId);
    },
    [finishDrag],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLFieldSetElement>) => {
      if (activePointerIdRef.current === event.pointerId) cancelDrag();
    },
    [cancelDrag],
  );

  useEffect(() => {
    const onWindowPointerMove = (event: PointerEvent) => {
      if (!needsWindowPointerFallbackRef.current) return;
      advanceDrag(event.pointerId, event.clientX, event.clientY);
    };
    const onWindowPointerUp = (event: PointerEvent) => {
      if (!needsWindowPointerFallbackRef.current) return;
      finishDrag(event.pointerId);
    };
    const onWindowPointerCancel = (event: PointerEvent) => {
      if (needsWindowPointerFallbackRef.current && activePointerIdRef.current === event.pointerId) {
        cancelDrag();
      }
    };
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
    };
  }, [advanceDrag, cancelDrag, finishDrag]);

  const closeContextMenu = useCallback(() => setContextMenuAnchor(null), []);

  const openContextMenu = useCallback(
    (event: React.MouseEvent<HTMLFieldSetElement>) => {
      event.preventDefault();
      cancelDrag();
      if (!canOpenAuxiliaryWindow) {
        setError(disabledReason);
        return;
      }
      if (transferring) return;
      if (event.clientX === 0 && event.clientY === 0) {
        // Keyboard-invoked context menus have no pointer coordinates. Anchor
        // to the focused header control instead of inventing screen points.
        const target = (event.target as HTMLElement | null)?.closest
          ? (event.target as HTMLElement)
          : event.currentTarget;
        const anchor =
          target.closest<HTMLElement>('button, [role="tab"], [data-panel-root]') ?? target;
        setContextMenuAnchor(elementAnchor(anchor));
        return;
      }
      const contextElement = event.currentTarget as HTMLElement;
      setContextMenuAnchor(
        pointAnchor(
          viewportPoint(event.clientX, event.clientY),
          contextElement.ownerDocument,
          contextElement,
        ),
      );
    },
    [canOpenAuxiliaryWindow, cancelDrag, disabledReason, transferring],
  );

  const contextMenuItems = useMemo<readonly MenuEntry[]>(
    () => [
      {
        id: `detach-panel-${panelTypeId}`,
        label: `Detach ${title} Panel`,
        onAction: () => {
          closeContextMenu();
          void requestDetach();
        },
      },
    ],
    [closeContextMenu, panelTypeId, requestDetach, title],
  );

  const detachControls = useMemo<DetachControlContextValue>(
    () => ({
      panelTypeId,
      title,
      canOpenAuxiliaryWindow,
      disabledReason,
      transferring,
      error,
      detachBtnRef,
      requestDetach,
    }),
    [
      canOpenAuxiliaryWindow,
      disabledReason,
      error,
      panelTypeId,
      requestDetach,
      title,
      transferring,
    ],
  );

  if (!isDetachable) return <div className={className}>{children}</div>;

  return (
    <DetachControlContext.Provider value={detachControls}>
      <fieldset
        ref={handleRef}
        aria-label={`${title} panel controls`}
        className={`panel-drag-handle ${className ?? ''} ${dragging ? 'panel-drag-handle--active' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={openContextMenu}
        style={{ display: 'contents' }}
      >
        {children}
        {!canOpenAuxiliaryWindow && (
          <span id={`detach-unavailable-${panelTypeId}`} className="varve-visually-hidden">
            {disabledReason}
          </span>
        )}
        {error && (
          <div role="alert" className="varve-visually-hidden">
            {error}
          </div>
        )}
        <div role="status" aria-live="polite" className="varve-visually-hidden">
          {announcement}
        </div>
        <ContextMenu
          items={contextMenuItems}
          anchor={contextMenuAnchor}
          onClose={closeContextMenu}
          label={`${title} panel context menu`}
        />
      </fieldset>
    </DetachControlContext.Provider>
  );
}
