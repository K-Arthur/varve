import { describe, expect, it } from 'vitest';
import {
  convertDocumentUnit,
  convertPx,
  convertToPx,
  formatPhysical,
  formatValue,
  percentToPx,
  physicalToPx,
  physicalToPxAtDpi,
  ptToPx,
  pxAtDpiToPhysical,
  pxToPercent,
  pxToPhysical,
  pxToPt,
  pxToRem,
  remToPx,
  UNIT_TO_PX,
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

// ── DocumentUnit tests ─────────────────────────────────────────────────────

describe('UNIT_TO_PX', () => {
  it('has px = 1', () => {
    expect(UNIT_TO_PX.px).toBe(1);
  });

  it('has pt = 96/72 = 1.333...', () => {
    expect(UNIT_TO_PX.pt).toBeCloseTo(96 / 72, 6);
  });

  it('has in = 96', () => {
    expect(UNIT_TO_PX.in).toBe(96);
  });

  it('has mm = 96/25.4', () => {
    expect(UNIT_TO_PX.mm).toBeCloseTo(96 / 25.4, 6);
  });

  it('has cm = 96/2.54', () => {
    expect(UNIT_TO_PX.cm).toBeCloseTo(96 / 2.54, 6);
  });

  it('has pc = 16 (12pt = 1pc, 12 * 96/72 = 16px at 96dpi)', () => {
    expect(UNIT_TO_PX.pc).toBe(16);
  });
});

describe('convertDocumentUnit', () => {
  it('returns same value for same unit', () => {
    expect(convertDocumentUnit(100, 'mm', 'mm')).toBe(100);
  });

  it('converts mm to in (25.4 mm = 1 in)', () => {
    expect(convertDocumentUnit(25.4, 'mm', 'in')).toBeCloseTo(1, 6);
  });

  it('converts in to px (1 in = 96 px)', () => {
    expect(convertDocumentUnit(1, 'in', 'px')).toBe(96);
  });

  it('converts pt to pc (12 pt = 1 pc)', () => {
    expect(convertDocumentUnit(12, 'pt', 'pc')).toBeCloseTo(1, 6);
  });

  it('converts cm to mm (1 cm = 10 mm)', () => {
    expect(convertDocumentUnit(1, 'cm', 'mm')).toBeCloseTo(10, 6);
  });

  it('round-trips mm to px and back', () => {
    const px = convertDocumentUnit(210, 'mm', 'px');
    const back = convertDocumentUnit(px, 'px', 'mm');
    expect(back).toBeCloseTo(210, 4);
  });

  it('converts A4 width: 210mm to px', () => {
    const px = convertDocumentUnit(210, 'mm', 'px');
    expect(px).toBeCloseTo(793.7, 1);
  });
});

describe('physicalToPx', () => {
  it('converts mm to px', () => {
    expect(physicalToPx(25.4, 'mm')).toBeCloseTo(96, 4);
  });

  it('converts in to px', () => {
    expect(physicalToPx(1, 'in')).toBe(96);
  });

  it('converts pt to px', () => {
    expect(physicalToPx(72, 'pt')).toBe(96);
  });
});

describe('pxToPhysical', () => {
  it('converts px to mm', () => {
    expect(pxToPhysical(96, 'mm')).toBeCloseTo(25.4, 4);
  });

  it('converts px to in', () => {
    expect(pxToPhysical(96, 'in')).toBe(1);
  });

  it('round-trips with physicalToPx', () => {
    const px = physicalToPx(297, 'mm');
    expect(pxToPhysical(px, 'mm')).toBeCloseTo(297, 4);
  });
});

describe('formatPhysical', () => {
  it('formats with unit suffix', () => {
    expect(formatPhysical(210, 'mm')).toBe('210mm');
    expect(formatPhysical(8.5, 'in')).toBe('8.5in');
  });

  it('rounds to 2 decimals', () => {
    expect(formatPhysical(210.12345, 'mm')).toBe('210.12mm');
  });
});

describe('physicalToPxAtDpi', () => {
  it('matches physicalToPx at 96 dpi (the reference resolution)', () => {
    expect(physicalToPxAtDpi(210, 'mm', 96)).toBeCloseTo(physicalToPx(210, 'mm'), 6);
  });

  it('computes true print pixel count for A4 at 300dpi', () => {
    // Standard reference: A4 (210x297mm) at 300dpi is ~2480x3508px.
    expect(physicalToPxAtDpi(210, 'mm', 300)).toBeCloseTo(2480.3, 0);
    expect(physicalToPxAtDpi(297, 'mm', 300)).toBeCloseTo(3507.9, 0);
  });

  it('scales linearly with dpi', () => {
    expect(physicalToPxAtDpi(1, 'in', 600)).toBeCloseTo(physicalToPxAtDpi(1, 'in', 300) * 2, 6);
  });
});

describe('pxAtDpiToPhysical', () => {
  it('round-trips with physicalToPxAtDpi', () => {
    const px = physicalToPxAtDpi(210, 'mm', 300);
    expect(pxAtDpiToPhysical(px, 'mm', 300)).toBeCloseTo(210, 6);
  });
});
