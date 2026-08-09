/**
 * Synchronous container probing for animated GIF / APNG / animated WebP.
 *
 * Probing reads container structure only — no pixel decode. It is the
 * authoritative source for `AnimatedAssetMetadata`: per-frame timing, rects,
 * blend/disposal, loop count, and canvas size. Detection is content-based
 * (never the file extension), and static variants of each format are
 * distinguished without false positives.
 *
 * Timing policy: source timing is preserved exactly (GIF centiseconds x10,
 * APNG num/den, WebP ms). The one exception is a GIF frame without a
 * Graphics Control Extension (GIF87a): the container carries no timing, and
 * the browser convention of ~100 ms is adopted and documented. Explicit
 * zero delays are preserved as 0 and handled by the time resolver.
 */

import {
  type AnimatedFrameMetadata,
  MEDIA_DECODE_LIMITS,
  type MediaDisposal,
  type MediaFormat,
  MediaProbeError,
  type MediaProbeResult,
} from './types';

const NETSCAPE = 'NETSCAPE2.0';

/** Probe animated-media content from encoded bytes. Never throws for
 * unrecognized or static content; throws `MediaProbeError` for recognized
 * containers that are malformed or exceed limits. */
export function probeAnimatedMedia(bytes: Uint8Array): MediaProbeResult {
  if (bytes.length < 4) {
    return { kind: null, mime: '' };
  }
  if (bytes[0]! === 0x47 && bytes[1]! === 0x49 && bytes[2]! === 0x46) {
    return probeGif(bytes);
  }
  if (bytes[0]! === 0x89 && bytes[1]! === 0x50 && bytes[2]! === 0x4e && bytes[3]! === 0x47) {
    return probePng(bytes);
  }
  if (
    bytes[0]! === 0x52 &&
    bytes[1]! === 0x49 &&
    bytes[2]! === 0x46 &&
    bytes[3]! === 0x46 &&
    bytes.length >= 12 &&
    bytes[8]! === 0x57 &&
    bytes[9]! === 0x45 &&
    bytes[10]! === 0x42 &&
    bytes[11]! === 0x50
  ) {
    return probeWebp(bytes);
  }
  return { kind: null, mime: '' };
}

function normalized(
  kind: MediaFormat,
  mime: string,
  frames: AnimatedFrameMetadata[],
  loopCount: number | 'infinite',
  width: number,
  height: number,
): MediaProbeResult {
  if (width <= 0 || height <= 0) {
    throw new MediaProbeError('invalid-header', `${kind}: zero canvas size`);
  }
  if (width > MEDIA_DECODE_LIMITS.maxDimension || height > MEDIA_DECODE_LIMITS.maxDimension) {
    throw new MediaProbeError(
      'limits',
      `${kind}: canvas ${width}x${height} exceeds the ${MEDIA_DECODE_LIMITS.maxDimension}px limit`,
    );
  }
  // A single-frame container is effectively static — normalize so nothing
  // downstream treats it as animated.
  if (frames.length <= 1) {
    return { kind: 'static', mime };
  }
  const durationMs = frames.reduce((sum, f) => sum + f.durationMs, 0);
  return {
    kind,
    mime,
    metadata: {
      kind,
      frameCount: frames.length,
      durationMs,
      loopCount,
      width,
      height,
      frames,
      decoderVersion: 1,
    },
  };
}

// ── GIF ────────────────────────────────────────────────────────────────────

