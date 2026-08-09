/**
 * End-to-end ingestion wiring: raster bytes -> normalized metadata ->
 * content-addressed asset with oriented dimensions + ICC registry.
 */
import { describe, expect, it } from 'vitest';
import { importFile } from './import';
import {
  buildJpegWithExifOrientation,
  buildJpegWithIccChunks,
  buildMinimalIccProfile,
  buildPngWithIccp,
  buildPngWithoutIccp,
} from './metadata/__fixtures__';

/**
 * Insert a complete SOF0 marker after the SOI so the JPEG carries
 * parseable stored dimensions. JPEG SOF0 layout: precision(1), height(2),
 * width(2) — the dimension reader reads height at +5 and width at +7.
 * Defaults describe a stored 400x240 source (width 400, height 240).
 */
function withSof0(jpeg: Uint8Array, height = 240, width = 400): Uint8Array {
  const sofs = new Uint8Array([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  ]);
  return new Uint8Array([...jpeg.subarray(0, 2), ...sofs, ...jpeg.subarray(2)]);
}

function orientedJpeg(orientation: number, littleEndian = true): Uint8Array {
  return withSof0(buildJpegWithExifOrientation(orientation, littleEndian));
}

function iccJpeg(profile: Uint8Array): Uint8Array {
  return withSof0(buildJpegWithIccChunks(profile, 40));
}

