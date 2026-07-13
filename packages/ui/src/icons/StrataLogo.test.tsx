/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StrataLogo } from './StrataLogo';

describe('StrataLogo', () => {
  it('renders the full variant with aria-hidden by default', () => {
    const { container } = render(<StrataLogo />);
    const svg = container.querySelector('svg');
    expect(svg).toBeDefined();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders with accessible label when label prop is set', () => {
    render(<StrataLogo label="Strata" />);
    expect(screen.getByRole('img', { name: 'Strata' })).toBeDefined();
  });

  it('uses parallelogram polygons in symbolic variant (not rounded rects)', () => {
    const { container } = render(<StrataLogo symbolic />);
    const polygons = container.querySelectorAll('polygon');
    expect(polygons.length).toBe(3);
    // Each polygon should have 4 coordinates (parallelogram)
    polygons.forEach((p) => {
      const pts = p.getAttribute('points') ?? '';
      expect(pts).toBeTruthy();
      const coords = pts.trim().split(/\s+/);
      expect(coords.length).toBe(4);
      coords.forEach((c) => {
        const parts = c.split(',');
        expect(parts.length).toBe(2);
        expect(Number.parseFloat(parts[0]!)).not.toBeNaN();
        expect(Number.parseFloat(parts[1]!)).not.toBeNaN();
      });
    });
  });

  it('renders full variant with path elements (brand logo)', () => {
    const { container } = render(<StrataLogo />);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(3);
  });

  it('accepts custom size', () => {
    const { container } = render(<StrataLogo size={32} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
  });
});
