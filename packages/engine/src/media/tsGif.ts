/**
 * Pure-TS GIF decoder (GIF87a/89a) — LZW decompression, palette expansion,
 * transparency, interlace de-interlacing, GCE timing/disposal, Netscape
 * loop extension.
 *
 * Used as the web fallback provider (no native/WASM dependency) and as the
 * node-env golden path: its output must match `varve-media`'s GIF decode
 * exactly (rect-sized RGBA frames, same timing policy).
 *
 * Allocation is bounded: canvas/frame rects are checked against the limits
 * before any buffer is created; malformed streams raise `GifDecodeError`.
 */

import type { DecodedSourceFrame, MediaDisposal } from './types';
import { MEDIA_DECODE_LIMITS } from './types';

export class GifDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GifDecodeError';
  }
}

export interface GifDecodeResult {
  width: number;
  height: number;
  loopCount: number | 'infinite';
  frames: DecodedSourceFrame[];
}

interface GifState {
  bytes: Uint8Array;
  frames: DecodedSourceFrame[];
  loopCount: number | 'infinite' | undefined;
}

/** Decode every frame of a GIF into rect-sized RGBA source frames. */
export function decodeGifFrames(bytes: Uint8Array): GifDecodeResult {
  if (bytes.length < 13) throw new GifDecodeError('gif: file too short');
  const version = String.fromCharCode(bytes[3]!, bytes[4]!, bytes[5]!);
  if (version !== '87a' && version !== '89a') {
    throw new GifDecodeError('gif: unsupported version');
  }
  const state: GifState = { bytes, frames: [], loopCount: undefined };
  let pos = 6;
  const width = readU16LE(bytes, pos);
  const height = readU16LE(bytes, pos + 2);
  const packed = bytes[pos + 4]!;
  checkCanvas(width, height);
  let globalPalette: Uint8Array | null = null;
  if (packed & 0x80) {
    globalPalette = bytes.subarray(pos + 7, pos + 7 + 3 * (1 << ((packed & 7) + 1)));
  }
  pos += 7 + (globalPalette?.length ?? 0);

  let pending: { delayCentis: number; disposal: MediaDisposal; transparent: number | null } | null =
    null;

  while (pos < bytes.length) {
    const block = bytes[pos]!;
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = bytes[pos + 1]!;
      pos += 2;
      if (label === 0xf9) {
        const size = bytes[pos]!;
        if (size < 4 || pos + 1 + size >= bytes.length) {
          throw new GifDecodeError('gif: truncated GCE');
        }
        const gcePacked = bytes[pos + 1]!;
        pending = {
          delayCentis: readU16LE(bytes, pos + 2),
          disposal: gifDisposal((gcePacked >> 2) & 7),
          transparent: gcePacked & 1 ? bytes[pos + 4]! : null,
        };
        pos += 1 + size + 1;
      } else if (label === 0xff) {
        const size = bytes[pos]!;
        if (pos + 1 + size > bytes.length) throw new GifDecodeError('gif: truncated app extension');
        if (size >= 11 && asciiEquals(bytes, pos + 1, 'NETSCAPE2.0')) {
          let sub = pos + 1 + size;
          while (sub < bytes.length && bytes[sub] !== 0) {
            const subLen = bytes[sub]!;
            if (sub + 1 + subLen > bytes.length) {
              throw new GifDecodeError('gif: truncated NETSCAPE extension');
            }
            if (subLen >= 3 && bytes[sub + 1] === 1) {
              const loop = readU16LE(bytes, sub + 2);
              state.loopCount = loop === 0 ? 'infinite' : loop;
            }
            sub += 1 + subLen;
          }
        }
        pos = skipSubBlocks(bytes, pos + 1 + size);
      } else {
        pos = skipSubBlocks(bytes, pos);
      }
    } else if (block === 0x2c) {
      if (pos + 10 > bytes.length) throw new GifDecodeError('gif: truncated image descriptor');
      const left = readU16LE(bytes, pos + 1);
      const top = readU16LE(bytes, pos + 3);
      const frameW = readU16LE(bytes, pos + 5);
      const frameH = readU16LE(bytes, pos + 7);
      const flags = bytes[pos + 9]!;
      const interlaced = (flags & 0x40) !== 0;
      let palette = globalPalette;
      pos += 10;
      if (flags & 0x80) {
        palette = bytes.subarray(pos, pos + 3 * (1 << ((flags & 7) + 1)));
        pos += 3 * (1 << ((flags & 7) + 1));
      }
      if (!palette) throw new GifDecodeError('gif: frame without palette');
      checkCanvas(frameW, frameH);
      const minCodeSize = bytes[pos]!;
      if (minCodeSize < 2 || minCodeSize > 8) {
        throw new GifDecodeError(`gif: invalid LZW min code size ${minCodeSize}`);
      }
      pos += 1;
      const { data, nextPos } = collectSubBlocks(bytes, pos);
      pos = nextPos;
      const indices = lzwDecode(data, minCodeSize);
      if (indices.length < frameW * frameH) {
        throw new GifDecodeError(
          `gif: frame data too short (${indices.length} < ${frameW * frameH} pixels)`,
        );
      }
      const rgba = expandToRgba(
        indices,
        frameW,
        frameH,
        palette,
        pending?.transparent ?? null,
        interlaced,
      );
      const delayMs = pending ? pending.delayCentis * 10 : 100;
      state.frames.push({
        index: state.frames.length,
        x: left,
        y: top,
        width: frameW,
        height: frameH,
        durationMs: delayMs,
        blend: 'source',
        disposal: pending?.disposal ?? 'none',
        preComposited: false,
        rgba,
      });
      pending = null;
    } else {
      throw new GifDecodeError(`gif: unexpected block 0x${block.toString(16)}`);
    }
  }
  if (state.frames.length === 0) throw new GifDecodeError('gif: no frames');
  return {
    width,
    height,
    loopCount: state.loopCount ?? 1,
    frames: state.frames,
  };
}

