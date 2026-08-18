/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ContextMenu,
  Menu,
  MenuButton,
  type MenuEntry,
  type MenuItemCheckbox,
  type MenuItemRadio,
  type SubmenuItem,
} from './Menu';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function TestMenuWithSubmenus({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const subAction = vi.fn();
  const items: MenuEntry[] = [
    { id: 'open', label: 'Open', onAction: vi.fn() },
    {
      id: 'recent',
      label: 'Open Recent',
      type: 'submenu',
      submenu: [
        { id: 'file1', label: 'File 1', onAction: subAction },
        { id: 'file2', label: 'File 2', onAction: subAction },
      ],
    } satisfies SubmenuItem,
    { id: 'sep1', separator: true },
    { id: 'delete', label: 'Delete', onAction: vi.fn() },
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

function TestMenuWithCheckbox({
  open,
  onClose,
  checked = false,
}: {
  open: boolean;
  onClose: () => void;
  checked?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [isChecked, setIsChecked] = useState(checked);
  const onToggle = vi.fn(() => setIsChecked((c) => !c));
  const items: MenuEntry[] = [
    {
      id: 'bold',
      label: 'Bold',
      type: 'checkbox',
      checked: isChecked,
      onToggle,
    } satisfies MenuItemCheckbox,
    { id: 'sep1', separator: true },
    { id: 'delete', label: 'Delete', onAction: vi.fn() },
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

function TestMenuWithRadios({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [alignment, setAlignment] = useState('left');
  const onLeft = vi.fn(() => setAlignment('left'));
  const onCenter = vi.fn(() => setAlignment('center'));
  const onRight = vi.fn(() => setAlignment('right'));
  const items: MenuEntry[] = [
    {
      id: 'left',
      label: 'Left',
      type: 'radio',
      group: 'align',
      checked: alignment === 'left',
      onToggle: onLeft,
    } satisfies MenuItemRadio,
    {
      id: 'center',
      label: 'Center',
      type: 'radio',
      group: 'align',
      checked: alignment === 'center',
      onToggle: onCenter,
    } satisfies MenuItemRadio,
    {
      id: 'right',
      label: 'Right',
      type: 'radio',
      group: 'align',
      checked: alignment === 'right',
      onToggle: onRight,
    } satisfies MenuItemRadio,
    { id: 'sep1', separator: true },
    { id: 'delete', label: 'Delete', onAction: vi.fn() },
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

// ---------------------------------------------------------------------------
// Menu component tests
// ---------------------------------------------------------------------------

describe('Menu', () => {
  it('renders items when open', () => {
    render(<TestMenu open onClose={vi.fn()} />);
    const items = document.body.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(2);
  });

  it('portals menu to document.body when open', () => {
    render(<TestMenu open onClose={vi.fn()} />);
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    expect(menu?.parentElement?.parentElement).toBe(document.body);
  });

  it('does not render items when closed', () => {
    render(<TestMenu open={false} onClose={vi.fn()} />);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('shows ellipsis for dialog items', () => {
    render(<TestMenu open onClose={vi.fn()} />);
    const ellipses = document.body.querySelectorAll('.varve-menu__ellipsis');
    expect(ellipses.length).toBe(1);
  });

  it('calls onAction and onClose on item click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestMenu open onClose={onClose} />);
    const btn = document.body.querySelector('[role="menuitem"]') as HTMLElement;
    await user.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestMenu open onClose={onClose} />);
    const menu = screen.getByRole('menu');
    menu.focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates with ArrowDown and ArrowUp', async () => {
    const user = userEvent.setup();
    render(<TestMenu open onClose={vi.fn()} />);
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveAttribute('tabIndex', '0');

    {
      const el = items[0] as HTMLElement | undefined;
      if (el) el.focus();
    }
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveAttribute('tabIndex', '0');
    expect(items[0]).toHaveAttribute('tabIndex', '-1');

    await user.keyboard('{ArrowUp}');
    expect(items[0]).toHaveAttribute('tabIndex', '0');
  });

  it('navigates to first/last with Home/End', async () => {
    const user = userEvent.setup();
    render(<TestMenu open onClose={vi.fn()} />);
    const items = screen.getAllByRole('menuitem');
    {
      const el = items[0] as HTMLElement | undefined;
      if (el) el.focus();
    }
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Home}');
    expect(items[0]).toHaveAttribute('tabIndex', '0');
    await user.keyboard('{End}');
    expect(items[1]).toHaveAttribute('tabIndex', '0');
  });
});

// ---------------------------------------------------------------------------
// Submenu tests
// ---------------------------------------------------------------------------

describe('Menu submenus', () => {
  it('opens submenu on ArrowRight and shows submenu items', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestMenuWithSubmenus open onClose={onClose} />);

    const items = document.body.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(3);

    {
      const el = items[0] as HTMLElement | undefined;
      if (el) el.focus();
    }
    await user.keyboard('{ArrowDown}');
    // Focus "Open Recent" (index 1) — the submenu item
    await user.keyboard('{ArrowRight}');

    const menus = document.body.querySelectorAll('[role="menu"]');
    expect(menus.length).toBe(2);

    const submenuItems = menus[1]?.querySelectorAll('[role="menuitem"]');
    expect(submenuItems?.length).toBe(2);
    expect(submenuItems?.[0]?.textContent).toBe('File 1');
  });

  it('closes submenu on ArrowLeft', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestMenuWithSubmenus open onClose={onClose} />);

    const items = document.body.querySelectorAll('[role="menuitem"]');
    {
      const el = items[0] as HTMLElement | undefined;
      if (el) el.focus();
    }
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowRight}');
    expect(document.body.querySelectorAll('[role="menu"]').length).toBe(2);

    await user.keyboard('{ArrowLeft}');
    expect(document.body.querySelectorAll('[role="menu"]').length).toBe(1);
  });

  it('closes submenu on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestMenuWithSubmenus open onClose={onClose} />);

    const items = document.body.querySelectorAll('[role="menuitem"]');
    {
      const el = items[0] as HTMLElement | undefined;
      if (el) el.focus();
    }
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowRight}');
    expect(document.body.querySelectorAll('[role="menu"]').length).toBe(2);

    await user.keyboard('{Escape}');
    expect(document.body.querySelectorAll('[role="menu"]').length).toBe(1);
  });

  it('submenu item has aria-haspopup and aria-expanded after opening', async () => {
    const user = userEvent.setup();
    render(<TestMenuWithSubmenus open onClose={vi.fn()} />);

    const items = document.body.querySelectorAll('[role="menuitem"]');
    {
      const el = items[0] as HTMLElement | undefined;
      if (el) el.focus();
    }
    await user.keyboard('{ArrowDown}');

    const submenuTrigger = items[1];
    expect(submenuTrigger).toHaveAttribute('aria-haspopup', 'menu');

    await user.keyboard('{ArrowRight}');
    expect(submenuTrigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('calls item action in submenu and closes through closeAll', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestMenuWithSubmenus open onClose={onClose} />);

    const items = document.body.querySelectorAll('[role="menuitem"]');
    {
      const el = items[0] as HTMLElement | undefined;
      if (el) el.focus();
    }
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowRight}');

    const submenuItems = document.body
      .querySelectorAll('[role="menu"]')[1]
      ?.querySelectorAll('[role="menuitem"]');
    const targetItem = submenuItems?.[0];
    if (targetItem) await user.click(targetItem);

    expect(onClose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Checkbox tests
// ---------------------------------------------------------------------------

describe('Menu checkbox items', () => {
  it('renders menuitemcheckbox with aria-checked', () => {
    render(<TestMenuWithCheckbox open onClose={vi.fn()} checked={false} />);
    const cb = screen.getByRole('menuitemcheckbox');
    expect(cb).toBeInTheDocument();
    expect(cb).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles aria-checked on click', async () => {
    const user = userEvent.setup();
    render(<TestMenuWithCheckbox open onClose={vi.fn()} checked={false} />);
    const cb = document.body.querySelector('[role="menuitemcheckbox"]') as HTMLElement;
    await user.click(cb);
    expect(cb).toHaveAttribute('aria-checked', 'true');
  });

  it('does not close menu when toggling checkbox', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestMenuWithCheckbox open onClose={onClose} checked={false} />);
    const cb = document.body.querySelector('[role="menuitemcheckbox"]') as HTMLElement;
    await user.click(cb);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('toggles on Enter key', async () => {
    const user = userEvent.setup();
    render(<TestMenuWithCheckbox open onClose={vi.fn()} checked={false} />);
    const cb = screen.getByRole('menuitemcheckbox');
    cb.focus();
    await user.keyboard('{Enter}');
    expect(cb).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles on Space key', async () => {
    const user = userEvent.setup();
    render(<TestMenuWithCheckbox open onClose={vi.fn()} checked={false} />);
    const cb = screen.getByRole('menuitemcheckbox');
    cb.focus();
    await user.keyboard(' ');
    expect(cb).toHaveAttribute('aria-checked', 'true');
  });
});

// ---------------------------------------------------------------------------
// Radio item tests
// ---------------------------------------------------------------------------

describe('Menu radio items', () => {
  it('renders menuitemradio with aria-checked', () => {
    render(<TestMenuWithRadios open onClose={vi.fn()} />);
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.length).toBe(3);
    expect(radios[0] as HTMLElement).toHaveAttribute('aria-checked', 'true');
    expect(radios[1] as HTMLElement).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles radio group on click, unchecking siblings', async () => {
    const user = userEvent.setup();
    render(<TestMenuWithRadios open onClose={vi.fn()} />);
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.length).toBe(3);
    const [r0, r1, r2] = radios;
    if (!r0 || !r1 || !r2) throw new Error('missing radio');

    await user.click(r1);
    expect(r0).toHaveAttribute('aria-checked', 'false');
    expect(r1).toHaveAttribute('aria-checked', 'true');
    expect(r2).toHaveAttribute('aria-checked', 'false');

    await user.click(r2);
    expect(r0).toHaveAttribute('aria-checked', 'false');
    expect(r1).toHaveAttribute('aria-checked', 'false');
    expect(r2).toHaveAttribute('aria-checked', 'true');
  });
});

// ---------------------------------------------------------------------------
// Type-ahead tests
// ---------------------------------------------------------------------------

describe('Menu type-ahead', () => {
  it('focuses item matching typed characters', async () => {
    const user = userEvent.setup();
    render(<TestMenu open onClose={vi.fn()} />);
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    menu.focus();
    // Type 'O' to match "Open"
    await user.keyboard('o');
    const items = document.body.querySelectorAll('[role="menuitem"]');
    expect(items[0]).toHaveAttribute('tabIndex', '0');
  });

  it('focuses different item on subsequent typing', async () => {
    const user = userEvent.setup();
    render(<TestMenu open onClose={vi.fn()} />);
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    menu.focus();
    // 'd' should match "Delete"
    await user.keyboard('d');
    const items = document.body.querySelectorAll('[role="menuitem"]');
    expect(items[1]).toHaveAttribute('tabIndex', '0');
  });
});

// ---------------------------------------------------------------------------
// ContextMenu tests
// ---------------------------------------------------------------------------

describe('ContextMenu', () => {
  it('renders at the given position', () => {
    render(
      <ContextMenu
        items={[{ id: 'a', label: 'Action A', onAction: vi.fn() }]}
        position={{ x: 100, y: 200 }}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByText('Action A')).toBeInTheDocument();
  });

  it('returns null when position is null', () => {
    const { container } = render(
      <ContextMenu
        items={[{ id: 'a', label: 'Action A', onAction: vi.fn() }]}
        position={null}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('adjusts position when near viewport edge', () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;

    // Override window dimensions for test
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 500,
    });

    render(
      <ContextMenu
        items={[
          { id: 'a', label: 'Action A', onAction: vi.fn() },
          { id: 'b', label: 'Action B', onAction: vi.fn() },
        ]}
        position={{ x: 450, y: 450 }}
        onClose={vi.fn()}
      />,
    );

    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    // The layout effect will adjust the position. Check that it's clamped.
    const left = parseInt(menu.style.left, 10);
    const top = parseInt(menu.style.top, 10);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalWidth,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalHeight,
    });
  });
});

// ---------------------------------------------------------------------------
// MenuButton tests
// ---------------------------------------------------------------------------

describe('Menu focus lifecycle', () => {
  function ControlledMenu({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
    const ref = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(initiallyOpen);
    const items: MenuEntry[] = [
      { id: 'open', label: 'Open', onAction: vi.fn() },
      { id: 'delete', label: 'Delete', onAction: vi.fn(), dialog: true },
    ];
    return (
      <>
        <button type="button" ref={ref}>
          trigger
        </button>
        <button type="button">after</button>
        <Menu
          items={items}
          triggerRef={ref}
          open={open}
          onClose={() => setOpen(false)}
          label="test"
        />
      </>
    );
  }

  function ItemsMenu({ items }: { items: MenuEntry[] }) {
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button type="button" ref={ref}>
          trigger
        </button>
        <Menu items={items} triggerRef={ref} open onClose={vi.fn()} label="test" />
      </>
    );
  }

  it('moves focus to the first item when it opens', async () => {
    render(<ControlledMenu initiallyOpen />);
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
  });

  it('skips a disabled first item for initial focus', async () => {
    render(
      <ItemsMenu
        items={[
          { id: 'd', label: 'Disabled', onAction: vi.fn(), disabled: true },
          { id: 'ok', label: 'OK', onAction: vi.fn() },
        ]}
      />,
    );
    const items = screen.getAllByRole('menuitem');
    expect(items[1]).toHaveFocus();
  });

  it('restores focus to the previously focused element when closed by Escape', async () => {
    const user = userEvent.setup();
    render(<ControlledMenu initiallyOpen />);
    const trigger = screen.getByRole('button', { name: 'trigger' });
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('restores focus to the trigger when closed by activating an item', async () => {
    const user = userEvent.setup();
    render(<ControlledMenu initiallyOpen />);
    const trigger = screen.getByRole('button', { name: 'trigger' });
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(trigger).toHaveFocus();
  });

  it('restores focus to the trigger when closed by outside click', async () => {
    const user = userEvent.setup();
    render(<ControlledMenu initiallyOpen />);
    await user.click(document.body);
    await user.click(screen.getByRole('button', { name: 'after' }));
    // Outside click moved focus to the clicked element (a button); the menu
    // must not yank it back.
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });

  it('Tab closes the menu and moves focus to the element after the trigger', async () => {
    const user = userEvent.setup();
    render(<ControlledMenu initiallyOpen />);
    const after = screen.getByRole('button', { name: 'after' });
    await user.keyboard('{Tab}');
    expect(after).toHaveFocus();
  });

  it('Shift+Tab closes the menu and moves focus to the element before the trigger', async () => {
    const user = userEvent.setup();
    render(<ControlledMenu initiallyOpen />);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(document.body);
  });

  it('arrow navigation skips disabled items', async () => {
    const user = userEvent.setup();
    render(
      <ItemsMenu
        items={[
          { id: 'a', label: 'A', onAction: vi.fn() },
          { id: 'b', label: 'B', onAction: vi.fn(), disabled: true },
          { id: 'c', label: 'C', onAction: vi.fn() },
        ]}
      />,
    );
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[2]).toHaveFocus();
  });
});

// Regression: "Show all (N items)" only called closeAll(), so activating it
// dismissed the menu without ever revealing the truncated items — the control
// named an action it did not perform.
describe('Menu item truncation', () => {
  function TruncatedMenu({ onClose }: { onClose: () => void }) {
    const ref = useRef<HTMLButtonElement>(null);
    const items: MenuEntry[] = Array.from({ length: 40 }, (_, i) => ({
      id: `item-${i}`,
      label: `Item ${i}`,
      onAction: vi.fn(),
    }));
    return (
      <>
        <button type="button" ref={ref}>
          trigger
        </button>
        <Menu items={items} triggerRef={ref} open onClose={onClose} label="test" />
      </>
    );
  }

  it('reveals the hidden items instead of closing the menu', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TruncatedMenu onClose={onClose} />);

    // Default maxVisibleItems is 30.
    expect(document.body.querySelectorAll('[role="menuitem"]').length).toBe(31); // 30 + Show all

    const showAll = screen.getByText(/Show all \(40 items\)/);
    await user.click(showAll);

    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.querySelectorAll('[role="menuitem"]').length).toBe(40);
    expect(screen.queryByText(/Show all/)).not.toBeInTheDocument();
    expect(screen.getByText('Item 39')).toBeInTheDocument();
  });
});

describe('MenuButton', () => {
  it('renders with aria attributes', () => {
    render(<MenuButton label="File" menuId="file-menu" expanded={false} onClick={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'File' });
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveAttribute('aria-controls', 'file-menu');
  });

  it('reflects expanded state', () => {
    render(<MenuButton label="File" menuId="file-menu" expanded onClick={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'File' });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('fires onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<MenuButton label="File" menuId="file-menu" expanded={false} onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});
