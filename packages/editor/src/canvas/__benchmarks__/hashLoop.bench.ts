// @vitest-environment jsdom
/**
 * Per-frame hash-loop regression bench.
 *
 * The existing renderPath.bench.ts uses only synthetic rect nodes and measures
 * replay cost — it has NO image scene and does not exercise the per-node content
 * hash loop (cacheContentParts + nodeHash). That blind spot is exactly why the
 * full-image-src hashing regression (hashing multi-MB data URLs every frame)
 * landed silently: it cost ~11-13ms/frame yet showed up in no benchmark and in
 * no diagnostics counter (it sits outside buildIrMs).
 *
 * This bench closes the gap with:
 *   1. A DETERMINISTIC, non-flaky guard: the hash cost of an image node must be
 *      O(1) in image byte size — a 4MB image and a 4KB image produce
 *      bounded-and-comparable content parts. This is the regression assertion.
 *   2. Informational per-frame timing across scene types (rects / complex /
 *      image-heavy) so future regressions in the hash loop are visible in CI logs.
 *
 * Run: pnpm vitest run packages/editor/src/canvas/__benchmarks__/hashLoop.bench.ts
 */

import type { SceneNode as EngineNode } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { cacheContentParts, SubtreeIrCache } from '../subtreeIrCache';

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] ?? 0;
}
function summarize(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return { p50: pct(s, 50), p95: pct(s, 95) };
}

function rectNode(i: number): EngineNode {
  return {
    id: `n-${i}`,
    name: `Rect ${i}`,
    kind: 'shape',
    transform: [1, 0, 0, 1, (i % 40) * 24, Math.floor(i / 40) * 24],
    shape: { kind: 'rect', x: 0, y: 0, w: 20, h: 16 },
    fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
    opacity: 1,
    blendMode: 'normal',
  } as unknown as EngineNode;
}

function complexNode(i: number): EngineNode {
  return {
    id: `n-${i}`,
    name: `Complex ${i}`,
    kind: 'shape',
    transform: [1, 0, 0, 1, (i % 40) * 24, Math.floor(i / 40) * 24],
    shape: { kind: 'rect', x: 0, y: 0, w: 120, h: 80 },
    fills: [
      { kind: 'solid', color: { space: 'rgb', r: 20, g: 30, b: 40, a: 255 } },
      {
        kind: 'gradient',
        gradientType: 'linear',
        stops: [
          { offset: 0, color: { space: 'rgb', r: 1, g: 2, b: 3, a: 255 } },
          { offset: 1, color: { space: 'rgb', r: 4, g: 5, b: 6, a: 255 } },
        ],
      },
    ],
    strokes: [{ kind: 'solid', width: 2, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } }],
    effects: [
      {
        type: 'drop-shadow',
        dx: 2,
        dy: 2,
        blur: 8,
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
      },
      { type: 'blur', radius: 4 },
    ],
    opacity: 0.9,
    blendMode: 'normal',
    cornerRadius: 8,
  } as unknown as EngineNode;
}

function imageNode(i: number, srcBytes: number): EngineNode {
  const src = `data:image/png;base64,${'ABCDefgh'.repeat(Math.ceil(srcBytes / 8))}`;
  return {
    id: `img-${i}`,
    name: `Image ${i}`,
    kind: 'image',
    transform: [1, 0, 0, 1, (i % 8) * 220, Math.floor(i / 8) * 160],
    shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 140 },
    src,
    fills: [{ kind: 'image', src, fit: 'fill', assetId: `asset_${i}` }],
    opacity: 1,
    blendMode: 'normal',
  } as unknown as EngineNode;
}

/** One frame of the hash loop exactly as CanvasArea.drawContent runs it. */
function hashFrame(nodes: EngineNode[]): void {
  for (const n of nodes) {
    const parts = cacheContentParts(n).parts;
    SubtreeIrCache.nodeHash(n.id, n.transform, '', parts);
  }
}

function timeFrames(nodes: EngineNode[], frames: number): { p50: number; p95: number } {
  hashFrame(nodes); // warm
  hashFrame(nodes);
  const samples: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    hashFrame(nodes);
    samples.push(performance.now() - t0);
  }
  return summarize(samples);
}

describe('hash-loop regression bench', () => {
  // ── The deterministic guard (this is what actually gates) ────────────────
  it('image-node hash cost is O(1) in image byte size (no per-frame MB hashing)', () => {
    const small = cacheContentParts(imageNode(0, 4_000)).parts.join('|');
    const large = cacheContentParts(imageNode(0, 4_000_000)).parts.join('|'); // ~1000x bytes
    // A 1000x-larger image must NOT produce a ~1000x-larger hash payload. Bound
    // it hard: the fingerprint is fixed-size, so both stay tiny and comparable.
    expect(small.length).toBeLessThan(2048);
    expect(large.length).toBeLessThan(2048);
    // Distinct-size images still differ (no false cache hits), and same image is
    // stable (cache hits keep working).
    const hA = SubtreeIrCache.nodeHash('x', [1, 0, 0, 1, 0, 0], '', [large]);
    const hB = SubtreeIrCache.nodeHash('x', [1, 0, 0, 1, 0, 0], '', [large]);
    const hC = SubtreeIrCache.nodeHash('x', [1, 0, 0, 1, 0, 0], '', [small]);
    expect(hA).toBe(hB);
    expect(hA).not.toBe(hC);
  });

  // ── Informational timing (logged, not asserted — machine-speed dependent) ──
  it('logs per-frame hash-loop cost across scene types', () => {
    const scenes: Array<{ label: string; nodes: EngineNode[] }> = [
      { label: 'rects x100', nodes: Array.from({ length: 100 }, (_, i) => rectNode(i)) },
      { label: 'rects x1000', nodes: Array.from({ length: 1000 }, (_, i) => rectNode(i)) },
      { label: 'complex x1000', nodes: Array.from({ length: 1000 }, (_, i) => complexNode(i)) },
      {
        label: 'image x8 (2MB ea)',
        nodes: Array.from({ length: 8 }, (_, i) => imageNode(i, 2_000_000)),
      },
    ];
    for (const s of scenes) {
      const r = timeFrames(s.nodes, 20);
      console.log(
        `[hash-loop] ${s.label.padEnd(20)} p50=${r.p50.toFixed(3)}ms p95=${r.p95.toFixed(3)}ms`,
      );
    }
    expect(true).toBe(true);
  }, 60_000);
});
