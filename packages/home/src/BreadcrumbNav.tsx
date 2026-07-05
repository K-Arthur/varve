import { useCallback, useRef } from 'react';

export interface BreadcrumbSegment {
  id: string;
  name: string;
}

export interface BreadcrumbNavProps {
  path: BreadcrumbSegment[];
  onNavigate: (id: string) => void;
}

export function BreadcrumbNav({ path, onNavigate }: BreadcrumbNavProps) {
  const navRef = useRef<HTMLElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const buttons = navRef.current?.querySelectorAll<HTMLButtonElement>(
      '.breadcrumb-nav__item:not(.breadcrumb-nav__item--active)',
    );
    if (!buttons || buttons.length === 0) return;
    const current = Array.from(buttons).findIndex((el) => el === document.activeElement);
    switch (e.key) {
      case 'Home':
        e.preventDefault();
        buttons[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        buttons[buttons.length - 1]?.focus();
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (current < buttons.length - 1) buttons[current + 1]?.focus();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (current > 0) buttons[current - 1]?.focus();
        break;
    }
  }, []);

  if (path.length === 0) return null;

  return (
    <nav ref={navRef} className="breadcrumb-nav" aria-label="Breadcrumb" onKeyDown={handleKeyDown}>
      {path.map((segment, idx) => {
        const isLast = idx === path.length - 1;
        return (
          <span key={segment.id} className="breadcrumb-nav__segment">
            {idx > 0 && (
              <span className="breadcrumb-nav__separator" aria-hidden="true">
                /
              </span>
            )}
            {isLast ? (
              <span
                className="breadcrumb-nav__item breadcrumb-nav__item--active"
                aria-current="page"
              >
                {segment.name}
              </span>
            ) : (
              <button
                type="button"
                className="breadcrumb-nav__item"
                onClick={() => onNavigate(segment.id)}
                tabIndex={0}
              >
                {segment.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
