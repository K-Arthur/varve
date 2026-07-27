import type { PathPoint } from './types';

export interface OutlineWorkerRequest {
  id: string;
  text: string;
  fontData: ArrayBuffer;
  fontSize: number;
  fontWeight?: number;
  fontStyle?: string;
  letterSpacing?: number;
  variableAxes?: Record<string, number>;
  chunkIndex?: number;
  totalChunks?: number;
}

export interface OutlineWorkerProgress {
  id: string;
  type: 'progress';
  glyphsCompleted: number;
  totalGlyphs: number;
  chunkIndex?: number;
  totalChunks?: number;
}

export interface OutlineWorkerResult {
  id: string;
  type: 'result';
  glyphs: WorkerGlyphOutline[];
  bounds: { x: number; y: number; w: number; h: number };
  hasColorGlyphs: boolean;
  warnings: string[];
  chunkIndex?: number;
  totalChunks?: number;
}

export interface OutlineWorkerError {
  id: string;
  type: 'error';
  error: string;
}

export interface WorkerGlyphOutline {
  char: string;
  points: { x: number; y: number }[];
  rings: { x: number; y: number }[][];
  bounds: { x: number; y: number; w: number; h: number };
  advance: number;
}

interface OpentypeGlyph {
  advanceWidth?: number;
  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
  getPath(x: number, y: number, fontSize: number): { commands: OpentypePathCommand[] };
}

interface OpentypePathCommand {
  type: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

interface OpentypeFont {
  unitsPerEm?: number;
  glyphs: {
    get(index: number): OpentypeGlyph;
  };
  charToGlyph(char: string): OpentypeGlyph;
  stringToGlyphs(str: string): number[];
  getPath(
    text: string,
    x: number,
    y: number,
    fontSize: number,
  ): { commands: OpentypePathCommand[]; toPathData(decimalPlaces: number): string };
}

function isWoff2(data: ArrayBuffer): boolean {
  const view = new Uint8Array(data, 0, 4);
  return view[0] === 0x77 && view[1] === 0x4f && view[2] === 0x46 && view[3] === 0x32;
}

async function decompressWoff2(data: ArrayBuffer): Promise<ArrayBuffer | null> {
  if (!isWoff2(data)) return null;
  try {
    const { decompress } = await import('wawoff2');
    const result = await decompress(new Uint8Array(data));
    return result.buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

self.onmessage = async (e: MessageEvent<OutlineWorkerRequest>) => {
  const req = e.data;

  try {
    let fontData = req.fontData;

    const decompressed = await decompressWoff2(fontData);
    if (decompressed) {
      fontData = decompressed;
    }

    // Dynamic import of opentype.js in worker context
    let font: OpentypeFont;
    try {
      const opentype = await import('opentype.js');
      font = opentype.parse(fontData) as unknown as OpentypeFont;
      if (!font) {
        postMessage({
          id: req.id,
          type: 'error',
          error: 'Failed to parse font data',
        } satisfies OutlineWorkerError);
        return;
      }
    } catch {
      postMessage({
        id: req.id,
        type: 'error',
        error: 'Failed to load or parse font',
      } satisfies OutlineWorkerError);
      return;
    }

    const text = req.text;
    const fontSize = req.fontSize ?? 16;

    const glyphs: WorkerGlyphOutline[] = [];
    const warnings: string[] = [];
    let hasColorGlyphs = false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let cursorX = 0;

    const totalGlyphs = text.length;
    const reportInterval = Math.max(1, Math.floor(totalGlyphs / 20));
    const scale = fontSize / (font.unitsPerEm || 1000);

    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;
      const glyph = font.charToGlyph(char);

      // Get glyph index for colour check
      if (!hasColorGlyphs) {
        try {
          const indices = font.stringToGlyphs(char);
          if (indices.length > 0) {
            const glyphObj = font.glyphs.get(indices[0]!);
            const layers = (glyphObj as unknown as Record<string, unknown>).colorLayers;
            if (layers) {
              hasColorGlyphs = true;
            }
          }
        } catch {
          // ignore
        }
      }

      const path = glyph.getPath(0, 0, fontSize);
      const commands = path.commands;
      const advanceWidth = glyph.advanceWidth ?? 0;

      if (!commands || commands.length === 0) {
        cursorX += advanceWidth * scale;
        continue;
      }

      const points: { x: number; y: number }[] = [];
      const rings: { x: number; y: number }[][] = [];
      let currentRing: { x: number; y: number }[] = [];

      for (const cmd of commands) {
        switch (cmd.type) {
          case 'M': {
            if (currentRing.length > 0) {
              rings.push(currentRing);
            }
            currentRing = [];
            if (cmd.x !== undefined && cmd.y !== undefined) {
              const p = { x: cmd.x, y: cmd.y };
              currentRing.push(p);
              points.push(p);
            }
            break;
          }
          case 'L':
          case 'Q':
          case 'C': {
            if (cmd.x !== undefined && cmd.y !== undefined) {
              const p = { x: cmd.x, y: cmd.y };
              currentRing.push(p);
              points.push(p);
            }
            break;
          }
          case 'Z': {
            if (currentRing.length > 0) {
              rings.push(currentRing);
              currentRing = [];
            }
            break;
          }
        }
      }

      if (currentRing.length > 0) {
        rings.push(currentRing);
      }

      // Compute glyph bounds
      const glyphBounds = glyph.getBoundingBox();
      const gx = cursorX + (glyphBounds.x1 ?? 0) * scale;
      const gy = -(glyphBounds.y2 ?? 0) * scale;
      const gw = ((glyphBounds.x2 ?? 0) - (glyphBounds.x1 ?? 0)) * scale;
      const gh = ((glyphBounds.y2 ?? 0) - (glyphBounds.y1 ?? 0)) * scale;

      if (gx < minX) minX = gx;
      if (gy < minY) minY = gy;
      if (gx + gw > maxX) maxX = gx + gw;
      if (gy + gh > maxY) maxY = gy + gh;

      glyphs.push({
        char,
        points,
        rings,
        bounds: { x: gx, y: gy, w: gw, h: gh },
        advance: advanceWidth * scale,
      });

      cursorX += advanceWidth * scale;

      if (i % reportInterval === 0) {
        postMessage({
          id: req.id,
          type: 'progress',
          glyphsCompleted: i + 1,
          totalGlyphs,
          chunkIndex: req.chunkIndex,
          totalChunks: req.totalChunks,
        } satisfies OutlineWorkerProgress);
      }
    }

    const bounds = {
      x: minX === Infinity ? 0 : minX,
      y: minY === Infinity ? 0 : minY,
      w: maxX === Infinity ? 0 : maxX - minX,
      h: maxY === Infinity ? 0 : maxY - minY,
    };

    postMessage({
      id: req.id,
      type: 'result',
      glyphs,
      bounds,
      hasColorGlyphs,
      warnings,
      chunkIndex: req.chunkIndex,
      totalChunks: req.totalChunks,
    } satisfies OutlineWorkerResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown worker error';
    postMessage({ id: req.id, type: 'error', error: msg } satisfies OutlineWorkerError);
  }
};
