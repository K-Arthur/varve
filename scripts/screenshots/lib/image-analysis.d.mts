export declare const PNG_SIGNATURE: number[];

export declare function crc32(buf: Uint8Array, start?: number, end?: number): number;

export interface PngChunk {
  type: string;
  data: Buffer;
}

export interface PngChunkReport {
  chunks: PngChunk[];
  errors: string[];
  truncated: boolean;
}

export declare function readPngChunks(buf: Buffer): PngChunkReport | null;

export interface PngAnalysis {
  valid: boolean;
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  channels: number;
  chunkCount: number;
  inflatedBytes: number;
  distinctByteValues: number;
  uniform: boolean;
  errors: string[];
}

export declare function analysePng(
  buf: Buffer,
  options?: { minInflatedBytes?: number; maxDistinctBytes?: number },
): PngAnalysis;

export declare function pngDimensions(buf: Buffer): { width: number; height: number } | null;

export declare function buffersEqual(a: Buffer, b: Buffer): boolean;

export interface WebpInfo {
  format: 'webp';
  width: number;
  height: number;
  truncated: boolean;
}

export declare function readWebpInfo(buf: Buffer): WebpInfo | null;

export interface AvifInfo {
  format: 'avif';
  width: number;
  height: number;
  truncated: boolean;
}

export declare function readAvifInfo(buf: Buffer): AvifInfo | null;

export interface ImageAnalysis extends PngAnalysis {
  format: 'png' | 'webp' | 'avif' | null;
}

export declare function analyseImage(
  buf: Buffer,
  options?: { minInflatedBytes?: number; maxDistinctBytes?: number },
): ImageAnalysis;
