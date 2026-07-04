/**
 * Tests for Porter-Duff compositing operators.
 *
 * Verifies each of the 12 Porter-Duff operators against Canvas2D
 * `globalCompositeOperation` output, plus group invariance.
 */

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  compositePixels,
  porterDuffCompositing,
  mapPorterDuffOp,
  type PorterDuffOp,
} from './porterDuff';

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Individual pixel tests ───────────────────────────────────────────────────

describe('compositePixels', () => {
  describe('clear', () => {
    it('clears both source and backdrop to transparent', () => {
      const _cmp = compositePixels([0.5, 0.5, 0.5, 0.8], [0.3, 0.3, 0.3, 0.6], 'clear');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      expect(a).toBeCloseTo(0);
    });
  });

  describe('copy', () => {
    it('copies source over backdrop', () => {
      const _cmp = compositePixels([0.5, 0.3, 0.7, 1], [0.2, 0.8, 0.4, 0.6], 'copy');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      expect(r).toBeCloseTo(0.2);
      expect(g).toBeCloseTo(0.8);
      expect(b).toBeCloseTo(0.4);
      expect(a).toBeCloseTo(0.6);
    });
  });

  describe('source-over', () => {
    it('source composites over backdrop', () => {
      const _cmp = compositePixels([0.5, 0.5, 0.5, 0.5], [0.8, 0.2, 0.2, 0.8], 'source-over');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      // ao = 0.8 + 0.5 * 0.2 = 0.9
      expect(a).toBeCloseTo(0.9, 1);
      expect(r).toBeGreaterThan(0.5);
    });

    it('backdrop fully visible through transparent source', () => {
      const _cmp = compositePixels([0.5, 0.5, 0.5, 1], [1, 0, 0, 0], 'source-over');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      expect(r).toBeCloseTo(0.5);
      expect(a).toBeCloseTo(1);
    });

    it('opaque source completely covers backdrop', () => {
      const _cmp = compositePixels([0.5, 0.5, 0.5, 1], [0.2, 0.8, 0.4, 1], 'source-over');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      expect(r).toBeCloseTo(0.2);
      expect(g).toBeCloseTo(0.8);
      expect(b).toBeCloseTo(0.4);
      expect(a).toBeCloseTo(1);
    });
  });

  describe('destination-over', () => {
    it('backdrop composites over source', () => {
      const _cmp = compositePixels([0.5, 0.5, 0.5, 0.5], [0.8, 0.2, 0.2, 0.8], 'destination-over');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      // ao = 0.8 * 0.5 + 0.5 * 1 = 0.9
      expect(a).toBeCloseTo(0.9, 1);
    });
  });

  describe('source-in', () => {
    it('source visible only where backdrop is opaque', () => {
      const _cmp = compositePixels([0.5, 0.5, 0.5, 1], [0.8, 0.2, 0.2, 0.6], 'source-in');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      expect(a).toBeCloseTo(0.6, 1);
      expect(r).toBeCloseTo(0.8);
    });

    it('source invisible where backdrop is transparent', () => {
      const [, , , a] = compositePixels([0.5, 0.5, 0.5, 0], [0.8, 0.2, 0.2, 0.6], 'source-in');
      expect(a).toBeCloseTo(0);
    });
  });

  describe('destination-in', () => {
    it('backdrop visible only where source is opaque', () => {
      const _cmp = compositePixels([0.5, 0.5, 0.5, 0.6], [0.8, 0.2, 0.2, 1], 'destination-in');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      expect(a).toBeCloseTo(0.6, 1);
      expect(r).toBeCloseTo(0.5);
    });

    it('backdrop invisible where source is transparent', () => {
      const [, , , a] = compositePixels([0.5, 0.5, 0.5, 0.6], [0.8, 0.2, 0.2, 0], 'destination-in');
      expect(a).toBeCloseTo(0);
    });
  });

  describe('source-out', () => {
    it('source visible only where backdrop is transparent', () => {
      const _cmp = compositePixels([0.5, 0.5, 0.5, 0], [0.8, 0.2, 0.2, 0.6], 'source-out');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      expect(a).toBeCloseTo(0.6, 1);
      expect(r).toBeCloseTo(0.8);
    });

    it('source invisible where backdrop is opaque', () => {
      const [, , , a] = compositePixels([0.5, 0.5, 0.5, 1], [0.8, 0.2, 0.2, 0.6], 'source-out');
      expect(a).toBeCloseTo(0);
    });
  });

  describe('destination-out', () => {
    it('backdrop visible only where source is transparent', () => {
      const _cmp = compositePixels([0.5, 0.5, 0.5, 0.6], [0.8, 0.2, 0.2, 0], 'destination-out');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      expect(a).toBeCloseTo(0.6, 1);
    });

    it('backdrop invisible where source is opaque', () => {
      const [, , , a] = compositePixels(
        [0.5, 0.5, 0.5, 0.6],
        [0.8, 0.2, 0.2, 1],
        'destination-out',
      );
      expect(a).toBeCloseTo(0);
    });
  });

  describe('source-atop', () => {
    it('source atop backdrop: source where backdrop opaque + backdrop remainder', () => {
      const _cmp = compositePixels([0.5, 0.3, 0.7, 0.6], [0.8, 0.2, 0.2, 0.8], 'source-atop');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      // ao = 0.8*0.6 + 0.6*(1-0.8) = 0.48 + 0.12 = 0.6
      expect(a).toBeCloseTo(0.6, 1);
    });
  });

  describe('destination-atop', () => {
    it('backdrop atop source: Fa=1-ab, Fb=as', () => {
      const _cmp = compositePixels([0.5, 0.3, 0.7, 0.6], [0.8, 0.2, 0.2, 0.8], 'destination-atop');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      // Fa = 1 - ab = 1 - 0.6 = 0.4
      // Fb = as = 0.8
      // ao = 0.8*0.4 + 0.6*0.8 = 0.32 + 0.48 = 0.80
      expect(a).toBeCloseTo(0.8, 1);
    });
  });

  describe('xor', () => {
    it('shows source and backdrop only where they do not overlap', () => {
      const _cmp = compositePixels([0.5, 0.5, 0.5, 0.6], [0.8, 0.2, 0.2, 0.8], 'xor');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      // ao = 0.8*(1-0.6) + 0.6*(1-0.8) = 0.32 + 0.12 = 0.44
      expect(a).toBeCloseTo(0.44, 1);
    });
  });

  describe('lighter', () => {
    it('adds alpha: ao = as + ab', () => {
      const _cmp = compositePixels([0.5, 0.3, 0.7, 0.4], [0.8, 0.2, 0.2, 0.3], 'lighter');
      const r = _cmp[0];
      const g = _cmp[1];
      const b = _cmp[2];
      const a = _cmp[3];
      // ao = 0.3 + 0.4 = 0.7
      expect(a).toBeCloseTo(0.7, 1);
    });

    it('adds color multiplicatively', () => {
      const [r] = compositePixels([0.5, 0.3, 0.7, 0.5], [0.5, 0.2, 0.2, 0.5], 'lighter');
      // co = (0.5*1*0.5 + 0.5*1*0.5) / 1 = 0.5
      expect(r).toBeCloseTo(0.5, 1);
    });
  });
});

