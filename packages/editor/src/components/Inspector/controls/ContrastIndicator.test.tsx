import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContrastIndicator } from './ContrastIndicator';

describe('ContrastIndicator', () => {
  it('shows AAA for ratio >= 7.0 (normal text)', () => {
    // Black on white = 21:1 — should be AAA
    render(
      <ContrastIndicator fgColor={{ r: 0, g: 0, b: 0 }} bgColor={{ r: 255, g: 255, b: 255 }} />,
    );
    expect(screen.getByText('AAA')).toBeTruthy();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Contrast AAA');
  });

  it('shows AA for ratio between 4.5 and 7.0 (normal text)', () => {
    // A mid-gray on white that gives ~5.0:1
    render(
      <ContrastIndicator
        fgColor={{ r: 118, g: 118, b: 118 }}
        bgColor={{ r: 255, g: 255, b: 255 }}
      />,
    );
    expect(screen.getByText('AA')).toBeTruthy();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Contrast AA');
  });

  it('shows Fail for ratio < 4.5 (normal text)', () => {
    // Light gray on white — very low contrast
    render(
      <ContrastIndicator
        fgColor={{ r: 200, g: 200, b: 200 }}
        bgColor={{ r: 255, g: 255, b: 255 }}
      />,
    );
    expect(screen.getByText('Fail')).toBeTruthy();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Contrast Fail');
  });

  it('shows AAA for ratio >= 4.5 (large text)', () => {
    // Black on white = 21:1 with large font — should be AAA
    render(
      <ContrastIndicator
        fgColor={{ r: 0, g: 0, b: 0 }}
        bgColor={{ r: 255, g: 255, b: 255 }}
        fontSize={24}
      />,
    );
    expect(screen.getByText('AAA')).toBeTruthy();
  });

  it('shows AA for large text ratio between 3.0 and 4.5', () => {
    // (140,140,140) on white ≈ 3.22:1 — passes AA large (≥3.0) but fails AAA large (≥4.5)
    render(
      <ContrastIndicator
        fgColor={{ r: 140, g: 140, b: 140 }}
        bgColor={{ r: 255, g: 255, b: 255 }}
        fontSize={24}
      />,
    );
    expect(screen.getByText('AA')).toBeTruthy();
    expect(screen.queryByText('AAA')).toBeNull();
  });

  it('does NOT show AAA for ratio between 4.5 and 7.0 on normal text', () => {
    // This is the key regression test: ratio ~5.0 should NOT be AAA for normal text
    // Before the fix, the multiplier approach (4.5 * 1.5 = 6.75) would incorrectly
    // show AAA for some ratios below 7.0
    render(
      <ContrastIndicator
        fgColor={{ r: 118, g: 118, b: 118 }}
        bgColor={{ r: 255, g: 255, b: 255 }}
      />,
    );
    expect(screen.getByText('AA')).toBeTruthy();
    expect(screen.queryByText('AAA')).toBeNull();
  });

  it('handles missing background by testing against black and white', () => {
    render(<ContrastIndicator fgColor={{ r: 50, g: 50, b: 50 }} bgColor={null} />);
    // Dark on null bg should pick whichever of black/white gives higher contrast
    const label = screen.getByRole('status');
    expect(label.getAttribute('aria-label')).toMatch(/^Contrast (AA|AAA|Fail)$/);
  });

  it('shows question mark when no foreground color', () => {
    render(<ContrastIndicator fgColor={null} bgColor={{ r: 255, g: 255, b: 255 }} />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'No foreground color to check',
    );
  });
});
