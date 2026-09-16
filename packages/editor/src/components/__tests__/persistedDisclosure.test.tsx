import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DISCLOSURE_STORAGE_PREFIX, usePersistedDisclosure } from '../usePersistedDisclosure';

/**
 * Sidebar sections used to reset their collapsed state on every remount
 * (workspace switch, panel toggle, reload). Blender/Godot users report that
 * class of reset as a top panel complaint, so the persistence contract is
 * pinned here rather than re-implemented per section.
 */
function Probe({
  storageKey,
  defaultCollapsed = false,
}: {
  storageKey: string;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = usePersistedDisclosure(storageKey, defaultCollapsed);
  return (
    <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)}>
      Probe section
    </button>
  );
}

describe('usePersistedDisclosure', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(cleanup);

  it('starts expanded by default', () => {
    render(<Probe storageKey="masters" />);
    expect(screen.getByRole('button', { name: 'Probe section' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('honours a collapsed default', () => {
    render(<Probe storageKey="masters" defaultCollapsed />);
    expect(screen.getByRole('button', { name: 'Probe section' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('remembers a collapse across remounts', async () => {
    const user = userEvent.setup();
    const view = render(<Probe storageKey="masters" />);

    await user.click(screen.getByRole('button', { name: 'Probe section' }));
    expect(window.localStorage.getItem(`${DISCLOSURE_STORAGE_PREFIX}masters`)).toBe('1');

    view.unmount();
    render(<Probe storageKey="masters" />);
    expect(screen.getByRole('button', { name: 'Probe section' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps each section key independent', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Probe storageKey="masters" />
        <Probe storageKey="pages" />
      </>,
    );

    await user.click(screen.getAllByRole('button', { name: 'Probe section' })[0]!);
    expect(window.localStorage.getItem(`${DISCLOSURE_STORAGE_PREFIX}pages`)).toBeNull();
  });

  it('does not throw when storage is unavailable', async () => {
    const user = userEvent.setup();
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('quota');
    };
    try {
      render(<Probe storageKey="spreads" />);
      await user.click(screen.getByRole('button', { name: 'Probe section' }));
      expect(screen.getByRole('button', { name: 'Probe section' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
