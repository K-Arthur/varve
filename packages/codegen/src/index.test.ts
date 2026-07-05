import type { Document } from '@strata/scene';
import { addNode, createDocument, makeShapeNode, makeTextNode, nextNodeId } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import {
  computeDocumentBounds,
  exportDocumentToSvg,
  exportDocumentToSvgAdvanced,
  PACKAGE,
} from './index';

function sceneWithRect(): Document {
  let doc = createDocument('Test');
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;
  doc = addNode(
    doc,
    makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Rect' }),
  );
  return doc;
}

function sceneWithText(): Document {
  let doc = createDocument('TextTest');
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;
  doc = addNode(doc, makeTextNode(id, 'Hello', { name: 'Text', fontSize: 24 }));
  return doc;
}

describe('PACKAGE', () => {
  it('exposes package marker', () => {
    expect(PACKAGE).toBe('@strata/codegen');
  });
});

describe('computeDocumentBounds', () => {
  it('returns default bounds for empty doc', () => {
    const doc = createDocument();
    const bounds = computeDocumentBounds(doc);
    expect(bounds).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('computes bounds from rect nodes', () => {
    const doc = sceneWithRect();
    const bounds = computeDocumentBounds(doc);
    expect(bounds.w).toBeGreaterThan(0);
    expect(bounds.h).toBeGreaterThan(0);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
  });
});

describe('exportDocumentToSvg', () => {
  it('produces a valid SVG string for a rect', () => {
    const doc = sceneWithRect();
    const svg = exportDocumentToSvg(doc);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('rect');
    expect(svg).toContain('<?xml');
  });

  it('produces a valid SVG string for text', () => {
    const doc = sceneWithText();
    const svg = exportDocumentToSvg(doc);
    expect(svg).toContain('<text');
    expect(svg).toContain('Hello');
    expect(svg).toContain('font-family="Inter"');
  });
});

describe('exportDocumentToSvgAdvanced', () => {
  it('respects minify option', () => {
    const doc = sceneWithRect();
    const normal = exportDocumentToSvgAdvanced(doc, { minify: false });
    const minified = exportDocumentToSvgAdvanced(doc, { minify: true });
    expect(minified.length).toBeLessThan(normal.length);
    expect(minified).not.toContain('<?xml');
  });

  it('respects precision option', () => {
    const doc = sceneWithRect();
    const high = exportDocumentToSvgAdvanced(doc, { precision: 6 });
    const low = exportDocumentToSvgAdvanced(doc, { precision: 0 });
    expect(high).toBeDefined();
    expect(low).toBeDefined();
  });

  it('respects includeHidden option', () => {
    let doc = sceneWithRect();
    // Find the rect node (skip contentRoot)
    const rectId = doc.rootChildren.find((id) => doc.nodes[id]?.name === 'Rect');
    if (!rectId) throw new Error('Rect not found');
    const node = doc.nodes[rectId]!;
    doc = { ...doc, nodes: { ...doc.nodes, [rectId]: { ...node, visible: false } } };
    const excluded = exportDocumentToSvgAdvanced(doc, { includeHidden: false });
    const included = exportDocumentToSvgAdvanced(doc, { includeHidden: true });
    // Background rect always present; check for shape-specific fill
    expect(excluded).not.toContain('"rgba(57,208,198,1.000)"');
    expect(included).toContain('"rgba(57,208,198,1.000)"');
  });

  it('returns viewBox matching document bounds', () => {
    const doc = sceneWithRect();
    const svg = exportDocumentToSvgAdvanced(doc, {});
    const bounds = computeDocumentBounds(doc);
    expect(svg).toContain(`viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}"`);
  });
});
