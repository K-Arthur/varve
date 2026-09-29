import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SoftProofOverlay } from './SoftProofOverlay';
import { resetViewProofState, setViewProofState } from './viewProofState';

beforeEach(() => resetViewProofState());
afterEach(() => {
  cleanup();
  resetViewProofState();
});

describe('SoftProofOverlay', () => {
  it('renders nothing when softProofEnabled is false', () => {
    const { container } = render(<SoftProofOverlay softProofEnabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders overlay when softProofEnabled is true', () => {
    render(<SoftProofOverlay softProofEnabled={true} />);
    const overlay = screen.getByTestId('soft-proof-overlay');
    expect(overlay).toBeDefined();
  });

  it('overlay is a fixed-position transparent element', () => {
    const { container } = render(<SoftProofOverlay softProofEnabled={true} />);
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.style.position).toBe('fixed');
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('applies ephemeral view transforms and restores focus when mirror mode ends', async () => {
    const root = document.createElement('div');
    root.className = 'editor-canvas';
    const firstCanvas = document.createElement('canvas');
    firstCanvas.className = 'editor-canvas__content-layer';
    firstCanvas.tabIndex = 0;
    root.append(firstCanvas);
    document.body.append(root);

    const { unmount } = render(<SoftProofOverlay softProofEnabled={false} />);
    act(() => setViewProofState({ grayscale: true, mirror: true }));

    expect(root).toHaveAttribute('data-view-proof-grayscale', 'true');
    expect(root).toHaveAttribute('data-view-proof-mirror', 'true');
    expect(firstCanvas).toHaveAttribute('tabindex', '-1');

    const secondCanvas = document.createElement('canvas');
    secondCanvas.className = 'editor-canvas__content-layer';
    secondCanvas.tabIndex = 0;
    firstCanvas.replaceWith(secondCanvas);
    await waitFor(() => expect(secondCanvas).toHaveAttribute('tabindex', '-1'));
    expect(firstCanvas).toHaveAttribute('tabindex', '0');

    act(() => setViewProofState({ mirror: false }));
    expect(root).toHaveAttribute('data-view-proof-grayscale', 'true');
    expect(root).not.toHaveAttribute('data-view-proof-mirror');
    expect(secondCanvas).toHaveAttribute('tabindex', '0');

    act(() => setViewProofState({ grayscale: false }));
    expect(root).not.toHaveAttribute('data-view-proof-grayscale');
    unmount();
    root.remove();
  });
});
