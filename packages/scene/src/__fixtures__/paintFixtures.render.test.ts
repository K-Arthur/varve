/**
 * Renders paint fixtures through the real engine so its output can be looked at.
 *
 * Playwright cannot drive the desktop WebView on this platform, and a unit test
 * asserting a pixel value does not tell you whether a stroke *looks* like a
 * stroke. These fixtures run the same modules the app runs — the stroke engine,
 * the compositor, the smudge reservoir, the retouch path — and write PNGs, so
 * the result can be inspected rather than assumed.
 *
 * Run with PAINT_FIXTURE_DIR to change where the PNGs land; they default to
 * reports/paint-fixtures, which is gitignored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type {
  BrushDab,
  BrushPreset,
  DabCompositeArg,
  MaskPlane,
  RasterLayerNode,
  SmudgeOptions,
  StrokePoint,
} from '../index';
import {
  appendStrokePoints,
  beginStroke,
  compositeCloneDabOnNode,
  compositeDabOnNode,
  compositeHealDabOnNode,
  compositeMaskDab,
  compositeSmudgeDab,
  createEmptyTile,
  createMaskPlane,
  createSmudgeState,
  defaultBrushPreset,
  featheredRectCoverage,
  makeRasterLayerNode,
  makeTileKey,
  snapshotTiles,
  strokePoint,
  TILE_SIZE,
} from '../index';

const OUT = process.env.PAINT_FIXTURE_DIR ?? 'reports/paint-fixtures';

// ── Minimal PNG encoder (no native canvas needed) ───────────────────────────

function crc32(buf: Uint8Array) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i] ?? 0;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba: Uint8Array, width: number, height: number) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width * 4; x++) {
      raw[y * (width * 4 + 1) + 1 + x] = rgba[y * width * 4 + x] ?? 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Canvas backed by the real tile compositor ───────────────────────────────

const W = 320;
const H = 160;

describe('paint fixtures', () => {
  it('renders every scenario through the real engine', () => {
    mkdirSync(OUT, { recursive: true });

    const blank = () => makeRasterLayerNode('fixture', { width: W, height: H });

    /** Flatten a node's tiles into an RGBA buffer over a checker background. */
    function toRgba(node: RasterLayerNode) {
      const out = Buffer.alloc(W * H * 4);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const checker = ((x >> 3) + (y >> 3)) % 2 === 0 ? 245 : 225;
          out[i] = checker;
          out[i + 1] = checker;
          out[i + 2] = checker;
          out[i + 3] = 255;
          const col = Math.floor(x / TILE_SIZE);
          const row = Math.floor(y / TILE_SIZE);
          const tile = node.tiles.get(makeTileKey(col, row));
          if (!tile) continue;
          const ti = ((y - row * TILE_SIZE) * TILE_SIZE + (x - col * TILE_SIZE)) * 4;
          const a = (tile.pixels[ti + 3] ?? 0) / 255;
          if (a <= 0) continue;
          for (let c = 0; c < 3; c++) {
            out[i + c] = Math.round((tile.pixels[ti + c] ?? 0) * a + (out[i + c] ?? 0) * (1 - a));
          }
        }
      }
      return out;
    }

    function planeToRgba(plane: MaskPlane) {
      const out = Buffer.alloc(W * H * 4);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const v =
            x < plane.width && y < plane.height ? (plane.data[y * plane.width + x] ?? 0) : 0;
          out[i] = v;
          out[i + 1] = v;
          out[i + 2] = v;
          out[i + 3] = 255;
        }
      }
      return out;
    }

    function save(name: string, rgba: Buffer) {
      writeFileSync(join(OUT, `${name}.png`), encodePng(rgba, W, H));
      console.log(`  ${name}.png`);
    }

    /** Points along a sine wave, with an optional pressure ramp. */
    function wave(pressureRamp = false, y0 = H / 2, amp = 34) {
      const pts = [];
      for (let i = 0; i <= 80; i++) {
        const t = i / 80;
        const pressure = pressureRamp ? Math.max(0.05, Math.sin(t * Math.PI)) : 1;
        pts.push(
          strokePoint(20 + t * (W - 40), y0 + Math.sin(t * Math.PI * 2) * amp, {
            pressure,
            time: i * 8,
          }),
        );
      }
      return pts;
    }

    function dabsFor(preset: BrushPreset, points: StrokePoint[], seed = 42): BrushDab[] {
      const state = beginStroke('fx', 0, preset, seed);
      return appendStrokePoints(state, points).dabs;
    }

    function paint(
      preset: BrushPreset,
      points: StrokePoint[],
      color: readonly [number, number, number, number],
      options: DabCompositeArg = false,
      seed = 42,
    ): RasterLayerNode {
      let node = blank();
      for (const dab of dabsFor(preset, points, seed)) {
        node = compositeDabOnNode(node, dab, color, options);
      }
      return node;
    }

    const BLACK: [number, number, number, number] = [20, 20, 24, 255];
    const RED: [number, number, number, number] = [220, 40, 40, 255];
    const BLUE: [number, number, number, number] = [40, 80, 220, 255];

    const base = (o = {}) => ({
      ...defaultBrushPreset('fx', 'FX'),
      radius: 14,
      spacing: 0.1,
      smoothing: 0.3,
      ...o,
    });

    console.log(`Writing fixtures to ${OUT}`);

    save('01-hard-round', toRgba(paint(base({ hardness: 1 }), wave(), BLACK)));
    save('02-soft-round', toRgba(paint(base({ hardness: 0.1 }), wave(), BLACK)));
    save(
      '03-pressure-taper',
      toRgba(
        paint(
          base({
            hardness: 0.9,
            dynamics: [
              { input: 'pressure', target: 'size', curve: [0, 0, 1, 1], min: 0.05, max: 1 },
            ],
          }),
          wave(true),
          BLACK,
        ),
      ),
    );
    save(
      '04-elliptical-tip',
      toRgba(paint(base({ hardness: 1, roundness: 0.3, angle: 0.6 }), wave(), BLACK)),
    );
    save(
      '05-jitter-scatter',
      toRgba(
        paint(
          base({ hardness: 1, radius: 7, positionJitter: 0.9, sizeJitter: 0.6, spacing: 0.35 }),
          wave(),
          BLACK,
        ),
      ),
    );
    save(
      '06-wet-edge',
      toRgba(
        paint(base({ hardness: 1, opacity: 0.55 }), wave(), RED, {
          wetEdge: { size: 0.35, darken: 0.75 },
        }),
      ),
    );

    // Alpha lock: a red band, then a blue stroke that may only touch it.
    {
      let node = blank();
      const band = createEmptyTile();
      node.tiles.set(makeTileKey(0, 0), band);
      node = paint(base({ hardness: 1, radius: 24 }), wave(false, H / 2, 0), RED);
      let locked = node;
      for (const dab of dabsFor(base({ hardness: 1, radius: 18 }), wave(false, H / 2, 40))) {
        locked = compositeDabOnNode(locked, dab, BLUE, { alphaLock: true });
      }
      save('07-alpha-lock', toRgba(locked));
    }

    // Feathered selection.
    {
      const coverage = featheredRectCoverage(40, 40, 240, 80, 30);
      save(
        '08-feathered-selection',
        toRgba(paint(base({ hardness: 1 }), wave(), BLACK, { coverage })),
      );
    }

    // Symmetry: mirror the stroke about the vertical centre line.
    {
      let node = blank();
      const preset = base({ hardness: 0.9 });
      for (const dab of dabsFor(preset, wave(true, H / 2, 30))) {
        node = compositeDabOnNode(node, dab, BLACK);
      }
      for (const dab of dabsFor(
        preset,
        wave(true, H / 2, 30).map((p) => ({ ...p, x: W - p.x })),
        43,
      )) {
        node = compositeDabOnNode(node, dab, BLACK);
      }
      save('09-symmetry-mirror', toRgba(node));
    }

    // Smudge: drag a boundary between two colour fields.
    {
      let node = blank();
      for (const dab of dabsFor(base({ hardness: 1, radius: 40 }), [
        strokePoint(80, 80),
        strokePoint(80, 80),
      ])) {
        node = compositeDabOnNode(node, dab, RED);
      }
      for (const dab of dabsFor(base({ hardness: 1, radius: 40 }), [
        strokePoint(150, 80),
        strokePoint(150, 80),
      ])) {
        node = compositeDabOnNode(node, dab, BLUE);
      }
      const options: SmudgeOptions = {
        mode: 'pure',
        strength: 0.8,
        pickup: 0.4,
        foreground: [0, 200, 0, 255],
      };
      const state = createSmudgeState(options);
      const smudgePreset = base({ hardness: 0.7, radius: 16, spacing: 0.15 });
      for (const dab of dabsFor(smudgePreset, [strokePoint(70, 80), strokePoint(280, 80)])) {
        node = compositeSmudgeDab(node, dab, state, options);
      }
      save('10-smudge-transport', toRgba(node));
    }

    // Smudge dispatched in many small batches, dragged *within* painted area.
    // Pure smudge deliberately will not deposit into transparency, so the
    // meaningful test is whether the smear stays smooth across batch
    // boundaries rather than blotching where spacing would have restarted.
    {
      let node = blank();
      const bandPreset = base({ hardness: 1, radius: 46 });
      for (let x = 20; x <= 300; x += 8) {
        for (const dab of dabsFor(bandPreset, [strokePoint(x, 80), strokePoint(x, 80)])) {
          node = compositeDabOnNode(node, dab, x < 160 ? RED : BLUE);
        }
      }
      const options: SmudgeOptions = {
        mode: 'pure',
        strength: 0.85,
        pickup: 0.35,
        foreground: [0, 200, 0, 255],
      };
      const state = createSmudgeState(options);
      const preset = base({ hardness: 0.7, radius: 14, spacing: 0.12, smoothing: 0 });
      const engine = beginStroke('smudge', 0, preset, 7);
      // Two samples at a time, the way pointer events actually arrive.
      for (let x = 60; x <= 300; x += 6) {
        const batch = appendStrokePoints(engine, [strokePoint(x, 80), strokePoint(x + 3, 80)]);
        for (const dab of batch.dabs) {
          node = compositeSmudgeDab(node, dab, state, options);
        }
      }
      save('15-smudge-batched', toRgba(node));
    }

    // Finger paint on an empty canvas: foreground pigment must appear.
    {
      let node = blank();
      const options: SmudgeOptions = {
        mode: 'fingerPaint',
        strength: 0.8,
        pickup: 0.5,
        foreground: [30, 160, 90, 255],
      };
      const state = createSmudgeState(options);
      for (const dab of dabsFor(base({ hardness: 0.6, radius: 16, spacing: 0.12 }), wave())) {
        node = compositeSmudgeDab(node, dab, state, options);
      }
      save('11-finger-paint', toRgba(node));
    }

    // Clone and heal from a striped source.
    {
      let node = blank();
      for (let x = 20; x < 150; x += 12) {
        for (const dab of dabsFor(base({ hardness: 1, radius: 5 }), [
          strokePoint(x, 30),
          strokePoint(x, 130),
        ])) {
          node = compositeDabOnNode(node, dab, x % 24 === 20 ? RED : BLUE);
        }
      }
      const source = snapshotTiles(node);
      let cloned = node;
      for (const dab of dabsFor(base({ hardness: 0.9, radius: 18, spacing: 0.1 }), [
        strokePoint(200, 80),
        strokePoint(290, 80),
      ])) {
        cloned = compositeCloneDabOnNode(cloned, dab, {
          sourceTiles: source,
          offsetX: 140,
          offsetY: 0,
        });
      }
      save('12-clone-stamp', toRgba(cloned));

      let healed = node;
      for (const dab of dabsFor(base({ hardness: 0.9, radius: 18, spacing: 0.1 }), [
        strokePoint(200, 80),
        strokePoint(290, 80),
      ])) {
        healed = compositeHealDabOnNode(healed, dab, {
          sourceTiles: source,
          offsetX: 140,
          offsetY: 0,
        });
      }
      save('13-healing-brush', toRgba(healed));
    }

    // Mask painting: white plane, black brush conceals.
    {
      const plane = createMaskPlane(W, H, 255);
      for (const dab of dabsFor(base({ hardness: 0.3, radius: 18 }), wave(true))) {
        compositeMaskDab(plane, dab, { value: 0 });
      }
      save('14-mask-paint', planeToRgba(plane));
    }

    expect(true).toBe(true);
  });
});
