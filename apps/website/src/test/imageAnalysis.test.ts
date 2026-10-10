import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  analyseImage,
  analysePng,
  buffersEqual,
  crc32,
  pngDimensions,
  readAvifInfo,
  readPngChunks,
} from '../../../../scripts/screenshots/lib/image-analysis.mjs';

/**
 * Regression tests for the shared PNG analysis used by the screenshot
 * validator (scripts/screenshots/validate.mjs) and the capture pipeline.
 *
 * These exist because the previous check only read the 8-byte signature and
 * the IHDR: a truncated file, a byte-flipped file with unchanged length, and a
 * uniformly blank image all passed. Each of those cases has a test here.
 */

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  // CRC covers the type and data, never the length field.
  const crcBuf = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  out.writeUInt32BE(crc32(crcBuf), 8 + data.length);
  return out;
}

/** A structurally valid, uniformly white RGBA PNG built without any dependency. */
function uniformPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    // Filter byte 0 (None) then opaque white for every pixel.
    const start = row * stride + 1;
    raw.fill(0xff, start, start + width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A PNG with per-pixel noise, i.e. not uniform. */
function noisyPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  let seed = 1;
  for (let i = 0; i < raw.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = seed & 0xff;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('image analysis', () => {
  it('accepts a structurally valid, varied image', () => {
    const png = noisyPng(200, 200);
    const result = analysePng(png);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
    expect(result.uniform).toBe(false);
    expect(pngDimensions(png)).toEqual({ width: 200, height: 200 });
  });

  it('rejects bytes that are not a PNG', () => {
    const result = analysePng(Buffer.from('this is not a png at all, it is text'));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not a PNG/);
    expect(readPngChunks(Buffer.from('nope'))).toBeNull();
  });

  it('detects a truncated file that keeps its signature and IHDR', () => {
    const png = noisyPng(120, 120);
    // Cut inside the IDAT payload. The signature and IHDR survive, so the old
    // signature+IHDR check would still have accepted this file.
    const truncated = png.subarray(0, Math.floor(png.length * 0.6));
    expect(pngDimensions(truncated)).not.toBeNull();
    const result = analysePng(truncated);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('detects a byte flip that preserves file length and dimensions', () => {
    const png = noisyPng(96, 96);
    const corrupted = Buffer.from(png);
    // Flip one byte inside the IDAT data, well past the header.
    corrupted[60] = corrupted[60] ^ 0xff;
    expect(corrupted.length).toBe(png.length);
    expect(pngDimensions(corrupted)).toEqual({ width: 96, height: 96 });
    const result = analysePng(corrupted);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/CRC|inflate/);
  });

  it('flags a uniformly blank image even though it is a valid PNG', () => {
    const blank = uniformPng(200, 200);
    const result = analysePng(blank);
    expect(result.uniform).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.distinctByteValues).toBeLessThanOrEqual(8);
  });

  it('does not flag a small-but-real image as uniform', () => {
    const png = noisyPng(60, 60);
    const result = analysePng(png);
    // Below the minInflatedBytes floor the heuristic stays silent; the point is
    // that it must not produce a false positive on real content.
    expect(result.uniform).toBe(false);
  });

  it('compares copies by bytes, not by length', () => {
    const a = Buffer.from('aaaa');
    const b = Buffer.from('aaab');
    expect(a.length).toBe(b.length);
    expect(buffersEqual(a, b)).toBe(false);
    expect(buffersEqual(a, Buffer.from('aaaa'))).toBe(true);
  });

  it('reads AVIF dimensions from the ispe box', () => {
    const box = (type: string, payload: Buffer): Buffer => {
      const out = Buffer.alloc(8 + payload.length);
      out.writeUInt32BE(out.length, 0);
      out.write(type, 4, 'latin1');
      payload.copy(out, 8);
      return out;
    };
    const ftyp = box(
      'ftyp',
      Buffer.concat([
        Buffer.from('avif', 'latin1'),
        Buffer.alloc(4),
        Buffer.from('avif', 'latin1'),
      ]),
    );
    const ispePayload = Buffer.alloc(12);
    ispePayload.writeUInt32BE(640, 4);
    ispePayload.writeUInt32BE(480, 8);
    const avif = Buffer.concat([
      ftyp,
      box(
        'meta',
        Buffer.concat([Buffer.alloc(4), box('iprp', box('ipco', box('ispe', ispePayload)))]),
      ),
    ]);
    expect(readAvifInfo(avif)).toMatchObject({ format: 'avif', width: 640, height: 480 });
    expect(analyseImage(avif)).toMatchObject({
      valid: true,
      format: 'avif',
      width: 640,
      height: 480,
    });
  });

  it('rejects every committed captured screenshot that does not decode', () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'apps', 'website', 'src', 'data', 'screenshot-manifest.json'),
        'utf8',
      ),
    ) as { scenes: Record<string, { file?: string; status?: string }> };
    const publicDir = path.join(ROOT, 'apps', 'website', 'public', 'screenshots');
    const captured = Object.entries(manifest.scenes).filter(
      ([, scene]) => scene.status === 'captured' && scene.file,
    );
    expect(captured.length).toBeGreaterThan(0);
    for (const [id, scene] of captured) {
      const file = path.join(publicDir, scene.file as string);
      if (!fs.existsSync(file)) continue; // existence is validate.mjs's job
      const result = analysePng(fs.readFileSync(file));
      expect(result.errors, `${id} (${scene.file}): ${result.errors.join('; ')}`).toEqual([]);
    }
  });
});
