// Generates hand-encoded fixtures that ImageMagick cannot produce correctly:
// APNG with subrects/variable timing/dispose+blend ops, and GIF edge cases
// (interlaced, dispose=previous, finite loop, zero delays).
// Run from the repo root: node scripts/generate-media-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = 'packages/engine/src/media/__fixtures__';
mkdirSync(OUT, { recursive: true });

// ── helpers ────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// ── GIF encoder (exact control of GCE/disposal/interlace/loop) ─────────────

function gifEncode(frames, { loop = 0 } = {}) {
  // frames: [{ width, height, left, top, pixels: Uint8Array RGBA,
  //            delayMs, dispose: 0|1|2|3, transparentIndex?: number,
  //            interlaced?: boolean, palette?: [r,g,b][], useLocal?: boolean }]
  const parts = [];
  parts.push(Buffer.from('GIF89a', 'ascii'));
  const w = frames[0].width;
  const h = frames[0].height;
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(w, 0);
  lsd.writeUInt16LE(h, 2);
  lsd[4] = 0xf7; // GCT present, 8 bits, 256 colors
  lsd[5] = 0;
  lsd[6] = 0;
  parts.push(lsd);
  const gct = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) gct.writeUInt8(0, i); // black fill
  parts.push(gct);

  if (loop !== undefined) {
    const net = Buffer.from('NETSCAPE2.0', 'ascii');
    // Netscape 2.0 loop extension: sub-block `01 <loop-le16>` (3 bytes).
    const sub = Buffer.from([1, loop & 0xff, (loop >> 8) & 0xff]);
    const app = Buffer.from([0x21, 0xff, net.length, ...net, sub.length, ...sub, 0x00]);
    parts.push(app);
  }

  for (const frame of frames) {
    const delayCentis = Math.round(frame.delayMs / 10);
    const gce = Buffer.alloc(8);
    gce[0] = 0x21;
    gce[1] = 0xf9;
    gce[2] = 4;
    let packed = 0;
    if (frame.transparentIndex !== undefined) packed |= 1;
    packed |= (frame.dispose & 7) << 2;
    gce[3] = packed;
    gce.writeUInt16LE(delayCentis, 4);
    gce[6] = frame.transparentIndex ?? 0;
    gce[7] = 0;
    parts.push(gce);

    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(frame.left ?? 0, 1);
    desc.writeUInt16LE(frame.top ?? 0, 3);
    desc.writeUInt16LE(frame.width, 5);
    desc.writeUInt16LE(frame.height, 7);
    let flags = frame.interlaced ? 0x40 : 0;
    let tableSizeBits = 0;
    // build palette from frame pixels
    const entries = [];
    const indexOf = new Map();
    const idx = new Uint8Array(frame.width * frame.height);
    const { pixels } = frame;
    let nextIndex = 0;
    if (frame.transparentIndex !== undefined) {
      entries.push([0, 0, 0]); // slot 0 reserved for the transparent index
      indexOf.set('t', frame.transparentIndex);
      nextIndex = 1;
    }
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      let key;
      if (a === 0 && frame.transparentIndex !== undefined) {
        key = frame.transparentIndex;
      } else {
        key = `${r},${g},${b}`;
        if (!indexOf.has(key)) {
          indexOf.set(key, nextIndex);
          entries.push([r, g, b]);
          nextIndex++;
        }
        key = indexOf.get(key);
      }
      idx[i / 4] = key;
    }
    if (entries.length > 256) throw new Error('fixture palette overflow');
    // GIF color table sizes are 2^(bits+1): a single color still occupies a
    // 2-entry table (second entry padded black).
    const tableSize = Math.max(2, highestPowerOfTwo(entries.length));
    tableSizeBits = Math.log2(tableSize) - 1;
    flags |= 0x80 | tableSizeBits;
    desc[9] = flags;
    parts.push(desc);
    const localPalette = Buffer.alloc(tableSize * 3);
    entries.forEach(([r, g, b], i) => {
      localPalette[i * 3] = r;
      localPalette[i * 3 + 1] = g;
      localPalette[i * 3 + 2] = b;
    });
    parts.push(localPalette);

    // rows in interlace pass order when interlaced
    let rows = [];
    if (frame.interlaced) {
      const passes = [
        (r) => r % 8 === 0,
        (r) => r % 8 === 4,
        (r) => r % 4 === 2,
        (r) => r % 2 === 1,
      ];
      for (const test of passes) {
        for (let r = 0; r < frame.height; r++) if (test(r)) rows.push(r);
      }
    } else {
      rows = frame.height === 0 ? [] : Array.from({ length: frame.height }, (_, r) => r);
    }
    const data = Buffer.alloc(rows.length * frame.width);
    rows.forEach((r, i) => {
      for (let x = 0; x < frame.width; x++) data[i * frame.width + x] = idx[r * frame.width + x];
    });
    // LZW min code size: indices are 8-bit, so the code size is always 8
    // (the palette table size in the descriptor is independent of this).
    parts.push(Buffer.from([8]));
    parts.push(...lzwEncode(data));
    parts.push(Buffer.from([0]));
  }
  parts.push(Buffer.from([0x3b])); // trailer
  return Buffer.concat(parts);
}

function highestPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function lzwEncode(data) {
  // data: indices 0..255
  const minCodeSize = 8;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let next = eoi + 1;
  let codeSize = minCodeSize + 1;
  const dict = new Map();
  let prefix = -1;
  const out = [];
  const emit = (code) => out.push(code, codeSize);
  const reset = () => {
    next = eoi + 1;
    codeSize = minCodeSize + 1;
  };
  emit(clear);
  for (let i = 0; i < data.length; i++) {
    const k = data[i];
    if (prefix === -1) {
      prefix = k;
      continue;
    }
    const key = prefix * 256 + k;
    const existing = dict.get(key);
    if (existing !== undefined) {
      prefix = existing;
      continue;
    }
    emit(prefix);
    dict.set(key, next);
    next++;
    if (next === 1 << codeSize) {
      if (codeSize < 12) codeSize++;
      else {
        emit(clear);
        reset();
      }
    }
    prefix = k;
  }
  if (prefix !== -1) emit(prefix);
  out.push(eoi, codeSize);
  // pack codes LSB-first into bytes
  let acc = 0;
  let nbits = 0;
  const bytes = [];
  for (let i = 0; i < out.length; i += 2) {
    const code = out[i];
    const width = out[i + 1];
    acc |= code << nbits;
    nbits += width;
    while (nbits >= 8) {
      bytes.push(acc & 0xff);
      acc >>>= 8;
      nbits -= 8;
    }
  }
  if (nbits > 0) bytes.push(acc & 0xff);
  // split into sub-blocks <=255 bytes
  const blocks = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const n = Math.min(255, bytes.length - i);
    blocks.push(Buffer.from([n, ...bytes.slice(i, i + n)]));
  }
  return blocks;
}

// ── APNG encoder ───────────────────────────────────────────────────────────

function apngEncode(canvasW, canvasH, frames, { loop = 0 } = {}) {
  // frames: [{ x, y, w, h, pixels: Uint8Array RGBA, delayNum, delayDen,
  //            dispose: 0|1|2, blend: 0|1 }]
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvasW, 0);
  ihdr.writeUInt32BE(canvasH, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const out = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  const acTL = Buffer.alloc(8);
  acTL.writeUInt32BE(frames.length, 0);
  acTL.writeUInt32BE(loop, 4);
  out.push(chunk('acTL', acTL));
  let seq = 0;
  frames.forEach((frame, i) => {
    const fcTL = Buffer.alloc(26);
    fcTL.writeUInt32BE(seq++, 0);
    fcTL.writeUInt32BE(frame.w, 4);
    fcTL.writeUInt32BE(frame.h, 8);
    fcTL.writeUInt32BE(frame.x, 12);
    fcTL.writeUInt32BE(frame.y, 16);
    fcTL.writeUInt16BE(frame.delayNum, 20);
    fcTL.writeUInt16BE(frame.delayDen, 22);
    fcTL[24] = frame.dispose;
    fcTL[25] = frame.blend;
    out.push(chunk('fcTL', fcTL));
    // filtered rows (filter 0)
    const stride = frame.w * 4;
    const filtered = Buffer.alloc(frame.h * (stride + 1));
    const px = Buffer.from(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
    for (let r = 0; r < frame.h; r++) {
      filtered[r * (stride + 1)] = 0;
      px.copy(filtered, r * (stride + 1) + 1, r * stride, (r + 1) * stride);
    }
    const deflated = deflateSync(filtered);
    if (i === 0) {
      out.push(chunk('IDAT', deflated));
    } else {
      const fdAT = Buffer.alloc(4 + deflated.length);
      fdAT.writeUInt32BE(seq++, 0);
      deflated.copy(fdAT, 4);
      out.push(chunk('fdAT', fdAT));
    }
  });
  out.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}

// ── fixtures ───────────────────────────────────────────────────────────────

function solid(w, h, [r, g, b], a = 255) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  }
  return px;
}

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];

