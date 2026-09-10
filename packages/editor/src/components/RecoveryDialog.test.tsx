/**
 * Tests for RecoveryDialog.
 */

import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryDialog } from './RecoveryDialog';

function makeSession(
  overrides: Partial<{
    id: string;
    tabName: string;
    timestamp: number;
    fileId?: string;
    filePath?: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 'rec-1',
    tabName: overrides.tabName ?? 'My Design',
    timestamp: overrides.timestamp ?? Date.now(),
    ...(overrides.fileId ? { fileId: overrides.fileId } : {}),
    ...(overrides.filePath ? { filePath: overrides.filePath } : {}),
  };
}

describe('RecoveryDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders with sessions list', () => {
    const sessions = [
      makeSession({ id: 'rec-1', tabName: 'Design 1' }),
      makeSession({ id: 'rec-2', tabName: 'Design 2' }),
    ];
    const { container } = render(
      <RecoveryDialog
        open
        sessions={sessions}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
        onRestoreAll={vi.fn()}
        onDiscardAll={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Design 1');
    expect(container.textContent).toContain('Design 2');
  });

  it('calls onRestore when restore button is clicked', () => {
    const onRestore = vi.fn();
    const session = makeSession({ id: 'rec-1', tabName: 'My Tab' });
    const { container } = render(
      <RecoveryDialog
        open
        sessions={[session]}
        onRestore={onRestore}
        onDiscard={vi.fn()}
        onRestoreAll={vi.fn()}
        onDiscardAll={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const buttons = container.querySelectorAll('button');
    // Order: Close, Restore, Discard, Restore All, Discard All
    const restoreBtn = buttons[1] as HTMLButtonElement | undefined;
    expect(restoreBtn).toBeDefined();
    expect(restoreBtn?.textContent).toBe('Restore');
    restoreBtn?.click();
    expect(onRestore).toHaveBeenCalledWith('rec-1');
  });

  it('calls onDiscard when discard button is clicked', () => {
    const onDiscard = vi.fn();
    const session = makeSession({ id: 'rec-2' });
    const { container } = render(
      <RecoveryDialog
        open
        sessions={[session]}
        onRestore={vi.fn()}
        onDiscard={onDiscard}
        onRestoreAll={vi.fn()}
        onDiscardAll={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const buttons = container.querySelectorAll('button');
    // Order: Close, Restore, Discard, Restore All, Discard All
    const discardBtn = buttons[2] as HTMLButtonElement | undefined;
    expect(discardBtn).toBeDefined();
    expect(discardBtn?.textContent).toBe('Discard');
    discardBtn?.click();
    expect(onDiscard).toHaveBeenCalledWith('rec-2');
  });

  it('calls onRestoreAll when Restore All button is clicked', () => {
    const onRestoreAll = vi.fn();
    const { container } = render(
      <RecoveryDialog
        open
        sessions={[makeSession()]}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
        onRestoreAll={onRestoreAll}
        onDiscardAll={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const buttons = container.querySelectorAll('button');
    // Find the Restore All button by text
    const restoreAllBtn = Array.from(buttons).find((b) => b.textContent === 'Restore All');
    expect(restoreAllBtn).toBeDefined();
    restoreAllBtn?.click();
    expect(onRestoreAll).toHaveBeenCalled();
  });

  it('calls onDiscardAll on second click (two-click confirmation)', () => {
    const onDiscardAll = vi.fn();
    const { container } = render(
      <RecoveryDialog
        open
        sessions={[makeSession()]}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
        onRestoreAll={vi.fn()}
        onDiscardAll={onDiscardAll}
        onClose={vi.fn()}
      />,
    );
    const buttons = container.querySelectorAll('button');
    const discardAllBtn = Array.from(buttons).find((b) => b.textContent === 'Discard All');
    expect(discardAllBtn).toBeDefined();
    // First click shows confirmation
    act(() => {
      discardAllBtn?.click();
    });
    expect(onDiscardAll).not.toHaveBeenCalled();
    // Second click triggers discard
    const confirmBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Confirm Discard All',
    );
    expect(confirmBtn).toBeDefined();
    act(() => {
      confirmBtn?.click();
    });
    expect(onDiscardAll).toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <RecoveryDialog
        open
        sessions={[makeSession()]}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
        onRestoreAll={vi.fn()}
        onDiscardAll={vi.fn()}
        onClose={onClose}
      />,
    );
    const closeBtn = container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
    expect(closeBtn).toBeDefined();
    closeBtn?.click();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when no sessions', () => {
    const { container } = render(
      <RecoveryDialog
        open
        sessions={[]}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
        onRestoreAll={vi.fn()}
        onDiscardAll={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('No recovered');
  });

  it('shows file name when available', () => {
    const session = makeSession({ tabName: 'Design', fileId: 'file-1' });
    const { container } = render(
      <RecoveryDialog
        open
        sessions={[session]}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
        onRestoreAll={vi.fn()}
        onDiscardAll={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Design');
  });
});
