/**
 * Raster mask contract tests.
 *
 * Research basis: Adobe/PSD-style non-destructive pixel masks and local-first
 * immutable asset ownership require source-pixel coordinates and copy-on-write
 * updates at document boundaries.
 */
import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeShapeNode, removeNode } from '../document';
import { DocumentCodec } from '../documentCodec';
import type { Document, RasterMaskAsset, ShapeNode } from '../index';
import {
  addRasterMaskAsset,
  removeRasterMaskAsset,
  resolveMask,
  setMaskDensity,
  setMaskFeather,
  setMaskInverted,
  setMaskSourceNode,
  setMaskVectorPath,
  setMaskVisible,
  updateRasterMaskAsset,
  validateMaskSource,
  validateRasterMaskAsset,
} from '../masks';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_BYTE_LENGTH = 68;

function pngWithIhdrDimensions(width: number, height: number): string {
  const payload = PNG_DATA_URL.slice(PNG_DATA_URL.indexOf(',') + 1);
  const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

function makeRasterAsset(id: string, width = 1, height = 1): RasterMaskAsset {
  return {
    id,
    mimeType: 'image/png',
    dataUrl: PNG_DATA_URL,
    width,
    height,
    byteLength: PNG_BYTE_LENGTH,
  };
}

function metadataIdentity(locator = 'image-a', revision = 1) {
  return {
    kind: 'source-metadata' as const,
    locator,
    pixelWidth: 1,
    pixelHeight: 1,
    revision,
  };
}

function makeImageDocument(): { doc: Document; imageId: string } {
  const imageId = 'image-1';
  const image = makeShapeNode(imageId, { kind: 'rect', x: 0, y: 0, w: 64, h: 32 });
  image.fills = [
    {
      type: 'image',
      image: { src: 'image-a', fit: 'fill', x: 0, y: 0, scale: 1, imageWidth: 1, imageHeight: 1 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    },
  ];
  return { doc: addNode(createDocument('Raster masks', true), image), imageId };
}

describe('native raster masks', () => {
  it('attaches a source-pixel raster alpha mask to an image shape', () => {
    const { doc, imageId } = makeImageDocument();
    const next = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));

    expect(next).not.toBe(doc);
    expect(next.nodes[imageId]?.mask).toEqual({
      type: 'alpha',
      visible: true,
      rasterMask: {
        assetId: 'mask-1',
        coordinateSpace: 'source-image-pixels',
        sourceIdentity: {
          kind: 'source-metadata',
          locator: 'image-a',
          pixelWidth: 1,
          pixelHeight: 1,
          revision: 1,
        },
      },
    });
    expect(next.rasterMaskAssets?.['mask-1']?.width).toBe(1);
    expect(resolveMask(next.nodes[imageId]!)).toEqual(next.nodes[imageId]?.mask);
  });

  it('only attaches raster masks to image-filled shapes with a resolved asset', () => {
    const shape = makeShapeNode('shape-1', { kind: 'rect', x: 0, y: 0, w: 64, h: 32 });
    const doc = addNode(createDocument('No image', true), shape);
    expect(addRasterMaskAsset(doc, shape.id, makeRasterAsset('mask-1'))).toBe(doc);

    const { doc: imageDoc, imageId } = makeImageDocument();
    const dangling = {
      ...imageDoc,
      nodes: {
        ...imageDoc.nodes,
        [imageId]: {
          ...imageDoc.nodes[imageId],
          mask: {
            type: 'alpha',
            visible: true,
            rasterMask: {
              assetId: 'missing',
              coordinateSpace: 'source-image-pixels',
              sourceIdentity: metadataIdentity(),
            },
          },
        } as ShapeNode,
      },
    };
    expect(validateMaskSource(dangling, dangling.nodes[imageId]!.mask!)).toMatch(/missing/i);
  });

  it('rejects source-pixel assets that differ from known oriented source dimensions', () => {
    const { doc, imageId } = makeImageDocument();
    const mismatched = {
      ...makeRasterAsset('wrong-size', 2, 1),
      dataUrl: pngWithIhdrDimensions(2, 1),
    };

    expect(addRasterMaskAsset(doc, imageId, mismatched)).toBe(doc);

    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    expect(updateRasterMaskAsset(attached, imageId, mismatched)).toBe(attached);
  });

  it('preserves a verified source content checksum when the caller provides one', () => {
    const { doc, imageId } = makeImageDocument();
    const sha256 = 'a'.repeat(64);
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'), {
      sourceIdentity: {
        kind: 'content-sha256',
        sha256,
        pixelWidth: 1,
        pixelHeight: 1,
        revision: 2,
      },
    });

    expect(attached.nodes[imageId]?.mask?.rasterMask?.sourceIdentity).toEqual({
      kind: 'content-sha256',
      sha256,
      pixelWidth: 1,
      pixelHeight: 1,
      revision: 2,
    });
  });

  it('updates shared assets copy-on-write and removes only unreferenced payloads', () => {
    const { doc, imageId } = makeImageDocument();
    const second = { ...(doc.nodes[imageId] as ShapeNode), id: 'image-2', name: 'Copy' };
    let shared = addNode(doc, second);
    shared = addRasterMaskAsset(shared, imageId, makeRasterAsset('shared-mask'));
    shared = addRasterMaskAsset(shared, second.id, makeRasterAsset('shared-mask'));

    const updated = updateRasterMaskAsset(shared, imageId, makeRasterAsset('edited-mask'));
    expect(updated.nodes[imageId]?.mask?.rasterMask?.assetId).toBe('edited-mask');
    expect(updated.nodes[second.id]?.mask?.rasterMask?.assetId).toBe('shared-mask');
    expect(updated.rasterMaskAssets?.['shared-mask']).toBeDefined();
    expect(updated.rasterMaskAssets?.['edited-mask']).toBeDefined();

    const oneRemoved = removeRasterMaskAsset(updated, second.id);
    expect(oneRemoved.nodes[second.id]?.mask).toBeUndefined();
    expect(oneRemoved.rasterMaskAssets?.['shared-mask']).toBeUndefined();
    expect(oneRemoved.rasterMaskAssets?.['edited-mask']).toBeDefined();

    const allRemoved = removeRasterMaskAsset(oneRemoved, imageId);
    expect(allRemoved.rasterMaskAssets?.['edited-mask']).toBeUndefined();
  });

  it('preserves mask presentation and source metadata when replacing an asset', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'), {
      sourceIdentity: metadataIdentity('original', 7),
      editRevision: 3,
      provenance: {
        method: 'ai-quality',
        runtime: 'wasm',
        generatedAt: 42,
        confidence: 0.9,
      },
    });
    const configured = {
      ...attached,
      nodes: {
        ...attached.nodes,
        [imageId]: {
          ...attached.nodes[imageId]!,
          mask: {
            ...attached.nodes[imageId]!.mask!,
            visible: false,
            inverted: true,
            feather: 2,
            density: 0.8,
            linked: false,
            transform: [1, 0, 0, 1, 4, 5],
            fillRule: 'evenodd',
            hideMaskSource: true,
          },
        } as ShapeNode,
      },
    } as Document;

    const updated = updateRasterMaskAsset(configured, imageId, makeRasterAsset('mask-2'));
    expect(updated.nodes[imageId]?.mask).toMatchObject({
      visible: false,
      inverted: true,
      feather: 2,
      density: 0.8,
      linked: false,
      transform: [1, 0, 0, 1, 4, 5],
      fillRule: 'evenodd',
      hideMaskSource: true,
      rasterMask: {
        assetId: 'mask-2',
        sourceIdentity: metadataIdentity('original', 7),
        editRevision: 4,
        provenance: { method: 'ai-quality', runtime: 'wasm', generatedAt: 42, confidence: 0.9 },
      },
    });
  });

  it('requires exactly one meaningful mask source', () => {
    const rasterMask = {
      assetId: 'mask-1',
      coordinateSpace: 'source-image-pixels' as const,
      sourceIdentity: metadataIdentity(),
    };
    expect(validateMaskSource(undefined, { type: 'alpha', visible: true })).toMatch(/exactly one/i);
    expect(
      validateMaskSource(undefined, {
        type: 'alpha',
        visible: true,
        sourceNodeId: 'source',
        rasterMask,
      }),
    ).toMatch(/exclusive/i);
    expect(
      validateMaskSource(undefined, {
        type: 'clip',
        visible: true,
        vectorMask: { points: [], closed: true, fillRule: 'nonzero' },
      }),
    ).toMatch(/exactly one/i);
  });

  it('rejects raster masks when any structural source property is present', () => {
    const rasterMask = {
      assetId: 'mask-1',
      coordinateSpace: 'source-image-pixels' as const,
      sourceIdentity: metadataIdentity(),
    };
    expect(
      validateMaskSource(undefined, {
        type: 'alpha',
        visible: true,
        sourceNodeId: '',
        rasterMask,
      }),
    ).toMatch(/exclusive/i);
    expect(
      validateMaskSource(undefined, {
        type: 'alpha',
        visible: true,
        vectorMask: { points: [], closed: true, fillRule: 'nonzero' },
        rasterMask,
      }),
    ).toMatch(/exclusive/i);
  });

  it('edits native raster mask properties on eligible image leaves', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const hidden = setMaskVisible(attached, imageId, false);
    const inverted = setMaskInverted(hidden, imageId, true);
    const feathered = setMaskFeather(inverted, imageId, 2.5);
    const softened = setMaskDensity(feathered, imageId, 0.75);

    expect(softened.nodes[imageId]?.mask).toMatchObject({
      visible: false,
      inverted: true,
      feather: 2.5,
      density: 0.75,
      rasterMask: { assetId: 'mask-1' },
    });
    expect(setMaskSourceNode(attached, imageId, imageId)).toBe(attached);
    expect(
      setMaskVectorPath(attached, imageId, [{ x: 0, y: 0, handleIn: null, handleOut: null }], true),
    ).toBe(attached);
    expect(setMaskVisible(attached, imageId, true)).toBe(attached);
  });

  it('garbage-collects a removed node mask asset but preserves shared assets', () => {
    const { doc, imageId } = makeImageDocument();
    const copy = { ...(doc.nodes[imageId] as ShapeNode), id: 'image-2' };
    let shared = addNode(doc, copy);
    shared = addRasterMaskAsset(shared, imageId, makeRasterAsset('shared'));
    shared = addRasterMaskAsset(shared, copy.id, makeRasterAsset('shared'));
    const oneRemoved = removeNode(shared, imageId);
    expect(oneRemoved.rasterMaskAssets?.shared).toBeDefined();
    const allRemoved = removeNode(oneRemoved, copy.id);
    expect(allRemoved.rasterMaskAssets?.shared).toBeUndefined();
  });
});