// gif-basic: three full-canvas frames, 40/100/20 ms delays, infinite loop
// (exact colors — ImageMagick's palette quantization washes these out).
writeFileSync(
  `${OUT}/gif-basic.gif`,
  gifEncode(
    [
      { width: 64, height: 64, pixels: solid(64, 64, RED), delayMs: 40, dispose: 1 },
      { width: 64, height: 64, pixels: solid(64, 64, GREEN), delayMs: 100, dispose: 1 },
      { width: 64, height: 64, pixels: solid(64, 64, BLUE), delayMs: 20, dispose: 1 },
    ],
    { loop: 0 },
  ),
);

// gif-delta: full red canvas, then a 16x16 blue delta at +8+8 (dispose
// background), then a 16x16 green delta at +32+32. Delays 40/100/20 ms.
writeFileSync(
  `${OUT}/gif-delta.gif`,
  gifEncode(
    [
      { width: 64, height: 64, pixels: solid(64, 64, RED), delayMs: 40, dispose: 2 },
      {
        width: 16,
        height: 16,
        left: 8,
        top: 8,
        pixels: solid(16, 16, BLUE),
        delayMs: 100,
        dispose: 2,
      },
      {
        width: 16,
        height: 16,
        left: 32,
        top: 32,
        pixels: solid(16, 16, GREEN),
        delayMs: 20,
        dispose: 1,
      },
    ],
    { loop: 0 },
  ),
);

// gif-transparent: left half opaque red, right half transparent (GIF has
// binary transparency only — index 0), then a 16x16 opaque green delta.
const halfRedTransparent = new Uint8Array(64 * 64 * 4);
for (let i = 0; i < 64 * 64; i++) {
  const x = i % 64;
  const o = i * 4;
  if (x < 32) {
    halfRedTransparent[o] = 255;
    halfRedTransparent[o + 3] = 255;
  }
}
writeFileSync(
  `${OUT}/gif-transparent.gif`,
  gifEncode(
    [
      {
        width: 64,
        height: 64,
        pixels: halfRedTransparent,
        delayMs: 40,
        dispose: 1,
        transparentIndex: 0,
      },
      {
        width: 16,
        height: 16,
        left: 8,
        top: 8,
        pixels: solid(16, 16, GREEN),
        delayMs: 100,
        dispose: 1,
      },
    ],
    { loop: 0 },
  ),
);

// gif-alpha-blue: 50%-alpha blue canvas, then an 8x8 white delta.
writeFileSync(
  `${OUT}/gif-alpha-blue.gif`,
  gifEncode(
    [
      {
        width: 32,
        height: 32,
        pixels: solid(32, 32, BLUE, 128),
        delayMs: 40,
        dispose: 2,
        transparentIndex: 0,
      },
      {
        width: 8,
        height: 8,
        left: 12,
        top: 12,
        pixels: solid(8, 8, WHITE),
        delayMs: 80,
        dispose: 1,
      },
    ],
    { loop: 0 },
  ),
);

// gif-dispose-previous: f0 red full (dispose keep), f1 blue 16x16 at +8+8
// (dispose previous), f2 green 16x16 at +32+32. After f1 the canvas must
// revert to f0; f2 only changes its own rect.
writeFileSync(
  `${OUT}/gif-dispose-previous.gif`,
  gifEncode(
    [
      { width: 64, height: 64, pixels: solid(64, 64, RED), delayMs: 40, dispose: 1 },
      {
        width: 16,
        height: 16,
        left: 8,
        top: 8,
        pixels: solid(16, 16, BLUE),
        delayMs: 100,
        dispose: 3,
      },
      {
        width: 16,
        height: 16,
        left: 32,
        top: 32,
        pixels: solid(16, 16, GREEN),
        delayMs: 20,
        dispose: 1,
      },
    ],
    { loop: 0 },
  ),
);

// gif-interlaced: two interlaced full frames (red, blue).
writeFileSync(
  `${OUT}/gif-interlaced.gif`,
  gifEncode(
    [
      {
        width: 32,
        height: 32,
        pixels: solid(32, 32, RED),
        delayMs: 40,
        dispose: 1,
        interlaced: true,
      },
      {
        width: 32,
        height: 32,
        pixels: solid(32, 32, BLUE),
        delayMs: 40,
        dispose: 1,
        interlaced: true,
      },
    ],
    { loop: 0 },
  ),
);

