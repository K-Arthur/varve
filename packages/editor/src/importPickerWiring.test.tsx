import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetActionRegistryForTesting } from './actions/ActionRegistry';
import { Shell } from './Shell';

/**
 * Regression guard for the reported bug: File → Import opened the document
 * picker (accepting only .varve/.strata/.json) instead of the asset import
 * picker (accepting svg/png/jpg/...). The two commands must drive two
 * independent hidden inputs.
 */
describe('File menu Open vs Import picker wiring', () => {
  beforeEach(() => {
    resetActionRegistryForTesting();
  });

  it('exposes two distinct hidden file inputs with disjoint accept filters', async () => {
    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('menubar')).toBeTruthy());

    const openInput = document.getElementById('file-open-input') as HTMLInputElement | null;
    const importInput = document.getElementById('file-import-input') as HTMLInputElement | null;
    expect(openInput).toBeTruthy();
    expect(importInput).toBeTruthy();
    if (!openInput || !importInput) throw new Error('hidden file inputs missing');

    // Open is document-only.
    expect(openInput.getAttribute('accept')).toContain('.varve');
    expect(openInput.getAttribute('accept')).not.toContain('.png');
    // Import is artwork-oriented.
    expect(importInput.getAttribute('accept')).toContain('.svg');
    expect(importInput.getAttribute('accept')).toContain('.png');
    expect(importInput.getAttribute('accept')).toContain('.jpg');
    expect(importInput.getAttribute('accept')).not.toContain('.varve');
  });

  it('the Import action activates the asset picker, never the document picker', async () => {
    const openClick = vi.fn();
    const importClick = vi.fn();

    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('menubar')).toBeTruthy());

    const openInput = document.getElementById('file-open-input') as HTMLInputElement;
    const importInput = document.getElementById('file-import-input') as HTMLInputElement;
    openInput.click = openClick;
    importInput.click = importClick;

    const { getActionRegistry } = await import('./actions/ActionRegistry');
    const action = getActionRegistry().get('import');
    expect(action).toBeTruthy();
    (action!.handler as () => void)();

    expect(importClick).toHaveBeenCalledTimes(1);
    expect(openClick).not.toHaveBeenCalled();
  });

  it('the Open action activates the document picker, never the asset picker', async () => {
    const openClick = vi.fn();
    const importClick = vi.fn();

    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('menubar')).toBeTruthy());

    const openInput = document.getElementById('file-open-input') as HTMLInputElement;
    const importInput = document.getElementById('file-import-input') as HTMLInputElement;
    openInput.click = openClick;
    importInput.click = importClick;

    const { getActionRegistry } = await import('./actions/ActionRegistry');
    const action = getActionRegistry().get('open');
    expect(action).toBeTruthy();
    (action!.handler as () => void)();

    expect(openClick).toHaveBeenCalledTimes(1);
    expect(importClick).not.toHaveBeenCalled();
  });
});
