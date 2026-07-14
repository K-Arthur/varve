import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

import { useEditor } from '../../context';
import { SpreadSettings } from './SpreadSettings';

function mockEditor(overrides: {
  facingPages?: { enabled: boolean; startOnRight: boolean } | null;
  spreads?: Array<{ id: string; pageIds: string[] }>;
  activePageId?: string | null;
  setFacingPagesEnabled?: ReturnType<typeof vi.fn>;
  getPageSide?: ReturnType<typeof vi.fn>;
}) {
  vi.mocked(useEditor).mockReturnValue({
    state: {
      document: {
        facingPages: overrides.facingPages ?? null,
        spreads: overrides.spreads ?? [],
        activePageId: overrides.activePageId ?? null,
      },
    },
    setFacingPagesEnabled: overrides.setFacingPagesEnabled ?? vi.fn(),
    getPageSide: overrides.getPageSide ?? vi.fn(() => 'none'),
  } as unknown as ReturnType<typeof useEditor>);
}

describe('SpreadSettings', () => {
  it('renders the spreads header', () => {
    mockEditor({});
    render(<SpreadSettings />);
    expect(screen.getByText('Spreads')).toBeDefined();
  });

  it('renders facing pages checkbox unchecked when disabled', () => {
    mockEditor({ facingPages: { enabled: false, startOnRight: true } });
    render(<SpreadSettings />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDefined();
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('renders facing pages checkbox checked when enabled', () => {
    mockEditor({ facingPages: { enabled: true, startOnRight: true } });
    render(<SpreadSettings />);
    const checkbox = screen.getByRole('checkbox');
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });

  it('calls setFacingPagesEnabled when checkbox is toggled', () => {
    const setFacingPagesEnabled = vi.fn();
    mockEditor({
      facingPages: { enabled: false, startOnRight: true },
      setFacingPagesEnabled,
    });
    render(<SpreadSettings />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(setFacingPagesEnabled).toHaveBeenCalledWith(true);
  });

  it('shows spread info when facing pages enabled', () => {
    mockEditor({
      facingPages: { enabled: true, startOnRight: true },
      spreads: [
        { id: 's1', pageIds: ['p1'] },
        { id: 's2', pageIds: ['p2', 'p3'] },
      ],
      activePageId: 'p2',
      getPageSide: vi.fn(() => 'left'),
    });
    render(<SpreadSettings />);
    expect(screen.getByText('2')).toBeDefined(); // spread count
    expect(screen.getByText('left')).toBeDefined(); // page side
    expect(screen.getByText('Yes')).toBeDefined(); // startOnRight
  });

  it('hides spread info when facing pages disabled', () => {
    mockEditor({
      facingPages: { enabled: false, startOnRight: true },
      spreads: [{ id: 's1', pageIds: ['p1'] }],
    });
    render(<SpreadSettings />);
    expect(screen.queryByText('Spreads')).toBeDefined(); // header always shows
    // Spread count row should NOT be visible
    expect(screen.queryByText('Current page side')).toBeNull();
  });

  it('shows "none" for page side when no active page', () => {
    mockEditor({
      facingPages: { enabled: true, startOnRight: true },
      spreads: [],
      activePageId: null,
      getPageSide: vi.fn(() => 'none'),
    });
    render(<SpreadSettings />);
    // The page side should show 'none'
    expect(screen.getByText('none')).toBeDefined();
  });
});
