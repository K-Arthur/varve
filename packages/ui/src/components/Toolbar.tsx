/**
 * APG toolbar — role="toolbar" with roving tabindex (Strata plan §4.3, §5.3).
 *
 * Arrow keys navigate between tool buttons. The active tool gets tabindex=0.
 */
import {
  type ButtonHTMLAttributes,
  Children,
  cloneElement,
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
}

export function Toolbar({ label, children }: ToolbarProps) {
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
      setFocusIdx((i) => (((i + dir + count) % count) + count) % count);
    },
    [count],
  );

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigate(1);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigate(-1);
      }
      if (e.key === 'Home') {
        e.preventDefault();
        setFocusIdx(0);
      }
      if (e.key === 'End') {
        e.preventDefault();
        setFocusIdx(count - 1);
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
          typeof child === 'boolean'
        )
          return child;
        return cloneElement(child as ReactElement<ButtonHTMLAttributes<HTMLElement>>, {
          tabIndex: idx === focusIdx ? 0 : -1,
        });
      })}
    </div>
  );
}