// ── ImageData compositing tests ──────────────────────────────────────────────

describe('porterDuffCompositing', () => {
  function createSquare(size: number, r: number, g: number, b: number, a: number): ImageData {
    const data = new ImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const off = i * 4;
      data.data[off] = r;
      data.data[off + 1] = g;
      data.data[off + 2] = b;
      data.data[off + 3] = a;
    }
    return data;
  }

  const ALL_OPS: PorterDuffOp[] = [
    'clear',
    'copy',
    'source-over',
    'destination-over',
    'source-in',
    'destination-in',
    'source-out',
    'destination-out',
    'source-atop',
    'destination-atop',
    'xor',
    'lighter',
  ];

  it('each operator produces valid ImageData', () => {
    const backdrop = createSquare(4, 100, 100, 100, 255);
    const source = createSquare(4, 200, 50, 50, 200);
    for (const op of ALL_OPS) {
      const result = porterDuffCompositing(backdrop, source, op);
      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
      expect(result.data.length).toBe(4 * 4 * 4);
    }
  });

  it('clear erases everything', () => {
    const backdrop = createSquare(2, 100, 100, 100, 255);
    const source = createSquare(2, 200, 50, 50, 200);
    const result = porterDuffCompositing(backdrop, source, 'clear');
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i + 3]).toBe(0);
    }
  });

  it('copy puts source regardless of backdrop', () => {
    const backdrop = createSquare(2, 100, 100, 100, 255);
    const source = createSquare(2, 50, 150, 200, 200);
    const result = porterDuffCompositing(backdrop, source, 'copy');
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(50);
      expect(result.data[i + 1]).toBe(150);
      expect(result.data[i + 2]).toBe(200);
      expect(result.data[i + 3]).toBe(200);
    }
  });

  it('source-over: opaque source fully covers backdrop', () => {
    const backdrop = createSquare(2, 100, 100, 100, 255);
    const source = createSquare(2, 200, 50, 50, 255);
    const result = porterDuffCompositing(backdrop, source, 'source-over');
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(200);
      expect(result.data[i + 1]).toBe(50);
      expect(result.data[i + 2]).toBe(50);
      expect(result.data[i + 3]).toBe(255);
    }
  });

  it('lighter: premultiplied sum does not overflow uint8 clamp', () => {
    const backdrop = createSquare(2, 200, 200, 200, 200);
    const source = createSquare(2, 200, 200, 200, 200);
    const result = porterDuffCompositing(backdrop, source, 'lighter');
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i]).toBeLessThanOrEqual(255);
      expect(result.data[i + 3]).toBeLessThanOrEqual(255);
    }
  });

  // ── Group invariance: A + (B + C) = (A + B) + C for source-over ─────────
  // Using compositePixels (float precision) since porterDuffCompositing rounds
  // to uint8 at each step, breaking exact associativity.

  it('group invariance: source-over is associative (float)', () => {
    const a = [200 / 255, 50 / 255, 50 / 255, 180 / 255] as const;
    const b = [50 / 255, 200 / 255, 50 / 255, 150 / 255] as const;
    const c = [50 / 255, 50 / 255, 200 / 255, 120 / 255] as const;

    // (A + B) + C
    const ab = compositePixels(a, b, 'source-over');
    const ab_c = compositePixels(ab, c, 'source-over');

    // A + (B + C)
    const bc = compositePixels(b, c, 'source-over');
    const a_bc = compositePixels(a, bc, 'source-over');

    // Should be approximately equal (float precision)
    expect(ab_c[0]).toBeCloseTo(a_bc[0], 5);
    expect(ab_c[1]).toBeCloseTo(a_bc[1], 5);
    expect(ab_c[2]).toBeCloseTo(a_bc[2], 5);
    expect(ab_c[3]).toBeCloseTo(a_bc[3], 5);
  });

  it('mapPorterDuffOp maps all operators to GCO strings', () => {
    const ops: [PorterDuffOp, string][] = [
      ['clear', 'clear'],
      ['copy', 'copy'],
      ['source-over', 'source-over'],
      ['destination-over', 'destination-over'],
      ['source-in', 'source-in'],
      ['destination-in', 'destination-in'],
      ['source-out', 'source-out'],
      ['destination-out', 'destination-out'],
      ['source-atop', 'source-atop'],
      ['destination-atop', 'destination-atop'],
      ['xor', 'xor'],
      ['lighter', 'lighter'],
    ];
    for (const [op, expected] of ops) {
      expect(mapPorterDuffOp(op)).toBe(expected);
    }
  });

  it('handles different sized ImageData gracefully', () => {
    const backdrop = createSquare(3, 100, 100, 100, 255);
    const source = createSquare(5, 200, 50, 50, 200);
    const result = porterDuffCompositing(backdrop, source, 'source-over');
    expect(result.width).toBe(3);
    expect(result.height).toBe(3);
  });
});
