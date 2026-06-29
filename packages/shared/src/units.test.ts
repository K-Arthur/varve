import { describe, expect, it } from 'vitest';
import {
  convertPx,
  convertToPx,
  formatValue,
  percentToPx,
  ptToPx,
  pxToPercent,
  pxToPt,
  pxToRem,
  remToPx,
} from './units';

describe('pxToPt', () => {
  it('converts px to pt (96 dpi)', () => {
    expect(pxToPt(96)).toBe(72);
    expect(pxToPt(16)).toBe(12);
    expect(pxToPt(0)).toBe(0);
  });
});

describe('ptToPx', () => {
  it('converts pt to px (96 dpi)', () => {
    expect(ptToPx(72)).toBe(96);
    expect(ptToPx(12)).toBe(16);
  });
});

describe('pxToRem', () => {
  it('uses default 16px base', () => {
    expect(pxToRem(16)).toBe(1);
    expect(pxToRem(32)).toBe(2);
    expect(pxToRem(8)).toBe(0.5);
  });

  it('accepts custom base font size', () => {
    expect(pxToRem(16, 10)).toBe(1.6);
  });
});

describe('remToPx', () => {
  it('uses default 16px base', () => {
    expect(remToPx(1)).toBe(16);
    expect(remToPx(2)).toBe(32);
  });
});

describe('pxToPercent', () => {
  it('converts within container', () => {
    expect(pxToPercent(50, 200)).toBe(25);
    expect(pxToPercent(0, 200)).toBe(0);
    expect(pxToPercent(200, 200)).toBe(100);
  });

  it('returns 0 for zero container size', () => {
    expect(pxToPercent(50, 0)).toBe(0);
  });
});

describe('percentToPx', () => {
  it('converts percentage to px', () => {
    expect(percentToPx(25, 200)).toBe(50);
    expect(percentToPx(100, 200)).toBe(200);
  });
});

describe('convertPx', () => {
  it('returns same value for px target', () => {
    expect(convertPx(100, 'px')).toBe(100);
  });

  it('converts to pt', () => {
    expect(convertPx(96, 'pt')).toBe(72);
  });

  it('converts to rem', () => {
    expect(convertPx(16, 'rem')).toBe(1);
  });

  it('converts to percent', () => {
    expect(convertPx(50, '%', 16, 200)).toBe(25);
  });
});

describe('convertToPx', () => {
  it('returns same for px source', () => {
    expect(convertToPx(100, 'px')).toBe(100);
  });

  it('round-trips pt', () => {
    expect(convertToPx(72, 'pt')).toBe(96);
  });

  it('round-trips rem', () => {
    expect(convertToPx(1, 'rem')).toBe(16);
  });

  it('round-trips percent', () => {
    expect(convertToPx(25, '%', 16, 200)).toBe(50);
  });
});

describe('formatValue', () => {
  it('formats with unit suffix', () => {
    expect(formatValue(16, 'px')).toBe('16px');
    expect(formatValue(12, 'pt')).toBe('12pt');
    expect(formatValue(1.5, 'rem')).toBe('1.5rem');
    expect(formatValue(25, '%')).toBe('25%');
  });

  it('rounds to two decimals', () => {
    expect(formatValue(1.33333, 'rem')).toBe('1.33rem');
  });
});
