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
  useCallback,
  useState,
} from 'react';

export interface ToolbarProps {
  label: string;
  children: ReactElement[];
}

export function Toolbar({ label, children }: ToolbarProps) {
  const [focusIdx, setFocusIdx] = useState(0);
  const count = Children.count(children);

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
    <div role="toolbar" aria-label={label} onKeyDown={handleKey}>
      {Children.map(children, (child, idx) =>
        cloneElement(child as ReactElement<ButtonHTMLAttributes<HTMLElement>>, {
          tabIndex: idx === focusIdx ? 0 : -1,
        }),
      )}
    </div>
  );
}
