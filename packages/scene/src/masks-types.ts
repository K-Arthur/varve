export const RASTER_MASK_MAX_DIMENSION = 16_384;
// Portable decoders reliably support 128 Mi pixels; the prior 256 Mi-pixel
// ceiling admitted 16K-square assets that could not be decoded cross-platform.
// Existing supported assets at or below this bound remain unaffected.
export const RASTER_MASK_MAX_DECODED_PIXELS = 134_217_728;
export const RASTER_MASK_MAX_ENCODED_BYTES = 128 * 1024 * 1024;

export const PNG_DATA_URL_PATTERN =
  /^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
export const PNG_MAX_CHUNKS = 65_536;
export const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:%-]{0,255}$/;
export const STALE_REASONS = [
  'source-replaced',
  'source-changed',
  'legacy-preview-resolution',
] as const;
export const PROVENANCE_METHODS = ['quick', 'ai-balanced', 'ai-quality'] as const;
export const PROVENANCE_RUNTIMES = [
  'typescript',
  'wasm',
  'webgl',
  'webgpu',
  'native-cpu',
  'native-accelerated',
] as const;
export const PROVENANCE_ORIGINS = ['native', 'legacy-background-removal-preview'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function decodedBase64Length(payload: string): number {
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

export function decodeBase64(payload: string): string | null {
  try {
    return atob(payload);
  } catch {
    return null;
  }
}

export function readU32Be(bytes: string, offset: number): number {
  return (
    bytes.charCodeAt(offset) * 0x1000000 +
    bytes.charCodeAt(offset + 1) * 0x10000 +
    bytes.charCodeAt(offset + 2) * 0x100 +
    bytes.charCodeAt(offset + 3)
  );
}

export function pngCrc32(bytes: string, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ bytes.charCodeAt(index)) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
