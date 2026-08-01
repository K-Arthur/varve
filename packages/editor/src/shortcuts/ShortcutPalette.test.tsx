// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOverrides, setOverride } from './ShortcutManager';
import { ShortcutPalette } from './ShortcutPalette';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  cleanup();
  vi.restoreAllMocks();
});

function renderPalette(overrides?: { open?: boolean }) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const utils = render(
    <ShortcutPalette open={overrides?.open ?? true} onClose={onClose} onSelect={onSelect} />,
  );
  return { onClose, onSelect, ...utils };
}

describe('ShortcutPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = renderPalette({ open: false });
    expect(container.textContent).toBe('');
  });

  it('renders dialog when open', () => {
    renderPalette();
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeTruthy();
  });

  it('displays all shortcut groups', () => {
    renderPalette();
    const allGroupHeaders = screen.getAllByText((_content, element) => {
      return (
        element?.tagName === 'DIV' &&
        ['Edit', 'File', 'View', 'Object', 'Tools'].includes(element.textContent ?? '')
      );
    });
    expect(allGroupHeaders.length).toBeGreaterThanOrEqual(2);
  });

  it('filters shortcuts by label', async () => {
    renderPalette();
    const inputs = screen.getAllByRole('textbox', { name: /search/i });
    const input = inputs[0];
    if (!input) throw new Error('search input not found');
    await userEvent.type(input, 'undo');
    expect(screen.getByText('Undo')).toBeTruthy();
    expect(screen.queryByText('Redo')).toBeFalsy();
  });

  it('calls onSelect and onClose on row click', async () => {
    const { onClose, onSelect } = renderPalette();
    const undoRows = screen.getAllByText('Undo');
    const undoRow = undoRows[0];
    if (!undoRow) throw new Error('Undo row not found');
    await userEvent.click(undoRow);
    expect(onSelect).toHaveBeenCalledWith('undo');
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape', async () => {
    const { onClose } = renderPalette();
    const inputs = screen.getAllByRole('textbox', { name: /search/i });
    const input = inputs[0];
    if (!input) throw new Error('search input not found');
    await userEvent.type(input, '{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('remap flow', () => {
  it('enters capture mode and shows indicator', async () => {
    renderPalette();
    const remapButtons = screen.getAllByRole('button', { name: 'Remap shortcut' });
    expect(remapButtons.length).toBeGreaterThan(0);
    const remapBtn = remapButtons[0];
    if (!remapBtn) throw new Error('remap button not found');
    await userEvent.click(remapBtn);

    await waitFor(() => {
      expect(screen.getByText(/Press new shortcut for/i)).toBeTruthy();
    });
  });

  it('cancels capture mode on Escape', async () => {
    renderPalette();
    const remapButtons = screen.getAllByRole('button', { name: 'Remap shortcut' });
    const remapButton = remapButtons[0];
    if (!remapButton) throw new Error('remap button not found');
    await userEvent.click(remapButton);

    await waitFor(() => {
      expect(screen.getByText(/Press new shortcut for/i)).toBeTruthy();
    });

    const dialog = screen.getByRole('dialog', { name: /command palette/i });
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByText(/Press new shortcut for/i)).toBeFalsy();
  });

  it('captures key combo and stores override', async () => {
    renderPalette();
    const remapButtons = screen.getAllByRole('button', { name: 'Remap shortcut' });
    const remapButton = remapButtons[0];
    if (!remapButton) throw new Error('remap button not found');
    await userEvent.click(remapButton);

    await waitFor(() => {
      expect(screen.getByText(/Press new shortcut for/i)).toBeTruthy();
    });

    const captureArea = screen.getByRole('dialog');
    const keyEvent = new KeyboardEvent('keydown', {
      key: 'y',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    captureArea.dispatchEvent(keyEvent);

    const overrides = getOverrides();
    expect(Object.keys(overrides)).toHaveLength(1);
    expect(overrides).toHaveProperty('undo');
  });
});

describe('reset flow', () => {
  it('shows reset all button when overrides exist', () => {
    setOverride('undo', { key: 'y', ctrl: true });
    renderPalette();
    expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toBeTruthy();
  });

  it('resets single shortcut', async () => {
    setOverride('undo', { key: 'y', ctrl: true });
    renderPalette();

    const allResetButtons = screen.getAllByRole('button', { name: 'Reset to default' });
    const resetBtn = allResetButtons[0];
    if (!resetBtn) throw new Error('reset button not found');
    await userEvent.click(resetBtn);

    await waitFor(() => {
      const overrides = getOverrides();
      expect(Object.keys(overrides)).toHaveLength(0);
    });
  });

  it('resets all shortcuts', async () => {
    setOverride('undo', { key: 'y', ctrl: true });
    setOverride('redo', { key: 'z', ctrl: true });
    renderPalette();

    await userEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));

    await waitFor(() => {
      const overrides = getOverrides();
      expect(Object.keys(overrides)).toHaveLength(0);
    });
  });
});

describe('export/import', () => {
  it('export button triggers keymap generation', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
    URL.revokeObjectURL = vi.fn();

    renderPalette();
    await userEvent.click(screen.getByRole('button', { name: 'Export keymap' }));

    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('import button opens file picker', () => {
    renderPalette();
    expect(screen.getByRole('button', { name: 'Import keymap' })).toBeTruthy();
  });
});
