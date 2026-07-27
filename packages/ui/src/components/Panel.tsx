import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PanelProps {
  children: ReactNode;
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  side?: 'left' | 'right';
  collapsed?: boolean;
  onCollapse?: () => void;
  label: string;
}

const STORAGE_PREFIX = 'strata-panel-';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function Panel({
  children,
  storageKey,
  defaultWidth = 256,
  minWidth = 192,
  maxWidth = 576,
  side = 'left',
  collapsed = false,
  onCollapse,
  label,
}: PanelProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const initialWidth = (() => {
    const stored = localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (stored) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed)) return clamp(parsed, minWidth, maxWidth);
    }
    return clamp(defaultWidth, minWidth, maxWidth);
  })();

  const [width, setWidth] = useState(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const prevCollapsedRef = useRef(collapsed);
  useEffect(() => {
    if (collapsed !== prevCollapsedRef.current) {
      prevCollapsedRef.current = collapsed;
      if (collapsed && onCollapse) {
        onCollapse();
      }
    }
  }, [collapsed, onCollapse]);

  const persistWidth = useCallback(
    (w: number) => {
      localStorage.setItem(STORAGE_PREFIX + storageKey, String(w));
    },
    [storageKey],
  );

  const commitWidth = useCallback(
    (w: number) => {
      const clamped = clamp(w, minWidth, maxWidth);
      setWidth(clamped);
      persistWidth(clamped);
    },
    [minWidth, maxWidth, persistWidth],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 40 : 10;
      let newWidth = width;

      switch (e.key) {
        case 'ArrowLeft': {
          e.preventDefault();
          newWidth = side === 'left' ? width - step : width + step;
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          newWidth = side === 'left' ? width + step : width - step;
          break;
        }
        case 'Home': {
          e.preventDefault();
          newWidth = minWidth;
          break;
        }
        case 'End': {
          e.preventDefault();
          newWidth = maxWidth;
          break;
        }
        default:
          return;
      }

      commitWidth(newWidth);
    },
    [width, minWidth, maxWidth, side, commitWidth],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const delta = e.clientX - startXRef.current;
      const newWidth =
        side === 'left' ? startWidthRef.current + delta : startWidthRef.current - delta;
      setWidth(clamp(newWidth, minWidth, maxWidth));
    },
    [isDragging, minWidth, maxWidth, side],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      commitWidth(width);
    },
    [isDragging, width, commitWidth],
  );

  const panelClasses = [
    'strata-panel',
    collapsed ? 'strata-panel--collapsed' : '',
    reducedMotion ? 'strata-panel--reduced-motion' : '',
    side === 'left' ? 'strata-panel--left' : 'strata-panel--right',
    isDragging ? 'strata-panel--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={panelClasses} style={{ '--panel-width': `${width}px` } as React.CSSProperties}>
      <div className="strata-panel__content">{children}</div>
      {/* biome-ignore lint/a11y/useSemanticElements: draggable resize handle needs pointer/keyboard events */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-label={label}
        tabIndex={0}
        className="strata-panel__handle"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}
