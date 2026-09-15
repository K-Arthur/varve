import { describe, expect, it } from 'vitest';
import {
  clampQuickBarLeft,
  padReserveFromRects,
  QUICK_BAR_EDGE_MARGIN,
  QUICK_BAR_ESTIMATED_WIDTH,
  resolveQuickBarTop,
} from './selectionQuickBarPosition';

describe('clampQuickBarLeft', () => {
  it('leaves a selection-centred bar untouched in the middle of the canvas', () => {
    expect(clampQuickBarLeft(600, 400, 1200)).toBe(600);
  });

  it('pushes a left-edge bar in until its leading edge clears the canvas', () => {
    // Centre 50 with a 400 px bar: the left edge would be at -150 and clipped.
    expect(clampQuickBarLeft(50, 400, 1200)).toBe(QUICK_BAR_EDGE_MARGIN + 200);
  });

  it('pulls a right-edge bar in until its trailing edge clears the canvas', () => {
    expect(clampQuickBarLeft(1190, 400, 1200)).toBe(1200 - QUICK_BAR_EDGE_MARGIN - 200);
  });

  it('uses the mount estimate before the bar has been measured', () => {
    expect(clampQuickBarLeft(0, 0, 1200)).toBe(
      QUICK_BAR_EDGE_MARGIN + QUICK_BAR_ESTIMATED_WIDTH / 2,
    );
  });

  it('pins the leading edge when the bar is wider than the canvas', () => {
    // Wider than the usable box: keep the first actions reachable; the inner
    // strip scrolls for the rest.
    const left = clampQuickBarLeft(600, 1300, 1200);
    expect(left).toBe(QUICK_BAR_EDGE_MARGIN + 650);
  });

  it('never returns a position that would place the leading edge off-canvas', () => {
    for (const centerX of [-500, -1, 0, 5]) {
      for (const barWidth of [0, 100, 320, 800, 1200, 2000]) {
        const left = clampQuickBarLeft(centerX, barWidth, 1200);
        const effectiveWidth = barWidth || QUICK_BAR_ESTIMATED_WIDTH;
        const leadingEdge = left - Math.min(effectiveWidth, 1200 - 2 * QUICK_BAR_EDGE_MARGIN) / 2;
        expect(leadingEdge).toBeGreaterThanOrEqual(-0.001);
      }
    }
  });

  it('degrades gracefully without container geometry or finite input', () => {
    expect(clampQuickBarLeft(300, 400, 0)).toBe(300);
    expect(clampQuickBarLeft(300, 400, Number.NaN)).toBe(300);
    expect(clampQuickBarLeft(Number.NaN, 400, 1200)).toBe(QUICK_BAR_EDGE_MARGIN);
    expect(clampQuickBarLeft(300, Number.NaN, 1200)).toBe(300);
  });
});

describe('padReserveFromRects', () => {
  const canvas = { top: 122, bottom: 666, height: 544 };

  it('measures a bottom palette band from the canvas bottom to the palette top', () => {
    // Palette at 609..656 in viewport space, canvas 122..666.
    expect(padReserveFromRects(canvas, { top: 609, bottom: 656, height: 47 })).toEqual({
      top: 0,
      bottom: 57,
    });
  });

  it('measures a top palette band from the canvas top to the palette bottom', () => {
    // View > Toolbar at Top: palette anchored to the canvas cell top.
    expect(padReserveFromRects(canvas, { top: 130, bottom: 177, height: 47 })).toEqual({
      top: 55,
      bottom: 0,
    });
  });

  it('reserves nothing without a palette, a canvas, or a live height', () => {
    const none = { top: 0, bottom: 0 };
    expect(padReserveFromRects(null, { top: 609, bottom: 656, height: 47 })).toEqual(none);
    expect(padReserveFromRects(canvas, null)).toEqual(none);
    expect(padReserveFromRects(canvas, { top: 609, height: 0 })).toEqual(none);
    expect(padReserveFromRects({ top: Number.NaN, bottom: 666 }, { top: 609 })).toEqual(none);
  });

  it('reserves nothing for a palette entirely outside the canvas', () => {
    expect(padReserveFromRects(canvas, { top: 700, bottom: 747, height: 47 })).toEqual({
      top: 0,
      bottom: 0,
    });
  });
});

describe('resolveQuickBarTop', () => {
  const base = {
    selectionTop: 0,
    selectionBottom: 483,
    barHeight: 47,
    containerHeight: 543,
    margin: 8,
  };

  it('places the bar below the selection when the band is free', () => {
    const placement = resolveQuickBarTop({ ...base, reservedBottom: 0 });
    expect(placement.top).toBe(491);
    expect(placement.flipped).toBe(false);
  });

  it('stays above the palette band instead of underneath it', () => {
    // Regression: with the palette occupying the bottom 57 px, "below" would put
    // the bar inside it, where the palette (a higher z-level) swallows clicks.
    const placement = resolveQuickBarTop({ ...base, reservedBottom: 57 });
    expect(placement.flipped).toBe(true);
    expect(placement.top + base.barHeight).toBeLessThanOrEqual(base.containerHeight - 57);
  });

  it('keeps a tall selection reachable rather than pushed into the band', () => {
    const placement = resolveQuickBarTop({
      ...base,
      selectionTop: 0,
      selectionBottom: 543,
      reservedBottom: 57,
    });
    expect(placement.top).toBe(base.margin);
  });

  it('clears a top-placed palette band as well', () => {
    // Selection inside the top band: "below the selection" would still be under
    // the palette, so the bar is pushed to the far side of the band.
    const placement = resolveQuickBarTop({
      ...base,
      selectionTop: 2,
      selectionBottom: 20,
      reservedTop: 60,
    });
    expect(placement.top).toBeGreaterThanOrEqual(60);
    expect(placement.top + base.barHeight).toBeLessThanOrEqual(base.containerHeight);
  });

  it('never places the bar inside a reserved band', () => {
    for (const reservedTop of [0, 40, 120]) {
      for (const reservedBottom of [0, 57, 200]) {
        for (const selectionTop of [-100, 0, 150, 400]) {
          const placement = resolveQuickBarTop({
            ...base,
            selectionTop,
            selectionBottom: selectionTop + 200,
            reservedTop,
            reservedBottom,
          });
          const usableTop = Math.max(base.margin, reservedTop);
          const usableBottom = base.containerHeight - reservedBottom;
          if (usableBottom - usableTop < base.barHeight) continue; // no room at all
          expect(placement.top).toBeGreaterThanOrEqual(usableTop);
          expect(placement.top + base.barHeight).toBeLessThanOrEqual(usableBottom);
        }
      }
    }
  });

  it('never places the bar above the canvas top', () => {
    for (const selectionTop of [-500, -10, 0, 4]) {
      for (const reservedBottom of [0, 57, 400]) {
        const placement = resolveQuickBarTop({ ...base, selectionTop, reservedBottom });
        expect(placement.top).toBeGreaterThanOrEqual(base.margin);
      }
    }
  });
});
