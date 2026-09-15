import { createDocument } from '@varve/scene';
import { getParser } from './registry';
import type { ImportOptions, ImportParser, ImportResult } from './types';

const MAX_AI_SOURCE_BYTES = 64 * 1024 * 1024;

export function createAiParser(): ImportParser {
  return {
    format: 'ai',
    supportedExtensions: () => ['ai'],
    canParse: (data) => {
      if (typeof data === 'string') return false;
      if (data.length < 4) return false;
      const header = new TextDecoder().decode(data.slice(0, 5));
      return header === '%PDF-' || header === '%!PS-';
    },
    parse: (data, options) => {
      const opts: ImportOptions = {
        embedImages: options?.embedImages ?? true,
        scale: options?.scale ?? 1,
        center: options?.center ?? false,
        keepPosition: options?.keepPosition ?? false,
      };

      const warnings: string[] = [];
      const doc = createDocument('Imported AI');

      if (typeof data === 'string') {
        return {
          document: doc,
          nodeIds: [],
          warnings: ['AI parsing requires binary data'],
        };
      }

      if (data.length < 4) {
        return {
          document: doc,
          nodeIds: [],
          warnings: ['File too small to be a valid AI'],
        };
      }
      if (data.byteLength > MAX_AI_SOURCE_BYTES) {
        return {
          document: doc,
          nodeIds: [],
          warnings: [`AI source exceeds the ${MAX_AI_SOURCE_BYTES}-byte import budget`],
        };
      }

      const header = new TextDecoder().decode(data.slice(0, 5));

      warnings.push(
        'AI import is best-effort: complex gradients, meshes, and transparency effects may not render correctly',
      );

      if (header === '%PDF-') {
        return parseAiPdfWrapper(data, opts, warnings);
      } else if (header === '%!PS-') {
        return parseAiEpsWrapper(data, opts, warnings);
      }

      return {
        document: doc,
        nodeIds: [],
        warnings: ['Unrecognized AI file format'],
      };
    },
  };
}

function parseAiPdfWrapper(
  data: Uint8Array,
  opts: ImportOptions,
  warnings: string[],
): ImportResult {
  warnings.push('AI file with PDF wrapper: extracting embedded content');
  const svgParser = getParser('svg');

  // Try to find embedded SVG in the PDF stream
  const str = new TextDecoder().decode(data);
  const svgContent = extractEmbeddedSvg(str);

  if (svgContent && svgParser) {
    const result = svgParser.parse(svgContent, opts);
    warnings.push(...result.warnings);
    if (result.nodeIds.length > 0) {
      return { document: result.document, nodeIds: result.nodeIds, warnings };
    }
  }

  // Fallback: try basic PDF text and rectangle extraction. Do not fabricate a
  // placeholder node for a header-only PDF: that makes a corrupt AI appear to
  // have imported successfully and leaves the user with artwork they did not
  // author.
  if (svgParser) {
    const textContent = extractPdfTextAsSvg(str);
    const rectangleContent = extractPdfRectsAsSvg(str);
    const fallbackContent = [textContent, rectangleContent].filter(Boolean).join('\n');
    if (!fallbackContent) {
      const message = 'AI parsing failed: no supported Illustrator content found';
      warnings.push(message);
      return {
        document: createDocument('AI Import'),
        nodeIds: [],
        warnings,
      };
    }
    const pdfFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">${fallbackContent}</svg>`;

    const result = svgParser.parse(pdfFallback, opts);
    warnings.push(...result.warnings);
    return { document: result.document, nodeIds: result.nodeIds, warnings };
  }

  return {
    document: createDocument('AI Import'),
    nodeIds: [],
    warnings: [...warnings, 'AI parsing failed: SVG parser not available'],
  };
}

function parseAiEpsWrapper(
  data: Uint8Array,
  opts: ImportOptions,
  warnings: string[],
): ImportResult {
  warnings.push('AI file with EPS wrapper: converting to basic SVG');
  const epsParser = getParser('eps');
  if (epsParser) {
    const result = epsParser.parse(data, opts);
    return { ...result, warnings: [...warnings, ...result.warnings] };
  }

  return {
    document: createDocument('AI Import'),
    nodeIds: [],
    warnings: [...warnings, 'AI parsing failed: EPS parser not available'],
  };
}

function extractEmbeddedSvg(pdfStr: string): string | null {
  const svgStart = pdfStr.indexOf('<svg');
  if (svgStart < 0) return null;

  const svgEnd = pdfStr.indexOf('</svg>', svgStart);
  if (svgEnd < 0) return null;

  return pdfStr.slice(svgStart, svgEnd + 6);
}

function extractPdfTextAsSvg(pdfStr: string): string {
  const textBlocks: Array<{ text: string; x: number; y: number }> = [];
  const btSections = pdfStr.match(/BT[\s\S]*?ET/g) || [];

  for (const section of btSections) {
    const posMatch = section.match(/Td\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    const x = posMatch ? parseFloat(posMatch[1]!) : 10;
    const y = posMatch ? parseFloat(posMatch[2]!) : 100;

    const textMatches = section.matchAll(/\(([^)]*)\)\s*Tj/g);
    for (const m of textMatches) {
      if (m[1]) {
        textBlocks.push({ text: m[1], x, y });
      }
    }
  }

  return textBlocks
    .map(
      (t) =>
        `<text x="${t.x}" y="${t.y}" font-family="sans-serif" font-size="12" fill="black">${escapeXml(t.text)}</text>`,
    )
    .join('\n');
}

function extractPdfRectsAsSvg(pdfStr: string): string {
  const rects: string[] = [];
  const rectPattern = /(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)\s+re(?:\s*(?:f|f\*|S|s))?/g;
  let match: RegExpExecArray | null;
  match = rectPattern.exec(pdfStr);
  while (match) {
    rects.push(
      `<rect x="${match[1]}" y="${match[2]}" width="${match[3]}" height="${match[4]}" fill="black"/>`,
    );
    match = rectPattern.exec(pdfStr);
  }
  return rects.join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