function probeGif(bytes: Uint8Array): MediaProbeResult {
  if (bytes.length < 13) {
    throw new MediaProbeError('truncated', 'gif: file too short');
  }
  const version = String.fromCharCode(bytes[3]!, bytes[4]!, bytes[5]!);
  if (version !== '87a' && version !== '89a') {
    throw new MediaProbeError('invalid-header', 'gif: unsupported version');
  }
  let pos = 6;
  const width = readU16LE(bytes, pos);
  const height = readU16LE(bytes, pos + 2);
  const packed = bytes[pos + 4]!;
  if (packed & 0x80) {
    pos += 7 + 3 * (1 << ((packed & 7) + 1));
  } else {
    pos += 7;
  }

  const frames: AnimatedFrameMetadata[] = [];
  let loopCount: number | 'infinite' | undefined;
  // GCE state applies to the following image (spec: the GCE precedes its
  // image). GIF87a frames have no GCE and conventionally display ~100 ms.
  let pending: { disposal: MediaDisposal; delayCentis: number; transparent: number | null } | null =
    null;

  while (pos < bytes.length) {
    const block = bytes[pos]!;
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      const label = bytes[pos + 1]!;
      pos += 2;
      if (label === 0xf9) {
        const size = bytes[pos]!;
        if (size < 4 || pos + 1 + size > bytes.length) {
          throw new MediaProbeError('truncated', 'gif: truncated GCE');
        }
        const gcePacked = bytes[pos + 1]!;
        pending = {
          disposal: gifDisposal(((gcePacked >> 2) & 7) as MediaDisposalRaw),
          delayCentis: readU16LE(bytes, pos + 2),
          transparent: gcePacked & 1 ? bytes[pos + 4]! : null,
        };
        pos += 1 + size + 1; // size byte + payload + terminator
      } else if (label === 0xff) {
        // application extension — NETSCAPE loop
        const size = bytes[pos]!;
        if (pos + 1 + size > bytes.length) {
          throw new MediaProbeError('truncated', 'gif: truncated app extension');
        }
        if (size >= 11 && asciiEquals(bytes, pos + 1, NETSCAPE)) {
          let sub = pos + 1 + size;
          while (sub < bytes.length && bytes[sub]! !== 0) {
            const subLen = bytes[sub]!;
            if (sub + 2 + subLen > bytes.length) {
              throw new MediaProbeError('truncated', 'gif: truncated NETSCAPE extension');
            }
            if (subLen >= 3 && bytes[sub + 1]! === 1) {
              loopCount = readU16LE(bytes, sub + 2);
              if (loopCount === 0) loopCount = 'infinite';
            }
            sub += 1 + subLen;
          }
          if (sub >= bytes.length && bytes[bytes.length - 1] !== 0) {
            throw new MediaProbeError('truncated', 'gif: unterminated NETSCAPE extension');
          }
        }
        pos = skipSubBlocks(bytes, pos + 1 + size);
      } else {
        pos = skipSubBlocks(bytes, pos);
      }
    } else if (block === 0x2c) {
      if (pos + 10 > bytes.length) {
        throw new MediaProbeError('truncated', 'gif: truncated image descriptor');
      }
      const left = readU16LE(bytes, pos + 1);
      const top = readU16LE(bytes, pos + 3);
      const frameW = readU16LE(bytes, pos + 5);
      const frameH = readU16LE(bytes, pos + 7);
      const flags = bytes[pos + 9]!;
      pos += 10;
      if (flags & 0x80) pos += 3 * (1 << ((flags & 7) + 1));
      // frame data: LZW min code size + sub-blocks
      pos = skipSubBlocks(bytes, pos + 1);

      const durationMs = pending ? pending.delayCentis * 10 : 100;
      frames.push({
        index: frames.length,
        durationMs,
        x: left,
        y: top,
        width: frameW,
        height: frameH,
        blend: 'source',
        disposal: pending?.disposal ?? 'none',
      });
      pending = null;
    } else {
      throw new MediaProbeError('invalid-header', `gif: unexpected block 0x${block.toString(16)}`);
    }
  }

  if (frames.length === 0) {
    throw new MediaProbeError('invalid-header', 'gif: no image frames');
  }
  return normalized('gif', 'image/gif', frames, loopCount ?? 1, width, height);
}

type MediaDisposalRaw = 0 | 1 | 2 | 3;

function gifDisposal(raw: MediaDisposalRaw): MediaDisposal {
  switch (raw) {
    case 2:
      return 'background';
    case 3:
      return 'previous';
    default:
      return 'none';
  }
}

function skipSubBlocks(bytes: Uint8Array, pos: number): number {
  let p = pos;
  while (p < bytes.length) {
    const size = bytes[p]!;
    if (size === 0) return p + 1;
    p += 1 + size;
  }
  throw new MediaProbeError('truncated', 'gif: unterminated data block');
}

