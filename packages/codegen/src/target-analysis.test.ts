/**
 * Tests for targetGaps() functions and target-analysis module.
 */

import {
  addNode,
  createDocument,
  makeFrameNode,
  makeImageNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { cssTargetGaps } from './css';
import { cssModulesTargetGaps } from './css-modules';
import { flutterTargetGaps } from './flutter';
import { svgTargetGaps } from './svg';
import { swiftuiTargetGaps } from './swiftui';
import { tailwindTargetGaps } from './tailwind';
import { analyseDocument, analyseNode, isCodeExportFormat } from './target-analysis';

// ─── helpers ────────────────────────────────────────────────────────────────

function doc() {
  return createDocument();
}

function rectNode() {
  let d = doc();
  const { id, doc: d2 } = nextNodeId(d);
  d = d2;
  const node = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 100, h: 50 });
  d = addNode(d, node);
  return { node, doc: d };
}

function imageNode() {
  let d = doc();
  const { id, doc: d2 } = nextNodeId(d);
  d = d2;
  const node = makeImageNode(id, { src: 'data:image/png;base64,abc', w: 100, h: 100 });
  d = addNode(d, node);
  return { node, doc: d };
}

function gradientShapeNode() {
  let d = doc();
  const { id, doc: d2 } = nextNodeId(d);
  d = d2;
  const base = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 100, h: 50 });
  const node = {
    ...base,
    fills: [
      {
        type: 'gradient' as const,
        color: base.fill,
        opacity: 1,
        blendMode: 'normal' as const,
        gradient: {
          type: 'linear' as const,
          stops: [
            { offset: 0, color: base.fill },
            { offset: 1, color: base.fill },
          ],
          angle: 0,
        },
      },
    ],
  };
  d = addNode(d, node);
  return { node, doc: d };
}

function blurShapeNode() {
  let d = doc();
  const { id, doc: d2 } = nextNodeId(d);
  d = d2;
  const base = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 100, h: 50 });
  const node = {
    ...base,
    effects: [{ type: 'layerBlur' as const, radius: 8, visible: true }],
  };
  d = addNode(d, node);
  return { node, doc: d };
}

function polygonNode() {
  let d = doc();
  const { id, doc: d2 } = nextNodeId(d);
  d = d2;
  const node = makeShapeNode(id, { kind: 'polygon', sides: 5, x: 0, y: 0, w: 100, h: 100 });
  d = addNode(d, node);
  return { node, doc: d };
}

// ─── tailwindTargetGaps ─────────────────────────────────────────────────────

describe('tailwindTargetGaps', () => {
  it('returns no gaps for a plain rect', () => {
    const { node, doc: d } = rectNode();
    expect(tailwindTargetGaps(node, d)).toHaveLength(0);
  });

  it('warns for an image node', () => {
    const { node, doc: d } = imageNode();
    const gaps = tailwindTargetGaps(node, d);
    expect(gaps.some((g) => g.feature.includes('image'))).toBe(true);
  });

  it('warns for a gradient fill', () => {
    const { node, doc: d } = gradientShapeNode();
    const gaps = tailwindTargetGaps(node, d);
    expect(gaps.some((g) => g.feature.includes('gradient'))).toBe(true);
  });

  it('warns for a non-rect shape', () => {
    const { node, doc: d } = polygonNode();
    const gaps = tailwindTargetGaps(node, d);
    expect(gaps.some((g) => g.feature.includes('polygon'))).toBe(true);
  });

  it('warns for a blur effect', () => {
    const { node, doc: d } = blurShapeNode();
    const gaps = tailwindTargetGaps(node, d);
    expect(gaps.some((g) => g.feature.includes('blur'))).toBe(true);
  });
});

// ─── cssTargetGaps ──────────────────────────────────────────────────────────

describe('cssTargetGaps', () => {
  it('returns no gaps for a plain rect', () => {
    const { node, doc: d } = rectNode();
    expect(cssTargetGaps(node, d)).toHaveLength(0);
  });

  it('warns for an image node', () => {
    const { node, doc: d } = imageNode();
    const gaps = cssTargetGaps(node, d);
    expect(gaps.some((g) => g.feature.includes('image'))).toBe(true);
  });

  it('warns for a non-rect shape', () => {
    const { node, doc: d } = polygonNode();
    const gaps = cssTargetGaps(node, d);
    expect(gaps.some((g) => g.feature.includes('polygon'))).toBe(true);
  });
});