function checkCanvas(width: number, height: number): void {
  if (width === 0 || height === 0) throw new GifDecodeError('gif: zero frame size');
  if (width > MEDIA_DECODE_LIMITS.maxDimension || height > MEDIA_DECODE_LIMITS.maxDimension) {
    throw new GifDecodeError('gif: frame exceeds dimension limit');
  }
  if (width * height > MEDIA_DECODE_LIMITS.maxPixelsPerFrame) {
    throw new GifDecodeError('gif: frame exceeds pixel limit');
  }
}

function gifDisposal(raw: number): MediaDisposal {
  if (raw === 2) return 'background';
  if (raw === 3) return 'previous';
  return 'none';
}

function collectSubBlocks(bytes: Uint8Array, pos: number): { data: Uint8Array; nextPos: number } {
  const parts: Uint8Array[] = [];
  let total = 0;
  let p = pos;
  while (p < bytes.length) {
    const size = bytes[p]!;
    if (size === 0) break;
    if (p + 1 + size > bytes.length) throw new GifDecodeError('gif: truncated data block');
    parts.push(bytes.subarray(p + 1, p + 1 + size));
    total += size;
    p += 1 + size;
  }
  if (p >= bytes.length && bytes[bytes.length - 1] !== 0) {
    throw new GifDecodeError('gif: unterminated data block');
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return { data: out, nextPos: p + 1 };
}

function skipSubBlocks(bytes: Uint8Array, pos: number): number {
  let p = pos;
  while (p < bytes.length) {
    const size = bytes[p]!;
    if (size === 0) return p + 1;
    p += 1 + size;
  }
  throw new GifDecodeError('gif: unterminated data block');
}

/** GIF LZW decompression (variable code size, early dictionary reset). */
export function lzwDecode(data: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const base = eoi + 1; // first dictionary code
  let codeSize = minCodeSize + 1;
  // dictionary: `dictPrev[i]` = previous code, `dictChar[i]` = last char of
  // the entry for code `base + i`
  const dictPrev = new Int32Array(4096);
  const dictChar = new Uint8Array(4096);
  let next = base;
  let prevCode: number | null = null;
  let prevEntry: number[] | null = null;
  const out: number[] = [];

  let acc = 0;
  let nbits = 0;
  let p = 0;
  const readCode = (): number => {
    while (nbits < codeSize) {
      if (p >= data.length) throw new GifDecodeError('gif: LZW stream truncated');
      acc |= data[p]! << nbits;
      p += 1;
      nbits += 8;
    }
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize;
    nbits -= codeSize;
    return code;
  };

  const buildEntry = (code: number): number[] => {
    const stack: number[] = [];
    let c = code;
    while (c >= base) {
      const i = c - base;
      stack.push(dictChar[i]!);
      c = dictPrev[i]!;
    }
    stack.push(c);
    stack.reverse();
    return stack;
  };

  while (true) {
    const code = readCode();
    if (code === eoi) break;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = base;
      prevCode = null;
      prevEntry = null;
      continue;
    }
    let entry: number[];
    if (code < clear) {
      entry = [code];
    } else if (code < next) {
      entry = buildEntry(code);
    } else if (code === next) {
      if (!prevEntry) throw new GifDecodeError('gif: dictionary code before any literal');
      entry = [...prevEntry, prevEntry[0]!];
    } else {
      throw new GifDecodeError(`gif: invalid LZW code ${code}`);
    }
    for (const v of entry) out.push(v);
    if (prevCode !== null) {
      if (next >= 4096) throw new GifDecodeError('gif: dictionary overflow');
      dictPrev[next - base] = prevCode;
      dictChar[next - base] = entry[0]!;
      next += 1;
      if (next >= 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    prevCode = code;
    prevEntry = entry;
  }
  return new Uint8Array(out);
}

/** Expand palette indices to RGBA, applying transparency and interlacing. */
export function expandToRgba(
  indices: Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array,
  transparentIndex: number | null,
  interlaced: boolean,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const rowOrder: number[] = [];
  if (interlaced) {
    // interlace passes: every 8th from 0, then every 8th from 4, then every
    // 4th from 2, then every 2nd from 1
    const passes: Array<[number, number]> = [
      [0, 8],
      [4, 8],
      [2, 4],
      [1, 2],
    ];
    for (const [start, step] of passes) {
      for (let r = start; r < height; r += step) rowOrder.push(r);
    }
  } else {
    for (let r = 0; r < height; r++) rowOrder.push(r);
  }
  const colors = palette.length / 3;
  for (let srcRow = 0; srcRow < height; srcRow++) {
    const dstRow = rowOrder[srcRow]!;
    for (let x = 0; x < width; x++) {
      const idx = indices[srcRow * width + x]!;
      const o = (dstRow * width + x) * 4;
      if (idx === transparentIndex) {
        rgba[o + 3] = 0;
        continue;
      }
      if (idx >= colors) throw new GifDecodeError(`gif: palette index ${idx} out of range`);
      rgba[o] = palette[idx * 3]!;
      rgba[o + 1] = palette[idx * 3 + 1]!;
      rgba[o + 2] = palette[idx * 3 + 2]!;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

function asciiEquals(bytes: Uint8Array, pos: number, expected: string): boolean {
  if (pos + expected.length > bytes.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[pos + i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

function readU16LE(bytes: Uint8Array, pos: number): number {
  return bytes[pos]! | (bytes[pos + 1]! << 8);
}
