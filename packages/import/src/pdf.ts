import type { Affine } from '@varve/engine';
import { addNode, createDocument, makeShapeNode, makeTextNode, nextNodeId } from '@varve/scene';
import type { ImportOptions, ImportParser, ImportResult } from './types';

export function createPdfParser(): ImportParser {
  return {
    format: 'pdf',
    supportedExtensions: () => ['pdf'],
    canParse: (data) => {
      if (typeof data === 'string') return false;
      if (data.length < 5) return false;
      const header = new TextDecoder().decode(data.slice(0, 5));
      return header === '%PDF-';
    },
    parse: (data, options) => {
      const opts: ImportOptions = {
        embedImages: options?.embedImages ?? true,
        scale: options?.scale ?? 1,
        center: options?.center ?? false,
        keepPosition: options?.keepPosition ?? false,
      };

      const warnings: string[] = [];

      if (typeof data === 'string') {
        return {
          document: createDocument('Imported PDF'),
          nodeIds: [],
          warnings: ['PDF parsing requires binary data'],
          capabilities: {
            format: 'pdf',
            multipage: false,
            pageDimensions: false,
            vectors: false,
            text: true,
            images: false,
            masters: false,
            textThreads: false,
            notes: ['Text-only extraction; page geometry and vectors are not parsed'],
          },
        };
      }

      if (data.length < 5) {
        return {
          document: createDocument('Imported PDF'),
          nodeIds: [],
          warnings: ['File too small to be a valid PDF'],
          capabilities: {
            format: 'pdf',
            multipage: false,
            pageDimensions: false,
            vectors: false,
            text: false,
            images: false,
            masters: false,
            textThreads: false,
            notes: ['Invalid or truncated PDF'],
          },
        };
      }

      try {
        return parsePdfSync(data, opts, warnings);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        warnings.push(`PDF parsing failed: ${msg}`);
        return {
          document: createDocument('Imported PDF'),
          nodeIds: [],
          warnings,
          capabilities: {
            format: 'pdf',
            multipage: false,
            pageDimensions: false,
            vectors: false,
            text: false,
            images: false,
            masters: false,
            textThreads: false,
            notes: [`PDF parsing failed: ${msg}`],
          },
        };
      }
    },
  };
}

function parsePdfSync(data: Uint8Array, opts: ImportOptions, warnings: string[]): ImportResult {
  const str = new TextDecoder().decode(data);
  let doc = createDocument('Imported PDF');
  const nodeIds: string[] = [];

  warnings.push(
    'PDF import may lose fidelity: transparency, gradients, patterns, embedded fonts are approximated',
  );

  // Basic text extraction from the raw PDF stream
  const textBlocks = extractPdfText(str);
  if (textBlocks.length === 0) {
    warnings.push('No extractable text content found in PDF');
  }

  for (const block of textBlocks) {
    const { id, doc: d2 } = nextNodeId(doc);
    doc = d2;

    const textNode = makeTextNode(id, block.text, {
      name: 'Text',
      transform: [1, 0, 0, 1, block.x * opts.scale, block.y * opts.scale] as Affine,
      fontSize: (block.fontSize ?? 16) * opts.scale,
    });

    doc = addNode(doc, textNode);
    nodeIds.push(id);
  }

  // Extract rectangle operators
  const rects = extractPdfRects(str);
  for (const rect of rects) {
    const { id, doc: d2 } = nextNodeId(doc);
    doc = d2;

    const shapeNode = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: rect.w * opts.scale, h: rect.h * opts.scale },
      {
        name: 'Rectangle',
        transform: [1, 0, 0, 1, rect.x * opts.scale, rect.y * opts.scale] as Affine,
        fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
      },
    );

    doc = addNode(doc, shapeNode);
    nodeIds.push(id);
  }

  return {
    document: doc,
    nodeIds,
    warnings,
    capabilities: {
      format: 'pdf',
      multipage: false,
      pageDimensions: false,
      vectors: false,
      text: true,
      images: false,
      masters: false,
      textThreads: false,
      notes: [
        'Text-only extraction: page geometry, vectors and images are not parsed',
        'Multipage PDF import (one Varve page per PDF page) requires the native lopdf path',
      ],
    },
  };
}

function extractPdfText(
  pdfStr: string,
): Array<{ text: string; x: number; y: number; fontSize: number }> {
  const results: Array<{ text: string; x: number; y: number; fontSize: number }> = [];
  const btSections = pdfStr.match(/BT[\s\S]*?ET/g) || [];

  for (const section of btSections) {
    const fontSize = parseFloat(section.match(/Tf\s+([\d.]+)/)?.[1] ?? '16');
    const posMatch = section.match(/Td\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    const x = posMatch ? parseFloat(posMatch[1]!) : 0;
    const y = posMatch ? parseFloat(posMatch[2]!) : 0;

    const textMatches = section.matchAll(/\(([^)]*)\)\s*Tj/g);
    for (const m of textMatches) {
      if (m[1]) {
        results.push({ text: m[1], x, y, fontSize });
      }
    }

    const textMatches2 = section.matchAll(/\(([^)]*)\)\s*'/g);
    for (const m of textMatches2) {
      if (m[1]) {
        results.push({ text: m[1], x, y, fontSize });
      }
    }

    const textMatches3 = section.matchAll(/\[(.*?)\]\s*TJ/g);
    for (const m of textMatches3) {
      const parts = m[1]?.match(/\(([^)]*)\)/g) || [];
      let combinedText = '';
      for (const part of parts) {
        combinedText += part.slice(1, -1);
      }
      if (combinedText) {
        results.push({ text: combinedText, x, y, fontSize });
      }
    }
  }

  return results;
}

function extractPdfRects(pdfStr: string): Array<{ x: number; y: number; w: number; h: number }> {
  const results: Array<{ x: number; y: number; w: number; h: number }> = [];
  const rectMatches = pdfStr.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+re/g);

  for (const m of rectMatches) {
    results.push({
      x: parseFloat(m[1]!),
      y: parseFloat(m[2]!),
      w: parseFloat(m[3]!),
      h: parseFloat(m[4]!),
    });
  }

  return results;
}