// ─── cssModulesTargetGaps ───────────────────────────────────────────────────

describe('cssModulesTargetGaps', () => {
  it('delegates to cssTargetGaps — same results', () => {
    const { node, doc: d } = imageNode();
    expect(cssModulesTargetGaps(node, d)).toEqual(cssTargetGaps(node, d));
  });
});

// ─── flutterTargetGaps ──────────────────────────────────────────────────────

describe('flutterTargetGaps', () => {
  it('returns no gaps for a plain rect', () => {
    const { node, doc: d } = rectNode();
    expect(flutterTargetGaps(node, d)).toHaveLength(0);
  });

  it('warns for an image node', () => {
    const { node, doc: d } = imageNode();
    const gaps = flutterTargetGaps(node, d);
    expect(gaps.some((g) => g.feature.includes('image'))).toBe(true);
  });

  it('errors for a non-standard shape', () => {
    const { node, doc: d } = polygonNode();
    const gaps = flutterTargetGaps(node, d);
    expect(gaps.some((g) => g.severity === 'error')).toBe(true);
  });

  it('warns for a gradient fill', () => {
    const { node, doc: d } = gradientShapeNode();
    const gaps = flutterTargetGaps(node, d);
    expect(gaps.some((g) => g.feature.includes('gradient'))).toBe(true);
  });
});

// ─── swiftuiTargetGaps ──────────────────────────────────────────────────────

describe('swiftuiTargetGaps', () => {
  it('returns no gaps for a plain rect', () => {
    const { node, doc: d } = rectNode();
    expect(swiftuiTargetGaps(node, d)).toHaveLength(0);
  });

  it('warns for an image node', () => {
    const { node, doc: d } = imageNode();
    const gaps = swiftuiTargetGaps(node, d);
    expect(gaps.some((g) => g.feature.includes('image'))).toBe(true);
  });

  it('warns for a gradient fill', () => {
    const { node, doc: d } = gradientShapeNode();
    const gaps = swiftuiTargetGaps(node, d);
    expect(gaps.some((g) => g.feature.includes('gradient'))).toBe(true);
  });
});

// ─── svgTargetGaps ──────────────────────────────────────────────────────────

describe('svgTargetGaps', () => {
  it('returns no gaps for a plain rect', () => {
    const { node, doc: d } = rectNode();
    expect(svgTargetGaps(node, d)).toHaveLength(0);
  });

  it('warns for an image node (embed needed for portability)', () => {
    const { node, doc: d } = imageNode();
    const gaps = svgTargetGaps(node, d);
    expect(gaps.some((g) => g.severity === 'warning')).toBe(true);
  });
});

// ─── analyseDocument ────────────────────────────────────────────────────────

describe('analyseDocument', () => {
  it('returns zero gaps for a document with only plain rects', () => {
    const { doc: d } = rectNode();
    const result = analyseDocument(d, 'react-tailwind');
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it('counts warnings for image nodes', () => {
    const { doc: d } = imageNode();
    const result = analyseDocument(d, 'react-tailwind');
    expect(result.warningCount).toBeGreaterThan(0);
  });

  it('counts errors for flutter + polygon', () => {
    const { doc: d } = polygonNode();
    const result = analyseDocument(d, 'flutter');
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('returns the requested format in the result', () => {
    const { doc: d } = rectNode();
    const result = analyseDocument(d, 'swiftui');
    expect(result.format).toBe('swiftui');
  });
});

// ─── analyseNode ────────────────────────────────────────────────────────────

describe('analyseNode', () => {
  it('returns gaps for a single node', () => {
    const { node, doc: d } = imageNode();
    const gaps = analyseNode(node, d, 'flutter');
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0].nodeId).toBe(node.id);
  });
});

// ─── isCodeExportFormat ─────────────────────────────────────────────────────

describe('isCodeExportFormat', () => {
  it('recognises code formats', () => {
    expect(isCodeExportFormat('react-tailwind')).toBe(true);
    expect(isCodeExportFormat('flutter')).toBe(true);
    expect(isCodeExportFormat('swiftui')).toBe(true);
    expect(isCodeExportFormat('svg')).toBe(true);
    expect(isCodeExportFormat('css')).toBe(true);
  });

  it('rejects raster and print formats', () => {
    expect(isCodeExportFormat('png')).toBe(false);
    expect(isCodeExportFormat('pdf-x1a')).toBe(false);
    expect(isCodeExportFormat('jpg')).toBe(false);
  });
});
