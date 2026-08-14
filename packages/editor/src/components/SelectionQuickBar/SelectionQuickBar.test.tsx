/**
 * SelectionQuickBar — floating icon+label actions for sparse selection kinds.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickBarProfile } from './resolveQuickBarProfile';
import { SelectionQuickBar } from './SelectionQuickBar';

afterEach(cleanup);

const imageProfile: QuickBarProfile = {
  kind: 'image',
  actions: [
    { id: 'crop', label: 'Crop' },
    { id: 'removeBg', label: 'Remove background' },
    { id: 'upscale', label: 'Enhance' },
    { id: 'vectorize', label: 'Vectorize' },
    { id: 'flipH', label: 'Flip horizontal' },
    { id: 'flipV', label: 'Flip vertical' },
  ],
  moreActions: [{ id: 'fitCycle', label: 'Cycle fit' }],
};

describe('SelectionQuickBar', () => {
  beforeEach(() => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
  });

  it('renders primary action labels', () => {
    render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 200, y: 100, w: 180, h: 220 }}
        containerHeight={900}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole('toolbar', { name: /selection actions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove background/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^crop$/i })).toBeInTheDocument();
  });

  it('invokes onAction when primary button clicked', () => {
    const onAction = vi.fn();
    render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 200, y: 100, w: 180, h: 220 }}
        containerHeight={900}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove background/i }));
    expect(onAction).toHaveBeenCalledWith('removeBg');
  });

  it('disables removeBg while pending', () => {
    render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 200, y: 100, w: 180, h: 220 }}
        containerHeight={900}
        onAction={vi.fn()}
        pendingActionIds={['removeBg']}
      />,
    );
    expect(screen.getByRole('button', { name: /remove background/i })).toBeDisabled();
  });

  it('opens More menu and fires more action', () => {
    const onAction = vi.fn();
    render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 200, y: 100, w: 180, h: 220 }}
        containerHeight={900}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^more$/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /cycle fit/i }));
    expect(onAction).toHaveBeenCalledWith('fitCycle');
  });

  it('renders horizontal labeled chips (not icon-only cryptic bar)', () => {
    render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 200, y: 100, w: 180, h: 220 }}
        containerHeight={900}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText('Remove BG')).toBeInTheDocument();
    expect(screen.getByText('Crop')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
  });

  it('marks active actions with aria-pressed', () => {
    render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 200, y: 100, w: 180, h: 220 }}
        containerHeight={900}
        onAction={vi.fn()}
        activeActionIds={['flipH']}
      />,
    );
    // flip is icon-only — find via aria-label
    expect(screen.getByRole('button', { name: /flip horizontal/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('positions below the selection bounds', () => {
    const { container } = render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 200, y: 100, w: 180, h: 220 }}
        containerHeight={900}
        onAction={vi.fn()}
      />,
    );
    const bar = container.querySelector('.selection-quick-bar') as HTMLElement;
    expect(bar.style.top).toBe('328px'); // 100 + 220 + 8
    expect(bar.style.left).toBe('290px'); // 200 + 180/2
  });
});
