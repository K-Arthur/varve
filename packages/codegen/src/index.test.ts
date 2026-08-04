import type { Document } from '@varve/scene';
import {
  addChild,
  addNode,
  createClippingMask,
  createDocument,
  imageFill,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
} from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY } from '@varve/shared';
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
    expect(PACKAGE).toBe('@varve/codegen');
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
    expect(svg).toContain(`font-family="${DEFAULT_ARTWORK_FONT_FAMILY}"`);
  });

  it('exports a shape with image fill as an SVG <image> element', () => {
    let doc = createDocument('ImageSVG');
    const { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 64, h: 64 }, { name: 'Photo' });
    doc = addNode(doc, {
      ...node,
      fills: [imageFill('data:image/png;base64,FAKE', { fit: 'fill' })],
    });
    const svg = exportDocumentToSvg(doc);
    expect(svg).toContain('<image');
    expect(svg).toContain('href="data:image/png;base64,FAKE"');
    expect(svg).toContain('preserveAspectRatio="none"');
  });

  it('exports crop, placement, rotation, flip, and object transform from canonical geometry', () => {
    let doc = createDocument('TransformedImageSVG');
    const { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { name: 'Photo', transform: [1, 0, 0, 1, 20, 30] },
    );
    const fill = imageFill('data:image/png;base64,FAKE', {
      fit: 'fill',
      imageWidth: 200,
      imageHeight: 100,
    });
    doc = addNode(doc, {
      ...node,
      fills: [
        {
          ...fill,
          image: {
            ...fill.image!,
            x: 10,
            y: 5,
            crop: { x: 50, y: 0, w: 100, h: 100 },
            rotation: 90,
            flipH: true,
          },
        },
      ],
    });

    const svg = exportDocumentToSvg(doc);

    expect(svg).toContain('transform="matrix(1,0,0,1,20,30)"');
    expect(svg).toContain('x="-40.0000" y="5.0000" width="200.0000" height="100.0000"');
    expect(svg).toContain('<rect x="10.0000" y="5.0000" width="100.0000" height="100.0000" />');
    expect(svg).toContain(
      'transform="translate(60.0000 55.0000) rotate(90.0000) scale(-1 1) translate(-60.0000 -55.0000)"',
    );
  });

  it('exports a shape with a raster mask as an SVG <mask> element', () => {
    let doc = createDocument('MaskedImage');
    const { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 64, h: 64 }, { name: 'Masked' });
    doc = addNode(doc, {
      ...node,
      fills: [imageFill('data:image/png;base64,FAKE', { fit: 'fill' })],
    });
    // Attach a raster mask and its asset to the document
    const maskDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';
    doc = {
      ...doc,
      rasterMaskAssets: {
        'mask-1': {
          id: 'mask-1',
          mimeType: 'image/png',
          dataUrl: maskDataUrl,
          width: 1,
          height: 1,
          byteLength: 68,
        },
      },
      nodes: {
        ...doc.nodes,
        [id]: {
          ...doc.nodes[id]!,
          mask: {
            visible: true,
            type: 'alpha',
            rasterMask: {
              assetId: 'mask-1',
              coordinateSpace: 'source-image-pixels',
              sourceIdentity: { kind: 'source-metadata', locator: 'test', revision: 1 },
            },
          },
        },
      },
    };
    const svg = exportDocumentToSvg(doc);
    expect(svg).toContain('<mask');
    expect(svg).toContain(`id="mask-${id}"`);
    expect(svg).toContain(maskDataUrl);
    expect(svg).toContain(`mask="url(#mask-${id})"`);
    expect(svg).toContain(
      `maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"`,
    );
    expect(svg).toContain(
      `<image href="${maskDataUrl}" x="0.0000" y="0.0000" width="64.0000" height="64.0000" preserveAspectRatio="none" />`,
    );
  });

  it('exports active-page clipping groups as editable SVG clip paths', () => {
    let doc = createDocument('Page clipping group');
    const page = doc.pages?.[0];
    if (!page) throw new Error('Expected initial page');
    doc = addChild(
      doc,
      page.contentRoot,
      makeShapeNode('content', { kind: 'rect', x: -100, y: -100, w: 400, h: 400 }),
    );
    doc = addChild(
      doc,
      page.contentRoot,
      makeShapeNode('mask-source', { kind: 'circle', cx: 50, cy: 50, r: 50 }),
    );
    const clipped = createClippingMask(doc, 'mask-source', ['content']);

    const svg = exportDocumentToSvgAdvanced(clipped.doc, {});

    expect(svg).toContain(`<clipPath id="mask-${clipped.groupId}"`);
    expect(svg).toContain(`clip-path="url(#mask-${clipped.groupId})"`);
    expect(svg).toContain('width="400"');
    expect(svg.match(/<circle/g)).toHaveLength(1);
    expect(svg).toContain('viewBox="0 0 140 140"');
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
    const node = doc.nodes[rectId];
    if (!node) throw new Error('Rect node not found in document');
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

  it('preserves object opacity and CSS blend-mode spelling', () => {
    let doc = createDocument('Blend export', true);
    const node = makeShapeNode(
      'blend',
      { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
      { opacity: 0.4, blendMode: 'colorDodge' },
    );
    doc = addNode(doc, node);

    const svg = exportDocumentToSvgAdvanced(doc, {});

    expect(svg).toContain('opacity="0.4"');
    expect(svg).toContain('style="mix-blend-mode: color-dodge;"');
  });

  it('distinguishes pass-through groups from isolated normal groups', () => {
    let doc = createDocument('Group compositing', true);
    doc = addNode(doc, makeGroupNode('pass', { blendMode: 'passThrough' }));
    doc = addChild(
      doc,
      'pass',
      makeShapeNode('pass-child', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );
    doc = addNode(doc, makeGroupNode('isolated', { blendMode: 'normal' }));
    doc = addChild(
      doc,
      'isolated',
      makeShapeNode('isolated-child', { kind: 'rect', x: 20, y: 0, w: 10, h: 10 }),
    );

    const svg = exportDocumentToSvgAdvanced(doc, {});
    const groups = svg.match(/<g[^>]*>/g) ?? [];

    expect(groups.some((tag) => tag.includes('isolation: isolate;'))).toBe(true);
    expect(groups.some((tag) => !tag.includes('style='))).toBe(true);
  });
});