// gif-loop3: finite loop count 3.
writeFileSync(
  `${OUT}/gif-loop3.gif`,
  gifEncode(
    [
      { width: 32, height: 32, pixels: solid(32, 32, RED), delayMs: 40, dispose: 1 },
      { width: 32, height: 32, pixels: solid(32, 32, GREEN), delayMs: 40, dispose: 1 },
    ],
    { loop: 3 },
  ),
);

// gif-zero-delay: f0 40ms, f1 0ms, f2 100ms — resolver must collapse f1.
writeFileSync(
  `${OUT}/gif-zero-delay.gif`,
  gifEncode(
    [
      { width: 32, height: 32, pixels: solid(32, 32, RED), delayMs: 40, dispose: 1 },
      { width: 32, height: 32, pixels: solid(32, 32, GREEN), delayMs: 0, dispose: 1 },
      { width: 32, height: 32, pixels: solid(32, 32, BLUE), delayMs: 100, dispose: 1 },
    ],
    { loop: 0 },
  ),
);

// apng-basic: three full-canvas frames, 40/100/20 ms, infinite loop.
writeFileSync(
  `${OUT}/apng-basic.png`,
  apngEncode(
    64,
    64,
    [
      {
        x: 0,
        y: 0,
        w: 64,
        h: 64,
        pixels: solid(64, 64, RED),
        delayNum: 40,
        delayDen: 1000,
        dispose: 0,
        blend: 0,
      },
      {
        x: 0,
        y: 0,
        w: 64,
        h: 64,
        pixels: solid(64, 64, GREEN),
        delayNum: 100,
        delayDen: 1000,
        dispose: 0,
        blend: 0,
      },
      {
        x: 0,
        y: 0,
        w: 64,
        h: 64,
        pixels: solid(64, 64, BLUE),
        delayNum: 20,
        delayDen: 1000,
        dispose: 0,
        blend: 0,
      },
    ],
    { loop: 0 },
  ),
);

// apng-delta: full red frame, then 16x16 blue at +8+8 (blend source,
// dispose background), then 16x16 green at +32+32 (blend source).
writeFileSync(
  `${OUT}/apng-delta.png`,
  apngEncode(
    64,
    64,
    [
      {
        x: 0,
        y: 0,
        w: 64,
        h: 64,
        pixels: solid(64, 64, RED),
        delayNum: 40,
        delayDen: 1000,
        dispose: 1,
        blend: 0,
      },
      {
        x: 8,
        y: 8,
        w: 16,
        h: 16,
        pixels: solid(16, 16, BLUE),
        delayNum: 100,
        delayDen: 1000,
        dispose: 1,
        blend: 0,
      },
      {
        x: 32,
        y: 32,
        w: 16,
        h: 16,
        pixels: solid(16, 16, GREEN),
        delayNum: 20,
        delayDen: 1000,
        dispose: 0,
        blend: 0,
      },
    ],
    { loop: 0 },
  ),
);

// apng-blend-over: full 50%-red canvas, then 16x16 50%-white rect with
// blend=over at +24+24 — exercises alpha compositing of deltas.
const halfRed = solid(64, 64, RED, 128);
const halfWhite = solid(16, 16, WHITE, 128);
writeFileSync(
  `${OUT}/apng-blend-over.png`,
  apngEncode(
    64,
    64,
    [
      {
        x: 0,
        y: 0,
        w: 64,
        h: 64,
        pixels: halfRed,
        delayNum: 40,
        delayDen: 1000,
        dispose: 0,
        blend: 0,
      },
      {
        x: 24,
        y: 24,
        w: 16,
        h: 16,
        pixels: halfWhite,
        delayNum: 100,
        delayDen: 1000,
        dispose: 0,
        blend: 1,
      },
    ],
    { loop: 0 },
  ),
);

// apng-single: plain static PNG (no acTL).
writeFileSync(
  `${OUT}/apng-single.png`,
  apngEncode(
    64,
    64,
    [
      {
        x: 0,
        y: 0,
        w: 64,
        h: 64,
        pixels: solid(64, 64, RED),
        delayNum: 40,
        delayDen: 1000,
        dispose: 0,
        blend: 0,
      },
    ],
    {
      loop: 0,
    },
  ),
);

console.log('Hand-encoded fixtures written to', OUT);