describe('raster ingestion metadata wiring', () => {
  it('records EXIF orientation and oriented display dimensions on the asset', () => {
    const result = importFile('photo.jpg', orientedJpeg(6));
    const node = result.document.nodes[result.nodeIds[0]!]!;
    const fill = node.fills?.find((f) => f.type === 'image');
    const assetId = fill?.image?.assetId;
    const asset = assetId ? result.document.assets?.[assetId] : undefined;
    expect(asset).toBeDefined();
    // Stored 400x240 (SOF0 above), orientation 6 => displayed 240x400.
    expect(asset?.metadata?.orientation).toBe(6);
    expect(asset?.metadata?.pixelWidth).toBe(400);
    expect(asset?.metadata?.pixelHeight).toBe(240);
    expect(asset?.naturalWidth).toBe(240);
    expect(asset?.naturalHeight).toBe(400);
    // Placement falls back to the same oriented dimensions before decode.
    expect(fill?.image?.imageWidth).toBe(240);
    expect(fill?.image?.imageHeight).toBe(400);
    // The shape is sized to the displayed dimensions.
    const shape = node.kind === 'shape' ? node.shape : undefined;
    expect(shape?.kind).toBe('rect');
    if (shape?.kind === 'rect') {
      expect(shape.w).toBe(240);
      expect(shape.h).toBe(400);
    }
  });

  it('keeps stored dimensions for orientation 1 (no transform)', () => {
    const result = importFile('photo.jpg', orientedJpeg(1));
    const node = result.document.nodes[result.nodeIds[0]!]!;
    const fill = node.fills?.find((f) => f.type === 'image');
    const asset = fill?.image?.assetId ? result.document.assets?.[fill.image.assetId] : undefined;
    expect(asset?.metadata?.orientation).toBeUndefined();
    expect(asset?.naturalWidth).toBe(400);
    expect(asset?.naturalHeight).toBe(240);
  });

  it('writes no metadata block for a plain complete PNG', () => {
    const result = importFile('plain.png', buildPngWithoutIccp());
    const node = result.document.nodes[result.nodeIds[0]!]!;
    const fill = node.fills?.find((f) => f.type === 'image');
    const asset = fill?.image?.assetId ? result.document.assets?.[fill.image.assetId] : undefined;
    expect(asset?.metadata).toBeUndefined();
    expect(asset?.naturalWidth).toBe(1);
    expect(asset?.naturalHeight).toBe(1);
  });

  it('extracts a JPEG ICC profile into the document registry and references it', () => {
    const profile = buildMinimalIccProfile(300, 'Ingest test profile');
    const result = importFile('profiled.jpg', iccJpeg(profile));
    const node = result.document.nodes[result.nodeIds[0]!]!;
    const fill = node.fills?.find((f) => f.type === 'image');
    const asset = fill?.image?.assetId ? result.document.assets?.[fill.image.assetId] : undefined;
    expect(asset?.metadata?.iccStatus).toBe('valid');
    expect(asset?.metadata?.iccDescription).toBe('Ingest test profile');
    const profileId = asset?.metadata?.iccProfileId;
    expect(profileId).toBeDefined();
    const entry = profileId ? result.document.iccProfiles?.[profileId] : undefined;
    expect(entry).toBeDefined();
    expect(entry?.byteLength).toBe(profile.length);
    // Base64 round-trips back to the exact profile bytes.
    const decoded = Uint8Array.from(atob(entry!.profileBase64), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(profile));
  });

  it('deduplicates identical profiles across two imports', () => {
    const profile = buildMinimalIccProfile(128);
    const a = importFile('a.jpg', iccJpeg(profile));
    const b = importFile('b.jpg', iccJpeg(profile));
    const profileIdA = Object.keys(a.document.iccProfiles ?? {})[0];
    const profileIdB = Object.keys(b.document.iccProfiles ?? {})[0];
    expect(profileIdA).toBe(profileIdB);
    expect(Object.keys(a.document.iccProfiles ?? {})).toHaveLength(1);
  });

  it('extracts a PNG iCCP profile', () => {
    const profile = buildMinimalIccProfile(200, 'PNG profile');
    const result = importFile('profiled.png', buildPngWithIccp(profile));
    const node = result.document.nodes[result.nodeIds[0]!]!;
    const fill = node.fills?.find((f) => f.type === 'image');
    const asset = fill?.image?.assetId ? result.document.assets?.[fill.image.assetId] : undefined;
    expect(asset?.metadata?.iccStatus).toBe('valid');
    expect(asset?.metadata?.iccDescription).toBe('PNG profile');
  });

  it('records an explicit invalid status for a corrupt embedded profile', () => {
    const profile = buildMinimalIccProfile(128);
    profile[36] = 0; // break "acsp"
    const result = importFile('bad.jpg', iccJpeg(profile));
    const node = result.document.nodes[result.nodeIds[0]!]!;
    const fill = node.fills?.find((f) => f.type === 'image');
    const asset = fill?.image?.assetId ? result.document.assets?.[fill.image.assetId] : undefined;
    expect(asset?.metadata?.iccStatus).toBe('invalid');
    expect(asset?.metadata?.iccProfileId).toBeUndefined();
  });

  it('records big-endian EXIF orientation identically to little-endian', () => {
    const le = importFile('le.jpg', orientedJpeg(8, true));
    const be = importFile('be.jpg', orientedJpeg(8, false));
    const fillLe = le.document.nodes[le.nodeIds[0]!]!.fills?.find((f) => f.type === 'image');
    const fillBe = be.document.nodes[be.nodeIds[0]!]!.fills?.find((f) => f.type === 'image');
    expect(le.document.assets?.[fillLe!.image!.assetId!]?.metadata?.orientation).toBe(8);
    expect(be.document.assets?.[fillBe!.image!.assetId!]?.metadata?.orientation).toBe(8);
  });

  it('round-trips metadata through the document codec', async () => {
    const result = importFile('photo.jpg', orientedJpeg(6));
    const { DocumentCodec } = await import('@varve/scene');
    const encoded = DocumentCodec.encode(result.document);
    const decoded = DocumentCodec.decode(encoded);
    if (!decoded.ok) throw new Error('decode failed');
    expect(Number(decoded.document.formatVersion)).toBeGreaterThanOrEqual(2);
    const node = decoded.document.nodes[result.nodeIds[0]!]!;
    const fill = node.fills?.find((f) => f.type === 'image');
    const asset = fill?.image?.assetId ? decoded.document.assets?.[fill.image.assetId] : undefined;
    expect(asset?.metadata?.orientation).toBe(6);
    expect(asset?.naturalWidth).toBe(240);
    expect(asset?.naturalHeight).toBe(400);
  });
});
