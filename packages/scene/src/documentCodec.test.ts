import { describe, expect, it } from 'vitest';
import { createEmbeddedAsset } from './assets';
import {
  addNode,
  addPage,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  validateDocument,
} from './document';
import { DocumentCodec } from './documentCodec';
import { gradientFill, imageFill } from './fills';
import { addRasterMaskAsset } from './masks';
import { makePaint, type Page, type RasterMaskAsset } from './types';
import { CURRENT_DOCUMENT_VERSION } from './version';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_2X2_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQAAAABazTCJAAAADElEQVQI12M4wHAAAAMEAYHFO6KpAAAAAElFTkSuQmCC';

describe('DocumentCodec', () => {
  it('round-trips the export-region frame role', () => {
    let doc = createDocument('Export region', true);
    doc = addNode(
      doc,
      makeFrameNode('export-region', {
        name: 'Export Region 1',
        frameRole: 'exportRegion',
        children: [],
      }),
    );

    const result = DocumentCodec.decode(DocumentCodec.encode(doc));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes['export-region']).toMatchObject({
      kind: 'frame',
      frameRole: 'exportRegion',
    });
  });

  it('decodes, migrates, and validates serialized documents', () => {
    const legacy = {
      id: 'doc-legacy',
      name: 'Legacy',
      formatVersion: '1.0',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    };

    const result = DocumentCodec.decode(JSON.stringify(legacy));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(result.document.name).toBe('Legacy');
    expect(result.warnings.some((w) => w.code === 'document.migrated')).toBe(true);
  });

  it('rejects a document with a cyclic parent graph instead of hanging', () => {
    const cyclic = {
      id: 'doc-cycle',
      name: 'Cyclic',
      formatVersion: CURRENT_DOCUMENT_VERSION,
      rootChildren: ['f1'],
      nodes: {
        f1: {
          id: 'f1',
          kind: 'frame',
          name: 'Frame 1',
          transform: [1, 0, 0, 1, 0, 0],
          rotation: 0,
          children: ['f2'],
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          order: 'a0',
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          w: 100,
          h: 100,
        },
        f2: {
          id: 'f2',
          kind: 'frame',
          name: 'Frame 2',
          transform: [1, 0, 0, 1, 0, 0],
          rotation: 0,
          children: ['f1'],
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          order: 'a1',
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          w: 100,
          h: 100,
        },
      },
      components: {},
      nextId: 3,
    };

    const result = DocumentCodec.decode(JSON.stringify(cyclic));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('parent cycle');
    expect(result.warnings.some((w) => w.code === 'document.parent-cycle')).toBe(true);
  });

  it('normalizes broken root and child references without throwing', () => {
    let doc = createDocument('Broken', true);
    doc = addNode(
      doc,
      makeGroupNode('n1', {
        name: 'Group',
        children: ['missing-child'],
      }),
    );
    doc = {
      ...doc,
      rootChildren: ['missing-root', 'n1'],
      nextId: 1,
    };

    const result = DocumentCodec.normalize(doc);

    expect(result.document.rootChildren).toEqual(['n1']);
    expect(result.document.nodes.n1?.kind).toBe('group');
    expect((result.document.nodes.n1 as { children: string[] }).children).toEqual([]);
    expect(result.document.nextId).toBeGreaterThan(1);
    expect(result.warnings.map((w) => w.code)).toContain('document.orphan-root');
    expect(result.warnings.map((w) => w.code)).toContain('document.orphan-child');
  });

  it('repairs stale page ownership and active page references', () => {
    let doc = createDocument('Broken pages');
    doc = addPage(doc);
    const first = doc.pages?.[0] as Page;
    const second = doc.pages?.[1] as Page;
    doc = {
      ...doc,
      activePageId: 'missing-page',
      pages: [
        { ...first, contentRoot: 'missing-root' },
        { ...second, backgrounds: ['missing-background'] },
      ],
    };

    const result = DocumentCodec.normalize(doc);

    expect(result.document.pages?.map((p) => p.id)).toEqual([first.id, second.id]);
    expect(result.document.activePageId).toBe(first.id);
    expect(result.document.nodes['missing-root']?.kind).toBe('group');
    expect(result.document.rootChildren).toContain('missing-root');
    expect(result.document.pages?.[1]?.backgrounds).toEqual([]);
    expect(validateDocument(result.document).valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('document.page-content-root-missing');
    expect(result.warnings.map((w) => w.code)).toContain('document.page-background-missing');
    expect(result.warnings.map((w) => w.code)).toContain('document.active-page-normalized');
  });

  it('repairs dangling and unsupported clipping relationships without losing children', () => {
    const content = makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
    const group = makeGroupNode('clip', { children: ['content'] });
    group.mask = { type: 'clip', sourceNodeId: 'missing', visible: true };
    const doc = {
      ...createDocument('Broken mask', true),
      nodes: { clip: group, content },
      rootChildren: ['clip'],
    };

    const normalized = DocumentCodec.normalize(doc);

    expect(normalized.document.nodes.clip?.mask).toBeUndefined();
    expect(normalized.document.nodes.content).toEqual(content);
    expect(normalized.warnings).toContainEqual(
      expect.objectContaining({
        code: 'document.invalid-structural-mask',
        path: 'clip.mask',
      }),
    );

    const decoded = DocumentCodec.decode(JSON.stringify(doc));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.nodes.clip?.mask).toBeUndefined();
    expect(decoded.document.nodes.content).toBeDefined();
  });

  it('collects the full dependency closure for imported subtrees', () => {
    let doc = createDocument('Closure', true);
    doc = addNode(
      doc,
      makeGroupNode('g1', {
        children: ['s1'],
      }),
    );
    doc = addNode(doc, makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));

    const closure = DocumentCodec.collectNodeClosure(doc, ['g1']);

    expect([...closure.nodeIds]).toEqual(['g1', 's1']);
    expect(Object.keys(closure.nodes)).toEqual(['g1', 's1']);
  });

  describe('document-level image assets', () => {
    const DATA_URL = 'data:image/png;base64,aGVsbG8=';

    function docWithAsset() {
      const asset = createEmbeddedAsset({
        dataUrl: DATA_URL,
        mimeType: 'image/png',
        naturalWidth: 10,
        naturalHeight: 10,
      });
      let doc = createDocument('Assets', true);
      const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
      shape.fills = [imageFill(DATA_URL, { assetId: asset.id })];
      doc = addNode(doc, shape);
      doc = { ...doc, assets: { [asset.id]: asset } };
      return { doc, asset };
    }

    it('rejects a malformed assets shape', () => {
      const raw = { ...createDocument('Bad', true), assets: 'not-an-object' };
      const result = DocumentCodec.decode(JSON.stringify(raw));
      expect(result.ok).toBe(false);
    });

    it('round-trips a document with an embedded image asset', () => {
      const { doc } = docWithAsset();
      const decoded = DocumentCodec.decode(DocumentCodec.encode(doc));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      const shape = decoded.document.nodes.s1;
      const image = shape?.kind === 'shape' ? shape.fills?.[0]?.image : undefined;
      expect(image?.src).toBe(DATA_URL);
      expect(decoded.document.assets?.[image?.assetId as string]?.dataUrl).toBe(DATA_URL);
    });

    it('serializes the asset payload once, not once per referencing fill', () => {
      const { doc: base, asset } = docWithAsset();
      const shape2 = makeShapeNode('s2', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
      shape2.fills = [imageFill(DATA_URL, { assetId: asset.id })];
      const doc = addNode(base, shape2);

      const json = DocumentCodec.encode(doc);
      const occurrences = json.split(DATA_URL.slice('data:image/png;base64,'.length)).length - 1;
      expect(occurrences).toBe(1);
    });

    it('drops an invalid asset entry with a warning but keeps the document valid', () => {
      const raw = {
        ...createDocument('Invalid asset', true),
        assets: { bad: { id: 'bad', storage: 'embedded', mimeType: 'image/png' } },
      };
      const result = DocumentCodec.decode(JSON.stringify(raw));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.document.assets?.bad).toBeUndefined();
      expect(result.warnings.some((w) => w.code === 'document.invalid-image-asset')).toBe(true);
    });

    it('prunes assets no longer referenced by any node', () => {
      const { doc, asset } = docWithAsset();
      const withoutFill = {
        ...doc,
        nodes: {
          ...doc.nodes,
          s1: { ...doc.nodes.s1!, fills: [] },
        },
      };
      const normalized = DocumentCodec.normalize(withoutFill as typeof doc);
      expect(normalized.document.assets?.[asset.id]).toBeUndefined();
    });

    it('includes referenced assets in the copy/paste dependency closure', () => {
      const { doc, asset } = docWithAsset();
      const closure = DocumentCodec.collectNodeClosure(doc, ['s1']);
      expect(closure.assets?.[asset.id]).toEqual(asset);
    });
  });

  it('preserves gradient interpolation metadata through save and reopen', () => {
    const shape = makeShapeNode('gradient', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 });
    shape.fills = [
      gradientFill(
        'linear',
        [
          { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
          { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
        ],
        { interpolationSpace: 'oklch', hueInterpolation: 'longer' },
      ),
    ];
    const doc = addNode(createDocument('Gradient metadata', true), shape);

    const reopened = DocumentCodec.decode(DocumentCodec.encode(doc));

    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const gradient = reopened.document.nodes.gradient;
    expect(gradient?.kind).toBe('shape');
    if (gradient?.kind !== 'shape') return;
    expect(gradient.fills?.[0]?.gradient).toMatchObject({
      interpolationSpace: 'oklch',
      hueInterpolation: 'longer',
    });
    expect(gradient.fills?.[0]?.gradient?.interpolationSource).toBeUndefined();
  });

  describe('current-version image geometry normalization', () => {
    it('normalizes malformed image usage values on node and shared-paint fills', () => {
      const node = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 });
      node.fills = [
        {
          ...imageFill(PNG_DATA_URL),
          image: {
            src: PNG_DATA_URL,
            fit: 'invalid',
            x: Number.NaN,
            y: Number.POSITIVE_INFINITY,
            scale: 0,
            imageWidth: -10,
            imageHeight: Number.NaN,
            crop: { x: -10, y: 0, w: 40, h: 20 },
            rotation: -90,
            flipH: 'yes',
            flipV: 0,
          },
        } as unknown as NonNullable<typeof node.fills>[number],
      ];
      const offsetCropNode = makeShapeNode('s2', {
        kind: 'rect',
        x: 0,
        y: 0,
        w: 100,
        h: 80,
      });
      offsetCropNode.fills = [
        {
          ...imageFill('https://example.test/image.png', { fit: 'crop' }),
          image: {
            ...imageFill('https://example.test/image.png', { fit: 'crop' }).image!,
            crop: { x: 10, y: 5, w: 20, h: 15 },
          },
        },
      ];
      const asset = createEmbeddedAsset({
        dataUrl: PNG_DATA_URL,
        mimeType: 'image/png',
        naturalWidth: 100,
        naturalHeight: 80,
      });
      const paint = makePaint('paint-1', 'Image paint', imageFill(PNG_DATA_URL));
      paint.fill.image = {
        src: PNG_DATA_URL,
        assetId: asset.id,
        fit: 'crop',
        x: Number.NEGATIVE_INFINITY,
        y: 12,
        scale: -2,
        crop: { x: 90, y: 70, w: 50, h: 50 },
        rotation: 450,
        flipH: false,
        flipV: true,
      };
      const doc = {
        ...addNode(addNode(createDocument('Malformed images', true), node), offsetCropNode),
        paints: { [paint.id]: paint },
        assets: { [asset.id]: asset },
      };

      const normalized = DocumentCodec.normalize(doc).document;
      const nodeImage =
        normalized.nodes.s1?.kind === 'shape' ? normalized.nodes.s1.fills?.[0]?.image : undefined;
      const paintImage = normalized.paints?.['paint-1']?.fill.image;

      expect(nodeImage).toMatchObject({
        fit: 'fill',
        x: 0,
        y: 0,
        scale: 1,
        rotation: 270,
        flipH: false,
        flipV: false,
      });
      expect(nodeImage?.imageWidth).toBeUndefined();
      expect(nodeImage?.imageHeight).toBeUndefined();
      expect(nodeImage?.crop).toBeUndefined();
      expect(paintImage).toMatchObject({
        x: 0,
        y: 12,
        scale: 1,
        imageWidth: 100,
        imageHeight: 80,
        crop: { x: 90, y: 70, w: 10, h: 10 },
        rotation: 90,
        flipH: false,
        flipV: true,
      });
      const offsetCropImage =
        normalized.nodes.s2?.kind === 'shape' ? normalized.nodes.s2.fills?.[0]?.image : undefined;
      expect(offsetCropImage?.crop).toEqual({ x: 10, y: 5, w: 20, h: 15 });
    });

    it('normalizes malformed fields when reopening a current-version save', () => {
      const node = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 });
      node.fills = [
        {
          ...imageFill(PNG_DATA_URL),
          image: {
            src: PNG_DATA_URL,
            fit: 'unknown',
            x: null,
            y: 'invalid',
            scale: -1,
            imageWidth: 0,
            imageHeight: 'invalid',
            crop: { x: 5, y: 6, w: 0, h: -1 },
            rotation: 720,
            flipH: 1,
            flipV: '',
          },
        } as unknown as NonNullable<typeof node.fills>[number],
      ];
      const current = addNode(createDocument('Current malformed', true), node);

      const reopened = DocumentCodec.decode(JSON.stringify(current));

      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      const image =
        reopened.document.nodes.s1?.kind === 'shape'
          ? reopened.document.nodes.s1.fills?.[0]?.image
          : undefined;
      expect(image).toMatchObject({
        fit: 'fill',
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        flipH: false,
        flipV: false,
      });
      expect(image?.imageWidth).toBeUndefined();
      expect(image?.imageHeight).toBeUndefined();
      expect(image?.crop).toBeUndefined();
    });

    it('preserves crop, embedded source, and background-removal mask through save and reopen', () => {
      const asset = createEmbeddedAsset({
        dataUrl: PNG_2X2_DATA_URL,
        mimeType: 'image/png',
        naturalWidth: 2,
        naturalHeight: 2,
      });
      const node = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 });
      node.fills = [
        {
          ...imageFill(PNG_2X2_DATA_URL, {
            assetId: asset.id,
            fit: 'crop',
            imageWidth: 2,
            imageHeight: 2,
          }),
          image: {
            ...imageFill(PNG_2X2_DATA_URL, {
              assetId: asset.id,
              fit: 'crop',
              imageWidth: 2,
              imageHeight: 2,
            }).image!,
            x: 3.5,
            y: -2.25,
            scale: 1.75,
            crop: { x: 1, y: 0, w: 1, h: 2 },
            rotation: 15,
            flipH: true,
          },
        },
      ];
      let doc = addNode(createDocument('Masked crop', true), node);
      doc = { ...doc, assets: { [asset.id]: asset } };
      const maskAsset: RasterMaskAsset = {
        id: 'mask-1',
        mimeType: 'image/png',
        dataUrl: PNG_2X2_DATA_URL,
        width: 2,
        height: 2,
        byteLength: 69,
      };
      doc = addRasterMaskAsset(doc, node.id, maskAsset, {
        provenance: {
          method: 'ai-balanced',
          modelId: 'test-model',
          runtime: 'wasm',
          generatedAt: 1,
          origin: 'native',
        },
      });

      const reopened = DocumentCodec.decode(DocumentCodec.encode(doc));

      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      const restored = reopened.document.nodes.s1;
      const image = restored?.kind === 'shape' ? restored.fills?.[0]?.image : undefined;
      expect(image).toMatchObject({
        src: PNG_2X2_DATA_URL,
        assetId: asset.id,
        x: 3.5,
        y: -2.25,
        scale: 1.75,
        crop: { x: 1, y: 0, w: 1, h: 2 },
        rotation: 15,
        flipH: true,
      });
      expect(reopened.document.assets?.[asset.id]).toEqual(asset);
      expect(restored?.mask?.rasterMask).toMatchObject({
        assetId: 'mask-1',
        provenance: {
          method: 'ai-balanced',
          modelId: 'test-model',
          origin: 'native',
        },
      });
      expect(reopened.document.rasterMaskAssets?.['mask-1']).toEqual(maskAsset);
    });
  });
});
