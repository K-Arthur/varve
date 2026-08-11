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
import {
  type Document,
  imageFill,
  makePaint,
  type RasterMaskAsset,
  type ShapeNode,
} from '../index';
import {
  addRasterMaskAsset,
  markMaskStale,
  removeRasterMaskAsset,
  resolveMask,
  resolveRasterMaskAsset,
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

function pngBytes(dataUrl = PNG_DATA_URL): Uint8Array {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function refreshChunkCrc(bytes: Uint8Array, chunkOffset: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(chunkOffset);
  const crcOffset = chunkOffset + 8 + length;
  view.setUint32(crcOffset, crc32(bytes, chunkOffset + 4, crcOffset));
}

function pngDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

function pngWithIhdrDimensions(width: number, height: number): string {
  const bytes = pngBytes();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(16, width);
  view.setUint32(20, height);
  refreshChunkCrc(bytes, 8);
  return pngDataUrl(bytes);
}

function rasterAssetFromDataUrl(id: string, dataUrl: string): RasterMaskAsset {
  return {
    id,
    mimeType: 'image/png',
    dataUrl,
    width: 1,
    height: 1,
    byteLength: pngBytes(dataUrl).byteLength,
  };
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

  it('uses effective paintRefs consistently for raster mask eligibility and identity', () => {
    const imageId = 'paint-ref-image';
    const image = {
      ...makeShapeNode(imageId, { kind: 'rect', x: 0, y: 0, w: 1, h: 1 }),
      fills: undefined,
      paintRefs: ['image-paint'],
    };
    let doc = addNode(createDocument('Paint ref mask', true), image);
    doc = {
      ...doc,
      paints: {
        'image-paint': makePaint('image-paint', 'Image', {
          ...imageFill('paint-ref-source'),
          image: {
            ...imageFill('paint-ref-source').image!,
            imageWidth: 1,
            imageHeight: 1,
          },
        }),
      },
    };

    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    expect(attached).not.toBe(doc);
    expect(attached.nodes[imageId]?.mask?.rasterMask?.sourceIdentity).toMatchObject({
      kind: 'source-metadata',
      locator: 'paint-ref-source',
      pixelWidth: 1,
      pixelHeight: 1,
    });
    expect(DocumentCodec.decode(JSON.stringify(attached)).ok).toBe(true);
    expect(resolveMask(attached.nodes[imageId]!, attached)).toEqual(attached.nodes[imageId]?.mask);
    expect(resolveRasterMaskAsset(attached, attached.nodes[imageId]!)).toEqual(
      makeRasterAsset('mask-1'),
    );
  });

  it.each([
    ['missing paint reference', undefined],
    [
      'non-image paint reference',
      makePaint('paint', 'Solid', {
        type: 'solid',
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      }),
    ],
  ] as const)('rejects raster masks for a %s', (_label, paint) => {
    const imageId = 'paint-ref-negative';
    const image = {
      ...makeShapeNode(imageId, { kind: 'rect', x: 0, y: 0, w: 1, h: 1 }),
      fills: undefined,
      paintRefs: ['paint'],
    };
    let doc = addNode(createDocument('Paint ref negative', true), image);
    if (paint) doc = { ...doc, paints: { paint } };

    expect(addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'))).toBe(doc);

    const inlineAttached = addRasterMaskAsset(
      makeImageDocument().doc,
      'image-1',
      makeRasterAsset('mask-1'),
    );
    const masked = {
      ...inlineAttached.nodes['image-1']!,
      fills: undefined,
      paintRefs: ['paint'],
    } as ShapeNode;
    const resolutionDoc = {
      ...inlineAttached,
      nodes: { ...inlineAttached.nodes, 'image-1': masked },
      paints: paint ? { paint } : undefined,
    };
    expect(resolveRasterMaskAsset(resolutionDoc, masked)).toBeNull();
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

  it('garbage-collects an unshared prior asset when add replaces a raster mask', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('old-mask'));
    const replaced = addRasterMaskAsset(attached, imageId, makeRasterAsset('new-mask'));

    expect(replaced.nodes[imageId]?.mask?.rasterMask?.assetId).toBe('new-mask');
    expect(replaced.rasterMaskAssets?.['new-mask']).toBeDefined();
    expect(replaced.rasterMaskAssets?.['old-mask']).toBeUndefined();
  });

  it('preserves a shared prior asset when add replaces only one raster mask', () => {
    const { doc, imageId } = makeImageDocument();
    const copy = { ...(doc.nodes[imageId] as ShapeNode), id: 'image-2' };
    let shared = addNode(doc, copy);
    shared = addRasterMaskAsset(shared, imageId, makeRasterAsset('old-mask'));
    shared = addRasterMaskAsset(shared, copy.id, makeRasterAsset('old-mask'));

    const replaced = addRasterMaskAsset(shared, imageId, makeRasterAsset('new-mask'));
    expect(replaced.nodes[imageId]?.mask?.rasterMask?.assetId).toBe('new-mask');
    expect(replaced.nodes[copy.id]?.mask?.rasterMask?.assetId).toBe('old-mask');
    expect(replaced.rasterMaskAssets?.['old-mask']).toBeDefined();
  });

  it.each(['toString', 'constructor'])(
    'treats %s as an asset id only when it is an own table entry',
    (assetId) => {
      const { doc, imageId } = makeImageDocument();
      const nodeWithInheritedReference = {
        ...doc.nodes[imageId]!,
        mask: {
          type: 'alpha' as const,
          visible: true,
          rasterMask: {
            assetId,
            coordinateSpace: 'source-image-pixels' as const,
            sourceIdentity: metadataIdentity(),
          },
        },
      } as ShapeNode;
      expect(
        resolveRasterMaskAsset({ rasterMaskAssets: {} }, nodeWithInheritedReference),
      ).toBeNull();

      const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset(assetId));
      expect(attached).not.toBe(doc);
      expect(Object.hasOwn(attached.rasterMaskAssets ?? {}, assetId)).toBe(true);
      expect(resolveRasterMaskAsset(attached, attached.nodes[imageId]!)).toEqual(
        makeRasterAsset(assetId),
      );

      const removed = removeRasterMaskAsset(attached, imageId);
      expect(Object.hasOwn(removed.rasterMaskAssets ?? {}, assetId)).toBe(false);
    },
  );

  it('does not resolve an inherited __proto__ value as a raster asset', () => {
    const { doc, imageId } = makeImageDocument();
    const node = {
      ...doc.nodes[imageId]!,
      mask: {
        type: 'alpha' as const,
        visible: true,
        rasterMask: {
          assetId: '__proto__',
          coordinateSpace: 'source-image-pixels' as const,
          sourceIdentity: metadataIdentity(),
        },
      },
    } as ShapeNode;

    expect(resolveRasterMaskAsset({ rasterMaskAssets: {} }, node)).toBeNull();
  });

  it('updates to a prototype-named own asset without treating the prototype as a collision', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const updated = updateRasterMaskAsset(attached, imageId, makeRasterAsset('constructor'));

    expect(updated).not.toBe(attached);
    expect(updated.nodes[imageId]?.mask?.rasterMask?.assetId).toBe('constructor');
    expect(Object.hasOwn(updated.rasterMaskAssets ?? {}, 'constructor')).toBe(true);
    expect(updated.rasterMaskAssets?.['mask-1']).toBeUndefined();
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

  it('rejects edits after the safe edit revision is exhausted', () => {
    const { doc, imageId } = makeImageDocument();
    const beforeLimit = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'), {
      editRevision: Number.MAX_SAFE_INTEGER - 1,
    });
    const atLimit = updateRasterMaskAsset(beforeLimit, imageId, makeRasterAsset('mask-2'));
    expect(atLimit.nodes[imageId]?.mask?.rasterMask?.editRevision).toBe(Number.MAX_SAFE_INTEGER);

    const exhausted = updateRasterMaskAsset(atLimit, imageId, makeRasterAsset('mask-3'));
    expect(exhausted).toBe(atLimit);
    expect(exhausted.rasterMaskAssets?.['mask-3']).toBeUndefined();
  });

  it('preserves identity and revision for an exact raster asset update no-op', () => {
    const { doc, imageId } = makeImageDocument();
    const asset = makeRasterAsset('mask-1');
    const attached = addRasterMaskAsset(doc, imageId, asset, { editRevision: 4 });

    const unchanged = updateRasterMaskAsset(attached, imageId, { ...asset });
    expect(unchanged).toBe(attached);
    expect(unchanged.nodes[imageId]?.mask?.rasterMask?.editRevision).toBe(4);

    const descriptorChanged = updateRasterMaskAsset(
      attached,
      imageId,
      makeRasterAsset('equivalent-payload-new-id'),
    );
    expect(descriptorChanged).not.toBe(attached);
    expect(descriptorChanged.nodes[imageId]?.mask?.rasterMask).toMatchObject({
      assetId: 'equivalent-payload-new-id',
      editRevision: 5,
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

  it('marks a raster mask stale when the source image is replaced', () => {
    const { doc, imageId } = makeImageDocument();
    const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
    const stale = markMaskStale(attached, imageId, 'source-replaced');
    const mask = stale.nodes[imageId]?.mask;
    expect(mask?.rasterMask?.staleReason).toBe('source-replaced');
    expect(mask?.visible).toBe(false);
    expect(mask?.rasterMask?.sourceIdentity.revision).toBe(2);
    // Asset is preserved so user can re-enable or re-run
    expect(stale.rasterMaskAssets?.['mask-1']).toBeDefined();
  });

  it('returns the same document when marking stale on a maskless node', () => {
    const { doc, imageId } = makeImageDocument();
    expect(markMaskStale(doc, imageId, 'source-replaced')).toBe(doc);
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
  it.each(['toString', 'constructor'])(
    'rejects an inherited %s asset reference during decode',
    (assetId) => {
      const { doc, imageId } = makeImageDocument();
      const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1'));
      const raw = JSON.parse(JSON.stringify(attached)) as Record<string, unknown>;
      raw.rasterMaskAssets = {};
      const node = (raw.nodes as Record<string, Record<string, unknown>>)[imageId]!;
      const fill = (node.fills as Record<string, unknown>[])[0]!;
      const image = fill.image as Record<string, unknown>;
      delete image.imageWidth;
      delete image.imageHeight;
      const rasterMask = (node.mask as Record<string, unknown>).rasterMask as Record<
        string,
        unknown
      >;
      rasterMask.assetId = assetId;
      const identity = rasterMask.sourceIdentity as Record<string, unknown>;
      delete identity.pixelWidth;
      delete identity.pixelHeight;

      const decoded = DocumentCodec.decode(JSON.stringify(raw));
      expect(decoded.ok).toBe(false);
      if (decoded.ok) return;
      expect(decoded.error).toMatch(/missing raster mask asset/i);
    },
  );

  it('rejects structurally corrupt PNG mask payloads', () => {
    const base = pngBytes();
    const truncatedIhdr = base.slice(0, 24);
    const missingIend = base.slice(0, -12);
    const badCrc = base.slice();
    badCrc[29] = badCrc[29]! ^ 0xff;
    const badChunkBounds = base.slice();
    new DataView(
      badChunkBounds.buffer,
      badChunkBounds.byteOffset,
      badChunkBounds.byteLength,
    ).setUint32(33, 0xfffffff0);
    const badIhdrFields = base.slice();
    badIhdrFields[26] = 1;
    refreshChunkCrc(badIhdrFields, 8);
    const badIdatHeader = base.slice();
    badIdatHeader[41] = 0;
    refreshChunkCrc(badIdatHeader, 33);
    const idatLength = new DataView(base.buffer, base.byteOffset, base.byteLength).getUint32(33);
    const idatEnd = 33 + 12 + idatLength;
    const missingIdat = new Uint8Array(33 + (base.byteLength - idatEnd));
    missingIdat.set(base.slice(0, 33));
    missingIdat.set(base.slice(idatEnd), 33);

    const variants = [
      ['truncated IHDR', truncatedIhdr, /IHDR.*(truncated|complete)|chunk bounds/i],
      ['missing IEND', missingIend, /IEND/i],
      ['bad CRC', badCrc, /CRC/i],
      ['bad chunk bounds', badChunkBounds, /chunk bounds|truncated/i],
      ['illegal IHDR fields', badIhdrFields, /IHDR fields/i],
      ['illegal IDAT zlib header', badIdatHeader, /IDAT.*zlib/i],
      ['missing IDAT', missingIdat, /IDAT/i],
    ] as const;

    for (const [index, [_label, bytes, expected]] of variants.entries()) {
      expect(
        validateRasterMaskAsset(rasterAssetFromDataUrl(`case-${index}`, pngDataUrl(bytes))),
      ).toMatch(expected);
    }
  });

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

  it.each(['toString', 'constructor'])(
    'collects only an own %s raster asset in a copied node closure',
    (assetId) => {
      const { doc, imageId } = makeImageDocument();
      const attached = addRasterMaskAsset(doc, imageId, makeRasterAsset(assetId));
      const ownClosure = DocumentCodec.collectNodeClosure(attached, [imageId]);
      expect(Object.hasOwn(ownClosure.rasterMaskAssets ?? {}, assetId)).toBe(true);
      expect(ownClosure.rasterMaskAssets?.[assetId]).toEqual(makeRasterAsset(assetId));

      const missing = {
        ...attached,
        rasterMaskAssets: {},
      };
      const missingClosure = DocumentCodec.collectNodeClosure(missing, [imageId]);
      expect(missingClosure.rasterMaskAssets).toBeUndefined();
    },
  );

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
