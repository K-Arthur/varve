import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SoftProofOverlay } from './SoftProofOverlay';

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
});
