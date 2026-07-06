// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrintOverlays } from './PrintOverlays';

describe('PrintOverlays', () => {
  const defaultProps = {
    pageWidth: 210,
    pageHeight: 297,
    zoom: 1,
    documentUnit: 'mm' as const,
    dpi: 0,
    bleed: undefined,
    safeArea: undefined,
    slug: undefined,
    pxPerUnit: 3.779_527_559_055_118_6,
  };

  it('renders nothing when no overlays are configured', () => {
    const { container } = render(<PrintOverlays {...defaultProps} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders bleed guides when bleed is configured with values > 0', () => {
    const { container } = render(
      <PrintOverlays
        {...defaultProps}
        bleed={{ top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' }}
      />,
    );
    const svg = container.querySelector('svg.print-overlays');
    expect(svg).toBeTruthy();
    const bleedLines = container.querySelectorAll('.print-bleed-guide');
    expect(bleedLines.length).toBe(1);
  });

  it('does not render bleed guides when all bleed values are zero', () => {
    const { container } = render(
      <PrintOverlays
        {...defaultProps}
        bleed={{ top: 0, right: 0, bottom: 0, left: 0, linked: true, unit: 'mm' }}
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders safe area guides when safeArea is enabled', () => {
    const { container } = render(
      <PrintOverlays
        {...defaultProps}
        safeArea={{ top: 5, right: 5, bottom: 5, left: 5, unit: 'mm', enabled: true }}
      />,
    );
    const guides = container.querySelectorAll('.print-safe-area-guide');
    expect(guides.length).toBe(1);
  });

  it('does not render safe area guides when disabled', () => {
    const { container } = render(
      <PrintOverlays
        {...defaultProps}
        safeArea={{ top: 5, right: 5, bottom: 5, left: 5, unit: 'mm', enabled: false }}
      />,
    );
    expect(container.querySelector('.print-safe-area-guide')).toBeNull();
  });

  it('renders slug area when slug is enabled', () => {
    const { container } = render(
      <PrintOverlays
        {...defaultProps}
        slug={{ top: 10, right: 10, bottom: 10, left: 10, unit: 'mm', enabled: true }}
      />,
    );
    const slugLines = container.querySelectorAll('.print-slug-guide');
    expect(slugLines.length).toBe(1);
  });

  it('renders trim corner marks', () => {
    const { container } = render(
      <PrintOverlays
        {...defaultProps}
        bleed={{ top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' }}
      />,
    );
    const cornerMarks = container.querySelectorAll('.print-trim-mark');
    expect(cornerMarks.length).toBe(4);
  });

  it('uses pxPerUnit to scale positions from document units to screen pixels', () => {
    const bigScale = 10;
    const { container } = render(
      <PrintOverlays
        {...defaultProps}
        pxPerUnit={bigScale}
        bleed={{ top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' }}
      />,
    );
    const rect = container.querySelector('.print-bleed-rect');
    expect(rect).toBeTruthy();
    expect(parseFloat(rect?.getAttribute('x')!)).toBeCloseTo(-3 * bigScale, 4);
  });

  it('computes bleed rect from pixel-scaled dimensions', () => {
    const pxPu = 3.78;
    const bleed = { top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' as const };
    const { container } = render(
      <PrintOverlays {...defaultProps} pxPerUnit={pxPu} bleed={bleed} />,
    );
    const rect = container.querySelector('.print-bleed-rect');
    const x = parseFloat(rect?.getAttribute('x')!);
    const y = parseFloat(rect?.getAttribute('y')!);
    const w = parseFloat(rect?.getAttribute('width')!);
    const h = parseFloat(rect?.getAttribute('height')!);
    expect(x).toBeCloseTo(-bleed.left * pxPu, 4);
    expect(y).toBeCloseTo(-bleed.top * pxPu, 4);
    expect(w).toBeCloseTo(210 * pxPu + (bleed.left + bleed.right) * pxPu, 4);
    expect(h).toBeCloseTo(297 * pxPu + (bleed.top + bleed.bottom) * pxPu, 4);
  });
});