function asciiEquals(bytes: Uint8Array, pos: number, expected: string): boolean {
  if (pos + expected.length > bytes.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[pos + i]! !== expected.charCodeAt(i)) return false;
  }
  return true;
}

// ── PNG / APNG ─────────────────────────────────────────────────────────────

function probePng(bytes: Uint8Array): MediaProbeResult {
  let pos = 8;
  let width = 0;
  let height = 0;
  let numFrames: number | undefined;
  let numPlays: number | undefined;
  let firstFrameControl: ApngFrameControl | 'default' | undefined;
  const frameControls: ApngFrameControl[] = [];

  while (pos + 8 <= bytes.length) {
    const len = readU32BE(bytes, pos);
    const type = String.fromCharCode(
      bytes[pos + 4]!,
      bytes[pos + 5]!,
      bytes[pos + 6]!,
      bytes[pos + 7]!,
    );
    const data = pos + 8;
    if (data + len > bytes.length) {
      throw new MediaProbeError('truncated', 'apng: truncated chunk');
    }
    if (type === 'IHDR') {
      if (len < 8) throw new MediaProbeError('invalid-header', 'apng: short IHDR');
      width = readU32BE(bytes, data);
      height = readU32BE(bytes, data + 4);
    } else if (type === 'acTL') {
      if (len < 8) throw new MediaProbeError('invalid-header', 'apng: short acTL');
      numFrames = readU32BE(bytes, data);
      numPlays = readU32BE(bytes, data + 4);
    } else if (type === 'fcTL') {
      if (len < 26) throw new MediaProbeError('invalid-header', 'apng: short fcTL');
      const control: ApngFrameControl = {
        width: readU32BE(bytes, data + 4),
        height: readU32BE(bytes, data + 8),
        x: readU32BE(bytes, data + 12),
        y: readU32BE(bytes, data + 16),
        delayNum: readU16BE(bytes, data + 20),
        delayDen: readU16BE(bytes, data + 22),
        dispose: bytes[data + 24]!,
        blend: bytes[data + 25]!,
      };
      if (firstFrameControl === undefined) firstFrameControl = control;
      frameControls.push(control);
    } else if (type === 'IDAT' && firstFrameControl === undefined) {
      // default image without a preceding fcTL: the IDAT is an extra frame
      firstFrameControl = 'default';
    }
    if (type === 'IEND') break;
    pos = data + len + 4; // chunk data + CRC
  }

  if (width === 0 || height === 0) {
    throw new MediaProbeError('invalid-header', 'png: missing IHDR');
  }
  if (numFrames === undefined) {
    // plain static PNG
    return { kind: 'static', mime: 'image/png' };
  }

  const controls: ApngFrameControl[] = frameControls.slice(0);
  // A default IDAT image (no fcTL before it) is an extra frame at canvas
  // size with a conventional 100 ms display time.
  if (firstFrameControl === 'default') {
    controls.unshift({
      width,
      height,
      x: 0,
      y: 0,
      delayNum: 10,
      delayDen: 100,
      dispose: 0,
      blend: 0,
    });
  }
  if (controls.length === 0) {
    throw new MediaProbeError('invalid-header', 'apng: acTL without frames');
  }

  const frames: AnimatedFrameMetadata[] = controls.map((c, i) => ({
    index: i,
    durationMs: apngDelayMs(c.delayNum, c.delayDen),
    x: c.x,
    y: c.y,
    width: c.width,
    height: c.height,
    blend: c.blend === 1 ? 'over' : 'source',
    disposal: apngDisposal(c.dispose),
  }));
  const loopCount: number | 'infinite' = (numPlays ?? 0) === 0 ? 'infinite' : (numPlays ?? 0);
  return normalized('apng', 'image/png', frames, loopCount, width, height);
}

interface ApngFrameControl {
  width: number;
  height: number;
  x: number;
  y: number;
  delayNum: number;
  delayDen: number;
  dispose: number;
  blend: number;
}

/** APNG frame delay per spec: den 0 → 100; num 0 → 10 ms; min 1 ms. */
function apngDelayMs(delayNum: number, delayDen: number): number {
  if (delayNum === 0 && delayDen === 0) return 10;
  const den = delayDen === 0 ? 100 : delayDen;
  const ms = Math.floor((delayNum * 1000) / den);
  return ms === 0 ? 1 : ms;
}

