/**
 * Tooltip — APG Tooltip pattern (hover-delay + focus, Escape dismiss).
 *
 * Research basis: ARIA Authoring Practices Guide — Tooltip pattern
 *   https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
 */
import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

export interface TooltipProps {
  content: ReactNode;
  /** Delay in ms before showing on hover. Focus shows immediately. Default 400. */
  delay?: number;
  /** Position relative to trigger. Default 'below'. */
  placement?: 'above' | 'below';
  children: ReactElement<{
    onMouseEnter?: React.MouseEventHandler;
    onMouseLeave?: React.MouseEventHandler;
    onFocus?: React.FocusEventHandler;
    onBlur?: React.FocusEventHandler;
    onKeyDown?: React.KeyboardEventHandler;
    'aria-describedby'?: string;
  }>;
}

export function Tooltip({ content, delay = 400, placement = 'below', children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  function show(immediate = false) {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (immediate) {
      setVisible(true);
    } else {
      timerRef.current = setTimeout(() => setVisible(true), delay);
    }
  }

  function hide() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const trigger = cloneElement(children, {
    'aria-describedby': visible ? tooltipId : undefined,
    onMouseEnter: (e: React.MouseEvent) => {
      children.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
      show(true);
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e);
      hide();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      children.props.onKeyDown?.(e);
      if (e.key === 'Escape') hide();
    },
  });

  const tipStyle: React.CSSProperties =
    placement === 'above'
      ? { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 }
      : { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      {trigger}
      {visible && (
        <div
          id={tooltipId}
          role="tooltip"
          className="strata-tooltip"
          style={{
            ...tipStyle,
            position: 'absolute',
            zIndex: 9999,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
