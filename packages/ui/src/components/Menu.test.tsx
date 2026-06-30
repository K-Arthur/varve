/** @vitest-environment jsdom */

import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Menu, type MenuEntry } from './Menu';

function TestMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const items: MenuEntry[] = [
    { id: 'open', label: 'Open', onAction: vi.fn() },
    { id: 'sep1', separator: true },
    { id: 'delete', label: 'Delete', onAction: vi.fn(), dialog: true },
  ];
  return (
    <>
      <button type="button" ref={ref}>
        trigger
      </button>
      <Menu items={items} triggerRef={ref} open={open} onClose={onClose} label="test" />
    </>
  );
}

describe('Menu', () => {
  it('renders items when open', () => {
    const { container } = render(<TestMenu open onClose={vi.fn()} />);
    const items = container.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(2);
  });

  it('does not render items when closed', () => {
    const { container } = render(<TestMenu open={false} onClose={vi.fn()} />);
    const menuEl = container.querySelector('[role="menu"]');
    expect(menuEl?.getAttribute('hidden')).not.toBeNull();
  });

  it('shows ellipsis for dialog items', () => {
    const { container } = render(<TestMenu open onClose={vi.fn()} />);
    const ellipses = container.querySelectorAll('.strata-menu__ellipsis');
    expect(ellipses.length).toBe(1);
  });
});
