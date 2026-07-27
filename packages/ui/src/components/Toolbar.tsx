/**
 * APG toolbar — role="toolbar" with roving tabindex (Strata plan §4.3, §5.3).
 *
 * Arrow keys navigate between tool buttons. The active tool gets tabindex=0.
 */
import {
  type ButtonHTMLAttributes,
  Children,
  cloneElement,
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface ToolbarProps {
  label: string;
  children: ReactNode;
  /** Whether arrow navigation wraps from last to first. Defaults to true. */
  wrap?: boolean;
}

export function Toolbar({ label, children, wrap = true }: ToolbarProps) {
  const [focusIdx, setFocusIdx] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const count = Children.count(children);

  // Focus the child at focusIdx when focusIdx changes (roving tabindex).
  useEffect(() => {
    const container = toolbarRef.current;
    if (!container) return;
    const target = container.children[focusIdx] as HTMLElement | undefined;
    if (target) target.focus();
  }, [focusIdx]);

  const navigate = useCallback(
    (dir: number) => {
      if (count <= 0) return;
      setFocusIdx((i) => {
        const next = i + dir;
        if (wrap) return ((next % count) + count) % count;
        return Math.max(0, Math.min(next, count - 1));
      });
    },
    [count, wrap],
  );

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          navigate(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          navigate(-1);
          break;
        case 'Home':
          e.preventDefault();
          setFocusIdx(0);
          break;
        case 'End':
          e.preventDefault();
          setFocusIdx(Math.max(0, count - 1));
          break;
      }
    },
    [navigate, count],
  );

  return (
    <div
      ref={toolbarRef}
      className="strata-toolbar"
      role="toolbar"
      aria-label={label}
      onKeyDown={handleKey}
    >
      {Children.map(children, (child, idx) => {
        if (
          !child ||
          typeof child === 'string' ||
          typeof child === 'number' ||
          typeof child === 'boolean' ||
          (child as ReactElement).type === Fragment
        )
          return child;
        return cloneElement(child as ReactElement<ButtonHTMLAttributes<HTMLElement>>, {
          tabIndex: idx === focusIdx ? 0 : -1,
        });
      })}
    </div>
  );
}