describe('raster mask document boundary validation', () => {
  it('accepts the portable decoded-pixel boundary and rejects the next row', () => {
    const atLimitUrl = pngWithIhdrDimensions(16_384, 8192);
    const overLimitUrl = pngWithIhdrDimensions(16_384, 8193);
    expect(
      validateRasterMaskAsset({
        id: 'at-limit',
        mimeType: 'image/png',
        dataUrl: atLimitUrl,
        width: 16_384,
        height: 8192,
        byteLength: PNG_BYTE_LENGTH,
      }),
    ).toBeNull();
    expect(
      validateRasterMaskAsset({
        id: 'over-limit',
        mimeType: 'image/png',
        dataUrl: overLimitUrl,
        width: 16_384,
        height: 8193,
        byteLength: PNG_BYTE_LENGTH,
      }),
    ).toMatch(/decoded pixel limit/i);
  });

  it.each([
    ['asset', 'id', 'different-id'],
    ['asset', 'id', 'bad id'],
    ['asset', 'checksum', 'not-a-sha256'],
    ['raster', 'editRevision', -1],
    ['raster', 'editRevision', 'one'],
    ['raster', 'editRevision', Number.MAX_SAFE_INTEGER + 1],
    ['raster', 'staleReason', 'unknown-reason'],
    ['raster', 'coordinateSpace', 'canvas-pixels'],
    ['raster', 'sourceIdentity', null],
    ['raster', 'provenance', null],
    ['identity', 'revision', -1],
    ['identity', 'revision', Number.MAX_SAFE_INTEGER + 1],
    ['identity', 'locator', ''],
    ['identity', 'pixelWidth', 0],
    ['provenance', 'method', 'unknown-method'],
    ['provenance', 'runtime', 'unknown-runtime'],
    ['provenance', 'generatedAt', -1],
    ['provenance', 'confidence', 2],
    ['provenance', 'modelId', 42],
    ['provenance', 'modelChecksum', 'not-a-sha256'],
    ['provenance', 'decontaminate', 'yes'],
    ['provenance', 'origin', 'unknown-origin'],
  ] as const)('rejects untrusted %s.%s metadata', (section, field, value) => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'), {
      provenance: { method: 'quick', runtime: 'typescript', generatedAt: 1 },
    });
    const raw = JSON.parse(JSON.stringify(attached)) as Record<string, unknown>;
    const assets = raw.rasterMaskAssets as Record<string, Record<string, unknown>>;
    const nodes = raw.nodes as Record<string, Record<string, unknown>>;
    const mask = nodes[imageId]!.mask as Record<string, unknown>;
    const raster = mask.rasterMask as Record<string, unknown>;
    const identity = raster.sourceIdentity as Record<string, unknown>;
    const provenance = raster.provenance as Record<string, unknown>;
    const target =
      section === 'asset'
        ? assets['mask-1']!
        : section === 'raster'
          ? raster
          : section === 'identity'
            ? identity
            : provenance;
    target[field] = value;

    const decoded = DocumentCodec.decode(JSON.stringify(raw));
    expect(decoded.ok).toBe(false);
  });

  it('rejects malformed source identity descriptors from decoded JSON', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const image = attached.nodes[imageId] as ShapeNode;
    const malformed = {
      ...attached,
      nodes: {
        ...attached.nodes,
        [imageId]: {
          ...image,
          mask: {
            ...image.mask!,
            rasterMask: {
              ...image.mask!.rasterMask!,
              sourceIdentity: { kind: 'content-sha256', sha256: 'not-a-digest', revision: 1 },
            },
          },
        },
      },
    };

    const decoded = DocumentCodec.decode(JSON.stringify(malformed));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/source identity.*sha-256/i);
  });

  it.each([
    {
      label: 'metadata identity with digest fields',
      sourceIdentity: {
        kind: 'source-metadata',
        locator: 'image-a',
        sha256: 'a'.repeat(64),
        revision: 1,
      },
    },
    {
      label: 'content identity with locator fields',
      sourceIdentity: {
        kind: 'content-sha256',
        sha256: 'a'.repeat(64),
        locator: 'image-a',
        revision: 1,
      },
    },
  ])('rejects $label', ({ sourceIdentity }) => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const raw = JSON.parse(JSON.stringify(attached)) as Record<string, unknown>;
    const node = (raw.nodes as Record<string, Record<string, unknown>>)[imageId]!;
    const rasterMask = (node.mask as Record<string, unknown>).rasterMask as Record<string, unknown>;
    rasterMask.sourceIdentity = sourceIdentity;

    const decoded = DocumentCodec.decode(JSON.stringify(raw));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/source identity.*field/i);
  });

  it('rejects legacy-preview status on an exact source-pixel mask', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const raw = JSON.parse(JSON.stringify(attached)) as Record<string, unknown>;
    const node = (raw.nodes as Record<string, Record<string, unknown>>)[imageId]!;
    const rasterMask = (node.mask as Record<string, unknown>).rasterMask as Record<string, unknown>;
    rasterMask.staleReason = 'legacy-preview-resolution';
    rasterMask.provenance = {
      method: 'quick',
      runtime: 'typescript',
      generatedAt: 1,
      origin: 'legacy-background-removal-preview',
    };

    const decoded = DocumentCodec.decode(JSON.stringify(raw));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/legacy preview.*coordinate space/i);
  });

  it('rejects source identities whose dimensions disagree with the source-space asset', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const raw = JSON.parse(JSON.stringify(attached)) as Record<string, unknown>;
    const node = (raw.nodes as Record<string, Record<string, unknown>>)[imageId]!;
    const rasterMask = (node.mask as Record<string, unknown>).rasterMask as Record<string, unknown>;
    rasterMask.sourceIdentity = {
      kind: 'source-metadata',
      locator: 'image-a',
      pixelWidth: 2,
      pixelHeight: 1,
      revision: 1,
    };

    const decoded = DocumentCodec.decode(JSON.stringify(raw));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/source identity dimensions/i);
  });

  it('rejects exact source-pixel masks that do not match known oriented source dimensions', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const image = attached.nodes[imageId] as ShapeNode;
    const mismatched = {
      ...attached,
      nodes: {
        ...attached.nodes,
        [imageId]: {
          ...image,
          fills: [
            {
              ...image.fills![0]!,
              image: { ...image.fills![0]!.image!, imageWidth: 64, imageHeight: 32 },
            },
          ],
        },
      },
    };

    const decoded = DocumentCodec.decode(JSON.stringify(mismatched));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/oriented source dimensions/i);
  });

  it.each([
    ['invalid PNG MIME', { dataUrl: 'data:image/jpeg;base64,iVBORw0KGgo=' }, /PNG data URL/i],
    [
      'signature-only PNG',
      { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', byteLength: 8 },
      /IHDR/i,
    ],
    ['malformed base64', { dataUrl: 'data:image/png;base64,%%%%' }, /PNG data URL/i],
    ['zero width', { width: 0 }, /positive dimensions/i],
    ['dimension above limit', { width: 16_385 }, /dimension limit/i],
    ['decoded pixel limit', { width: 16_385, height: 16_385 }, /decoded pixel limit/i],
    ['encoded byte limit', { byteLength: 128 * 1024 * 1024 + 1 }, /encoded byte limit/i],
  ])('rejects %s', (_label, override, error) => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const invalid = {
      ...attached,
      rasterMaskAssets: {
        ...attached.rasterMaskAssets,
        'mask-1': { ...attached.rasterMaskAssets?.['mask-1'], ...override },
      },
    };

    const decoded = DocumentCodec.decode(JSON.stringify(invalid));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(error);
  });

  it('rejects decoded length, IHDR type, and declared dimension mismatches', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const bytes = atob(PNG_DATA_URL.slice(PNG_DATA_URL.indexOf(',') + 1))
      .split('')
      .map((char) => char.charCodeAt(0));
    bytes[12] = 'X'.charCodeAt(0);
    const badIhdr = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    const variants = [
      { ...makeRasterAsset('mask-1'), byteLength: PNG_BYTE_LENGTH - 1 },
      { ...makeRasterAsset('mask-1'), dataUrl: badIhdr },
      { ...makeRasterAsset('mask-1'), width: 2 },
    ];
    for (const asset of variants) {
      const decoded = DocumentCodec.decode(
        JSON.stringify({
          ...attached,
          rasterMaskAssets: { 'mask-1': asset },
        }),
      );
      expect(decoded.ok).toBe(false);
    }
  });

  it.each([
    ['null node', { nodes: { bad: null } }],
    ['array node', { nodes: { bad: [] } }],
    ['primitive node', { nodes: { bad: 7 } }],
    ['null asset', { rasterMaskAssets: { bad: null } }],
    ['array asset', { rasterMaskAssets: { bad: [] } }],
    ['primitive asset', { rasterMaskAssets: { bad: 7 } }],
  ])('returns a decode error without throwing for a %s', (_label, patch) => {
    const { doc } = makeImageDocument();
    expect(() => DocumentCodec.decode(JSON.stringify({ ...doc, ...patch }))).not.toThrow();
    expect(DocumentCodec.decode(JSON.stringify({ ...doc, ...patch })).ok).toBe(false);
  });

  it.each([
    ['empty vector mask', { mask: { type: 'clip', visible: true, vectorMask: {} } }],
    [
      'non-array vector points',
      { mask: { type: 'clip', visible: true, vectorMask: { points: {} } } },
    ],
    ['non-array fills', { fills: {} }],
    ['null mask', { mask: null }],
    ['primitive raster mask', { mask: { type: 'alpha', visible: true, rasterMask: 7 } }],
  ])('returns a decode error without throwing for nested malformed %s', (_label, nodePatch) => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const malformed = {
      ...attached,
      nodes: {
        ...attached.nodes,
        [imageId]: { ...attached.nodes[imageId]!, ...nodePatch },
      },
    };
    expect(() => DocumentCodec.decode(JSON.stringify(malformed))).not.toThrow();
    expect(DocumentCodec.decode(JSON.stringify(malformed)).ok).toBe(false);
  });

  it('rejects a missing raster asset reference', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const decoded = DocumentCodec.decode(JSON.stringify({ ...attached, rasterMaskAssets: {} }));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/missing raster mask asset/i);
  });

  it.each([
    [
      'invalid asset bounds',
      (doc: Document) => ({
        ...doc,
        rasterMaskAssets: {
          ...doc.rasterMaskAssets,
          'mask-1': {
            ...(doc.rasterMaskAssets?.['mask-1'] as RasterMaskAsset),
            width: 0,
          },
        },
      }),
    ],
    [
      'invalid source combination',
      (doc: Document) => ({
        ...doc,
        nodes: {
          ...doc.nodes,
          'image-1': {
            ...doc.nodes['image-1']!,
            mask: { ...doc.nodes['image-1']!.mask!, sourceNodeId: 'other' },
          } as ShapeNode,
        },
      }),
    ],
    ['missing asset reference', (doc: Document) => ({ ...doc, rasterMaskAssets: {} })],
  ])('normalizes and encodes %s without retaining unsafe raster state', (_label, corrupt) => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const invalid = corrupt(attached);

    const normalized = DocumentCodec.normalize(invalid);
    expect(normalized.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'document.invalid-raster-mask', severity: 'error' }),
      ]),
    );
    expect(normalized.document.nodes[imageId]?.mask).toBeUndefined();
    expect(normalized.document.rasterMaskAssets?.['mask-1']).toBeUndefined();

    const encoded = JSON.parse(DocumentCodec.encode(invalid)) as Document;
    expect(encoded.nodes[imageId]?.mask).toBeUndefined();
    expect(encoded.rasterMaskAssets?.['mask-1']).toBeUndefined();
    expect(DocumentCodec.decode(JSON.stringify(encoded)).ok).toBe(true);
  });

  it('preserves unrelated valid raster assets while sanitizing an invalid mask', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const invalid = {
      ...attached,
      rasterMaskAssets: {
        ...attached.rasterMaskAssets,
        unrelated: makeRasterAsset('unrelated'),
      },
      nodes: {
        ...attached.nodes,
        [imageId]: {
          ...attached.nodes[imageId]!,
          mask: { ...attached.nodes[imageId]!.mask!, sourceNodeId: 'other' },
        } as ShapeNode,
      },
    };

    const normalized = DocumentCodec.normalize(invalid);
    expect(normalized.document.nodes[imageId]?.mask).toBeUndefined();
    expect(normalized.document.rasterMaskAssets?.['mask-1']).toBeUndefined();
    expect(normalized.document.rasterMaskAssets?.unrelated).toEqual(makeRasterAsset('unrelated'));
    expect(DocumentCodec.decode(DocumentCodec.encode(invalid)).ok).toBe(true);
  });

  it('collects raster mask assets with a copied node closure', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const closure = DocumentCodec.collectNodeClosure(attached, [imageId]);
    expect(closure.rasterMaskAssets).toEqual({ 'mask-1': makeRasterAsset('mask-1') });
  });

  it('removes malformed legacy background removal state with an error warning', () => {
    const { doc, imageId } = makeImageDocument();
    const legacy = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [imageId]: {
          ...doc.nodes[imageId]!,
          backgroundRemoval: { method: 'quick', confidence: 0.2 },
        },
      },
    } as unknown as Document;

    const normalized = DocumentCodec.normalize(legacy);
    expect(normalized.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'document.invalid-legacy-background-removal',
          severity: 'error',
        }),
      ]),
    );
    expect('backgroundRemoval' in normalized.document.nodes[imageId]!).toBe(false);

    const decoded = DocumentCodec.decode(JSON.stringify({ ...legacy, formatVersion: '2.0' }));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'document.invalid-legacy-background-removal',
          severity: 'error',
        }),
      ]),
    );
    expect('backgroundRemoval' in decoded.document.nodes[imageId]!).toBe(false);
  });

  it('decodes legacy preview dimensions from PNG IHDR without claiming source-pixel precision', () => {
    const { doc, imageId } = makeImageDocument();
    const image = doc.nodes[imageId] as ShapeNode;
    const legacy = {
      ...doc,
      formatVersion: '2.0',
      nodes: {
        ...doc.nodes,
        [imageId]: {
          ...image,
          fills: [
            {
              ...image.fills![0]!,
              image: {
                ...image.fills![0]!.image!,
                imageWidth: 4096,
                imageHeight: 4096,
              },
            },
          ],
          backgroundRemoval: {
            maskDataUrl: pngWithIhdrDimensions(2048, 2048),
            method: 'ai-balanced',
            appliedAt: 10,
          },
        },
      },
    };

    const decoded = DocumentCodec.decode(JSON.stringify(legacy));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const mask = decoded.document.nodes[imageId]?.mask?.rasterMask;
    const asset = mask ? decoded.document.rasterMaskAssets?.[mask.assetId] : undefined;
    expect(asset).toMatchObject({ width: 2048, height: 2048 });
    expect(mask).toMatchObject({
      coordinateSpace: 'legacy-preview-pixels',
      staleReason: 'legacy-preview-resolution',
      provenance: { origin: 'legacy-background-removal-preview' },
    });
  });
});
