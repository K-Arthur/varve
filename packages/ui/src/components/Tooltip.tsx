/**
 * Tooltip — APG Tooltip pattern with Floating UI positioning.
 *
 * Research basis: ARIA Authoring Practices Guide — Tooltip pattern
 *   https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
 */

import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

export interface TooltipProps {
  children: ReactNode;
  label: string;
  /** Preferred placement. Defaults to 'top'. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Delay in ms before showing on hover. Default 300. */
  delay?: number;
  /** Max width of the tooltip. Default 240px. */
  maxWidth?: number;
}

export function Tooltip({
  children,
  label,
  placement = 'top',
  delay = 300,
  maxWidth = 240,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const [posStyle, setPosStyle] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(
    (immediate = false) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (immediate) {
        setVisible(true);
      } else {
        timerRef.current = setTimeout(() => setVisible(true), delay);
      }
    },
    [delay],
  );

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
    setPosStyle(null);
  }, []);

  useEffect(() => {
    const triggerEl = triggerRef.current;
    const tipEl = tooltipRef.current;
    if (!visible || !triggerEl || !tipEl) return;

    const updatePosition = () => {
      computePosition(triggerEl, tipEl, {
        placement,
        middleware: [offset(6), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        setPosStyle({ left: x, top: y });
      });
    };

    const cleanup = autoUpdate(triggerEl, tipEl, updatePosition);
    updatePosition();

    return () => {
      cleanup();
    };
  }, [visible, placement]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const handler = () => hide();
    document.addEventListener('scroll', handler, true);
    return () => document.removeEventListener('scroll', handler, true);
  }, [visible, hide]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (
        !tooltipRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        hide();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [visible, hide]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    },
    [hide],
  );

  if (!label) {
    return <>{children}</>;
  }

  return (
    <span
      ref={triggerRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      onKeyDown={handleKeyDown}
      aria-describedby={visible ? tooltipId : undefined}
    >
      {children}
      {visible && (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="strata-tooltip"
          style={{
            position: 'fixed',
            left: posStyle?.left ?? 0,
            top: posStyle?.top ?? 0,
            zIndex: 9999,
            pointerEvents: 'none',
            maxWidth,
          }}
        >
          {label}
        </div>
      )}
    </span>
  );
}
