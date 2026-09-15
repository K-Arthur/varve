/**
 * SelectionQuickBar — floating icon+label actions for sparse selection kinds.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
        containerWidth={1200}
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
        containerWidth={1200}
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
        containerWidth={1200}
        onAction={vi.fn()}
        pendingActionIds={['removeBg']}
      />,
    );
    expect(screen.getByRole('button', { name: /remove background/i })).toBeDisabled();
  });

  it('opens More menu and fires more action', async () => {
    const onAction = vi.fn();
    render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 200, y: 100, w: 180, h: 220 }}
        containerHeight={900}
        containerWidth={1200}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^more$/i }));
    const menu = await screen.findByRole('menu', { name: 'More actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /cycle fit/i }));
    expect(onAction).toHaveBeenCalledWith('fitCycle');
  });

  it('renders horizontal labeled chips (not icon-only cryptic bar)', () => {
    render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 200, y: 100, w: 180, h: 220 }}
        containerHeight={900}
        containerWidth={1200}
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
        containerWidth={1200}
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
        containerWidth={1200}
        onAction={vi.fn()}
      />,
    );
    const bar = container.querySelector('.selection-quick-bar') as HTMLElement;
    expect(bar.style.top).toBe('328px'); // 100 + 220 + 8
    expect(bar.style.left).toBe('290px'); // 200 + 180/2
  });

  it('keeps the bar inside the canvas safe area when it must flip above', () => {
    const { container } = render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 200, y: 10, w: 180, h: 680 }}
        containerHeight={700}
        containerWidth={1200}
        onAction={vi.fn()}
      />,
    );
    const bar = container.querySelector('.selection-quick-bar') as HTMLElement;
    expect(bar.style.top).toBe('8px');
  });

  it('clamps the bar inside the canvas when the selection sits at the left edge', () => {
    // Regression: the canvas is `overflow: hidden`, so an unclamped bar centred
    // on a left-edge selection lost its leading actions (Crop included) behind
    // the sidebar. The bar must be pushed right until its left edge is visible.
    const { container } = render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 0, y: 100, w: 100, h: 220 }}
        containerHeight={900}
        containerWidth={1200}
        onAction={vi.fn()}
      />,
    );
    const bar = container.querySelector('.selection-quick-bar') as HTMLElement;
    // Centre would be 50; the estimate (320) forces half of it plus the margin.
    expect(bar.style.left).toBe('168px');
    expect(bar.style.getPropertyValue('--selection-quick-bar-max-width')).toBe('1184px');
  });

  it('clamps the bar inside the canvas when the selection sits at the right edge', () => {
    const { container } = render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 1150, y: 100, w: 50, h: 220 }}
        containerHeight={900}
        containerWidth={1200}
        onAction={vi.fn()}
      />,
    );
    const bar = container.querySelector('.selection-quick-bar') as HTMLElement;
    expect(bar.style.left).toBe('1032px');
  });

  it('leaves a centred selection untouched', () => {
    const { container } = render(
      <SelectionQuickBar
        profile={imageProfile}
        screenBounds={{ x: 500, y: 100, w: 200, h: 220 }}
        containerHeight={900}
        containerWidth={1200}
        onAction={vi.fn()}
      />,
    );
    const bar = container.querySelector('.selection-quick-bar') as HTMLElement;
    expect(bar.style.left).toBe('600px');
  });

  it('avoids the floating tool palette pinned to the canvas bottom', () => {
    // Regression: with the selection low in the canvas, "below the selection"
    // landed inside the palette's band, and the palette (z-index raised + 1)
    // swallowed the click. The bar must yield to the palette instead.
    //
    // React's createRoot clears the custom container on mount, so the palette is
    // attached after render and the observer callback is replayed to force the
    // same re-measure a real ResizeObserver would trigger.
    const callbacks: Array<() => void> = [];
    const originalResizeObserver = globalThis.ResizeObserver;
    class RecordingResizeObserver {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RecordingResizeObserver as unknown as typeof ResizeObserver;

    try {
      const canvas = document.createElement('div');
      canvas.className = 'editor-canvas';
      canvas.getBoundingClientRect = () =>
        ({ top: 0, bottom: 543, left: 0, right: 682, width: 682, height: 543 }) as DOMRect;

      const { container } = render(
        <SelectionQuickBar
          profile={imageProfile}
          screenBounds={{ x: 0, y: 0, w: 320, h: 483 }}
          containerHeight={543}
          containerWidth={682}
          onAction={vi.fn()}
        />,
        { container: canvas },
      );
      const bar = container.querySelector('.selection-quick-bar') as HTMLElement;
      // Without a palette the bar sits below the selection.
      expect(bar.style.top).toBe('491px');

      const palette = document.createElement('div');
      palette.className = 'floating-toolbar';
      palette.setAttribute('data-testid', 'toolbar');
      palette.getBoundingClientRect = () =>
        ({ top: 487, bottom: 534, left: 0, right: 682, width: 682, height: 47 }) as DOMRect;
      // Mirrors the real structure: the palette is a Shell-grid sibling of the
      // canvas grid item, NOT a descendant of `.editor-canvas`.
      document.body.appendChild(palette);
      act(() => {
        for (const callback of [...callbacks]) callback();
      });

      const top = Number.parseFloat(bar.style.top);
      // Flipped above the selection and clear of the palette band (487): the
      // un-flipped position would be 491 and, with the mount height estimate,
      // would end inside the band where the palette swallows the click.
      expect(top).toBe(8);
      expect(top).toBeLessThan(487);
      palette.remove();
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it('clears a top-placed palette band too', () => {
    const callbacks: Array<() => void> = [];
    const originalResizeObserver = globalThis.ResizeObserver;
    class RecordingResizeObserver {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RecordingResizeObserver as unknown as typeof ResizeObserver;

    try {
      const canvas = document.createElement('div');
      canvas.className = 'editor-canvas';
      canvas.getBoundingClientRect = () =>
        ({ top: 0, bottom: 543, left: 0, right: 682, width: 682, height: 543 }) as DOMRect;

      const { container } = render(
        <SelectionQuickBar
          profile={imageProfile}
          screenBounds={{ x: 0, y: 0, w: 320, h: 40 }}
          containerHeight={543}
          containerWidth={682}
          onAction={vi.fn()}
        />,
        { container: canvas },
      );
      const bar = container.querySelector('.selection-quick-bar') as HTMLElement;

      // Palette at the top (View > Toolbar at Top), 0..57 canvas-local.
      const palette = document.createElement('div');
      palette.className = 'floating-toolbar floating-toolbar--top';
      palette.setAttribute('data-testid', 'toolbar');
      palette.getBoundingClientRect = () =>
        ({ top: 0, bottom: 57, left: 0, right: 682, width: 682, height: 57 }) as DOMRect;
      document.body.appendChild(palette);
      act(() => {
        for (const callback of [...callbacks]) callback();
      });

      const top = Number.parseFloat(bar.style.top);
      expect(top).toBeGreaterThanOrEqual(57);
      palette.remove();
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });
});
