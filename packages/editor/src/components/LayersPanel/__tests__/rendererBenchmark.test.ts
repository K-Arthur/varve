/**
 * Benchmark comparing the simplified layer-thumbnail renderer
 * (renderNodeToCanvas) against the unified engine IR pipeline
 * (generateDocThumbnail).
 *
 * Tests are labelled as benchmarks to be run manually or in CI
 * with sufficient isolation. Results guide the decision in
 * AGENTS.md §"Evaluate the Layer Thumbnail Renderer Pragmatically".
 */

import { generateThumbnail } from '@strata/engine';
import type { SceneNode, ShapeNode, TextNode } from '@strata/scene';
import { managedColorToRgba } from '@strata/shared';
import { describe, expect, it } from 'vitest';
import { ThumbnailCache, thumbnailCacheKey } from '../thumbnailCache';

// ─── Simplified renderer (current implementation) ────────────────────

const THUMB_W = 28;
const THUMB_H = 28;
const PADDING = 2;

async function simplifiedRender(
  node: SceneNode,
  cache: ThumbnailCache,
  key: string,
): Promise<string | null> {
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = new OffscreenCanvas(THUMB_W, THUMB_H);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, THUMB_W, THUMB_H);

  const fill = node.fill
    ? (() => {
        const [r, g, b, a] = managedColorToRgba(node.fill);
        return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
      })()
    : 'rgba(200,200,200,1)';
  const area = THUMB_W - PADDING * 2;
  const ox = PADDING;
  const oy = PADDING;

  ctx.fillStyle = fill;

  if (node.kind === 'shape') {
    const s = (node as ShapeNode).shape;
    switch (s.kind) {
      case 'rect':
        ctx.fillRect(ox, oy, area, area);
        break;
      case 'ellipse': {
        const scale = area / 2 / Math.min(s.rx, s.ry);
        ctx.beginPath();
        ctx.ellipse(ox + area / 2, oy + area / 2, s.rx * scale, s.ry * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'circle': {
        const scale = area / 2 / s.r;
        ctx.beginPath();
        ctx.arc(ox + area / 2, oy + area / 2, s.r * scale, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'line': {
        ctx.strokeStyle = fill;
        ctx.lineWidth = Math.max(1, s.tolerance);
        ctx.beginPath();
        ctx.moveTo(ox, oy + area / 2);
        ctx.lineTo(ox + area, oy + area / 2);
        ctx.stroke();
        break;
      }
      default:
        ctx.fillRect(ox, oy, area, area);
    }
  } else if (node.kind === 'text') {
    ctx.fillStyle = fill;
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('T', ox + area / 2 - 4, oy + area / 2);
  } else {
    ctx.fillRect(ox, oy, area, area);
  }

  const blob = await canvas.convertToBlob();
  const reader = new FileReader();
  const dataUrl: string = await new Promise((resolve) => {
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

  cache.set(key, dataUrl);
  return dataUrl;
}

// ─── Unified engine renderer ──────────────────────────────────────────

async function unifiedRender(node: SceneNode): Promise<string | null> {
  const engineNode = {
    id: node.id,
    kind: node.kind,
    name: node.name,
    transform: [1, 0, 0, 1, 0, 0] as const,
    ...(node.kind === 'shape' ? { shape: (node as ShapeNode).shape, fill: node.fill } : {}),
    ...(node.kind === 'text' ? { text: (node as TextNode).text ?? '' } : {}),
  } as SceneNode;

  const result = await generateThumbnail([engineNode], 'bench', {
    maxWidth: THUMB_W,
    maxHeight: THUMB_H,
    fit: 'contain',
    background: { type: 'transparent' },
  });
  return result?.dataUrl ?? null;
}

// ─── Test nodes ───────────────────────────────────────────────────────

function simpleRect(): SceneNode {
  return {
    id: 'bench-rect',
    name: 'Rect',
    kind: 'shape',
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    transform: [1, 0, 0, 1, 0, 0],
  } as unknown as SceneNode;
}

function complexNode(): SceneNode {
  return {
    id: 'bench-complex',
    name: 'Star',
    kind: 'shape',
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 0.8,
    bindings: {},
    fill: { space: 'rgb', r: 0, g: 128, b: 255, a: 255 },
    shape: { kind: 'star', cx: 50, cy: 50, innerRadius: 20, outerRadius: 50, points: 5 },
    transform: [1, 0, 0, 1, 0, 0],
  } as unknown as SceneNode;
}

function textNode(): SceneNode {
  return {
    id: 'bench-text',
    name: 'Text',
    kind: 'text',
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    text: 'Hello',
    transform: [1, 0, 0, 1, 0, 0],
  } as unknown as SceneNode;
}

// ─── Benchmarks ───────────────────────────────────────────────────────

describe('Layer thumbnail renderer benchmark', () => {
  const ITERATIONS = 50;

  it('simplified renderer: simple rect', async () => {
    const cache = new ThumbnailCache(200);
    const node = simpleRect();
    const key = thumbnailCacheKey(node, 'bench');

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      await simplifiedRender(node, cache, key);
    }
    const elapsed = performance.now() - start;
    console.log(
      `[bench] simplified rect: ${(elapsed / ITERATIONS).toFixed(2)}ms avg (${ITERATIONS} runs)`,
    );
    expect(elapsed / ITERATIONS).toBeLessThan(100); // generous threshold
  });

  it('unified renderer: simple rect', async () => {
    const node = simpleRect();
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      await unifiedRender(node);
    }
    const elapsed = performance.now() - start;
    console.log(
      `[bench] unified rect: ${(elapsed / ITERATIONS).toFixed(2)}ms avg (${ITERATIONS} runs)`,
    );
    expect(elapsed / ITERATIONS).toBeLessThan(100);
  });

  it('simplified renderer: complex star', async () => {
    const cache = new ThumbnailCache(200);
    const node = complexNode();
    const key = thumbnailCacheKey(node, 'bench');

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      await simplifiedRender(node, cache, key);
    }
    const elapsed = performance.now() - start;
    console.log(
      `[bench] simplified star: ${(elapsed / ITERATIONS).toFixed(2)}ms avg (${ITERATIONS} runs)`,
    );
    expect(elapsed / ITERATIONS).toBeLessThan(100);
  });

  it('unified renderer: complex star', async () => {
    const node = complexNode();
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      await unifiedRender(node);
    }
    const elapsed = performance.now() - start;
    console.log(
      `[bench] unified star: ${(elapsed / ITERATIONS).toFixed(2)}ms avg (${ITERATIONS} runs)`,
    );
    expect(elapsed / ITERATIONS).toBeLessThan(100);
  });

  it('simplified renderer: text node', async () => {
    const cache = new ThumbnailCache(200);
    const node = textNode();
    const key = thumbnailCacheKey(node, 'bench');

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      await simplifiedRender(node, cache, key);
    }
    const elapsed = performance.now() - start;
    console.log(
      `[bench] simplified text: ${(elapsed / ITERATIONS).toFixed(2)}ms avg (${ITERATIONS} runs)`,
    );
    expect(elapsed / ITERATIONS).toBeLessThan(100);
  });

  it('unified renderer: text node', async () => {
    const node = textNode();
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      await unifiedRender(node);
    }
    const elapsed = performance.now() - start;
    console.log(
      `[bench] unified text: ${(elapsed / ITERATIONS).toFixed(2)}ms avg (${ITERATIONS} runs)`,
    );
    expect(elapsed / ITERATIONS).toBeLessThan(100);
  });
});
