import { describe, expect, it } from 'vitest';
import {
  type GapReadoutBox,
  MAX_GAP_READOUT_PLACEMENTS,
  placeGapReadout,
} from './gapReadoutPlacement';

const overlaps = (a: GapReadoutBox, b: GapReadoutBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('gap readout placement', () => {
  it('spreads the overlapping import readouts without changing their handles or baseline', () => {
    const occupied: GapReadoutBox[] = [];
    const preferred = [
      { x: 379, y: 287, text: '15.5px' },
      { x: 415, y: 290, text: '90.5px' },
      { x: 409, y: 257.5, text: '9.5px' },
      { x: 410, y: 292, text: '-54px' },
    ];
    const placed = preferred.map((readout) => {
      const next = placeGapReadout(readout, occupied, { width: 740, height: 521 });
      occupied.push(next.box);
      return next;
    });
    expect(placed.map((readout) => readout.y)).toEqual(preferred.map((readout) => readout.y));
    expect(placed.some((readout) => readout.shifted)).toBe(true);
    expect(
      occupied.some((box, index) =>
        occupied.slice(index + 1).some((other) => overlaps(box, other)),
      ),
    ).toBe(false);
  });

  it('wraps readouts at a compact canvas edge while preserving every value', () => {
    const occupied: GapReadoutBox[] = [];
    const placed = Array.from({ length: 12 }, (_, index) => {
      const readout = placeGapReadout({ x: 150, y: 50, text: `${index - 100}.25px` }, occupied, {
        width: 160,
        height: 320,
      });
      occupied.push(readout.box);
      return readout;
    });
    expect(new Set(placed.map((readout) => readout.y)).size).toBeGreaterThan(1);
    expect(
      occupied.every((box) => box.x >= 8 && box.x + box.w <= 152 && box.y + box.h <= 312),
    ).toBe(true);
    expect(
      occupied.some((box, index) =>
        occupied.slice(index + 1).some((other) => overlaps(box, other)),
      ),
    ).toBe(false);
  });

  it('keeps off-screen values at their original position instead of piling them on an edge', () => {
    const readout = placeGapReadout({ x: -500, y: -500, text: '50px' }, [], {
      width: 740,
      height: 521,
    });
    expect(readout).toMatchObject({ x: -500, y: -500, shifted: false, reserve: false });
  });

  it('bounds collision work in mass selection while retaining the value', () => {
    const occupied = Array.from({ length: MAX_GAP_READOUT_PLACEMENTS }, () => ({
      x: 0,
      y: 0,
      w: 740,
      h: 521,
    }));
    const readout = placeGapReadout({ x: 400, y: 300, text: '-20px' }, occupied, {
      width: 740,
      height: 521,
    });
    expect(readout).toMatchObject({ x: 400, y: 300, shifted: false, reserve: false });
  });
});