function apngDisposal(raw: number): MediaDisposal {
  if (raw === 1) return 'background';
  if (raw === 2) return 'previous';
  return 'none';
}

// ── WebP ───────────────────────────────────────────────────────────────────

function probeWebp(bytes: Uint8Array): MediaProbeResult {
  if (bytes.length < 12) {
    throw new MediaProbeError('truncated', 'webp: file too short');
  }
  const riffSize = readU32LE(bytes, 4);
  if (riffSize > bytes.length - 8) {
    throw new MediaProbeError('truncated', 'webp: RIFF size exceeds file');
  }
  let pos = 12;
  let canvasW = 0;
  let canvasH = 0;
  let animated = false;
  let loopCount: number | 'infinite' | undefined;
  const frames: AnimatedFrameMetadata[] = [];

  while (pos + 8 <= bytes.length) {
    const type = String.fromCharCode(
      bytes[pos]!,
      bytes[pos + 1]!,
      bytes[pos + 2]!,
      bytes[pos + 3]!,
    );
    const size = readU32LE(bytes, pos + 4);
    const data = pos + 8;
    if (data + size > bytes.length) {
      throw new MediaProbeError('truncated', 'webp: chunk exceeds file');
    }
    if (type === 'VP8X') {
      if (size < 10) throw new MediaProbeError('invalid-header', 'webp: short VP8X');
      animated = (bytes[data]! & 0x02) !== 0;
      canvasW = readU24LE(bytes, data + 4) + 1;
      canvasH = readU24LE(bytes, data + 7) + 1;
    } else if (type === 'ANIM') {
      if (size < 6) throw new MediaProbeError('invalid-header', 'webp: short ANIM');
      loopCount = readU24LE(bytes, data);
      // 0 (spec) and 0xffffff (libwebp's "forever" convention) both mean
      // infinite looping.
      if (loopCount === 0 || loopCount === 0xffffff) loopCount = 'infinite';
    } else if (type === 'ANMF') {
      // x(3) y(3) w-1(3) h-1(3) dur(3) flags(1) + frame data
      if (size < 16) throw new MediaProbeError('invalid-header', 'webp: short ANMF');
      const flags = bytes[data + 15]!;
      frames.push({
        index: frames.length,
        durationMs: readU24LE(bytes, data + 12),
        x: readU24LE(bytes, data),
        y: readU24LE(bytes, data + 3),
        width: readU24LE(bytes, data + 6) + 1,
        height: readU24LE(bytes, data + 9) + 1,
        blend: (flags & 0x02) !== 0 ? 'source' : 'over',
        disposal: (flags & 0x01) !== 0 ? 'background' : 'none',
        preComposited: true,
      });
    }
    pos = data + size + (size & 1);
  }

  if (canvasW === 0 || canvasH === 0) {
    // extended file missing VP8X or plain (non-extended) webp
    return { kind: 'static', mime: 'image/webp' };
  }
  if (!animated || frames.length <= 1) {
    return { kind: 'static', mime: 'image/webp' };
  }
  return normalized('webp', 'image/webp', frames, loopCount ?? 'infinite', canvasW, canvasH);
}

// ── byte readers ───────────────────────────────────────────────────────────

function readU16LE(bytes: Uint8Array, pos: number): number {
  return bytes[pos]! | (bytes[pos + 1]! << 8);
}

function readU16BE(bytes: Uint8Array, pos: number): number {
  return (bytes[pos]! << 8) | bytes[pos + 1]!;
}

function readU24LE(bytes: Uint8Array, pos: number): number {
  return bytes[pos]! | (bytes[pos + 1]! << 8) | (bytes[pos + 2]! << 16);
}

function readU32LE(bytes: Uint8Array, pos: number): number {
  return bytes[pos]! | (bytes[pos + 1]! << 8) | (bytes[pos + 2]! << 16) | (bytes[pos + 3]! << 24);
}

function readU32BE(bytes: Uint8Array, pos: number): number {
  return (bytes[pos]! << 24) | (bytes[pos + 1]! << 16) | (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
}
