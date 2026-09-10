import type { Affine } from '@varve/engine';
import { addNode, createDocument, makeShapeNode, makeTextNode, nextNodeId } from '@varve/scene';
import type { ImportOptions, ImportParser, ImportResult } from './types';

export function createEpsParser(): ImportParser {
  return {
    format: 'eps',
    supportedExtensions: () => ['eps', 'epsf'],
    canParse: (data) => {
      if (typeof data === 'string') return false;
      if (data.length < 4) return false;
      const str = new TextDecoder().decode(data.slice(0, Math.min(data.length, 100)));
      return str.startsWith('%!PS-') || str.includes('%%BoundingBox:');
    },
    parse: (data, options) => {
      const opts: ImportOptions = {
        embedImages: options?.embedImages ?? true,
        scale: options?.scale ?? 1,
        center: options?.center ?? false,
        keepPosition: options?.keepPosition ?? false,
      };

      const warnings: string[] = [];
      const doc = createDocument('Imported EPS');

      if (typeof data === 'string') {
        return { document: doc, nodeIds: [], warnings: ['EPS parsing requires binary data'] };
      }

      if (data.length < 10) {
        return { document: doc, nodeIds: [], warnings: ['File too small to be a valid EPS'] };
      }

      try {
        const str = new TextDecoder().decode(data);
        warnings.push('EPS import is best-effort: only basic vector paths and text are supported');
        warnings.push(
          'EPS patterns, gradients, and PostScript procedures may not render correctly',
        );

        return parseEpsContent(str, opts, warnings);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        warnings.push(`EPS parsing failed: ${msg}`);
        return { document: doc, nodeIds: [], warnings };
      }
    },
  };
}

function parseEpsContent(epsStr: string, opts: ImportOptions, warnings: string[]): ImportResult {
  let doc = createDocument('Imported EPS');
  const nodeIds: string[] = [];

  // BoundingBox is parsed for future dimension handling
  epsStr.match(/%%BoundingBox:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);

  // Convert common PostScript rectangle operators
  const rectFillPattern = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rectfill/g;
  let m: RegExpExecArray | null;
  m = rectFillPattern.exec(epsStr);
  while (m !== null) {
    const x = parseFloat(m[1]!) * opts.scale;
    const y = parseFloat(m[2]!) * opts.scale;
    const w = parseFloat(m[3]!) * opts.scale;
    const h = parseFloat(m[4]!) * opts.scale;

    const { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w, h },
      {
        name: 'Rectangle',
        transform: [1, 0, 0, 1, x, y] as Affine,
        fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      },
    );
    doc = addNode(doc, node);
    nodeIds.push(id);
    m = rectFillPattern.exec(epsStr);
  }

  // rectstroke
  const rectStrokePattern = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rectstroke/g;
  m = rectStrokePattern.exec(epsStr);
  while (m !== null) {
    const x = parseFloat(m[1]!) * opts.scale;
    const y = parseFloat(m[2]!) * opts.scale;
    const w = parseFloat(m[3]!) * opts.scale;
    const h = parseFloat(m[4]!) * opts.scale;

    const { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w, h },
      {
        name: 'Rectangle Stroke',
        transform: [1, 0, 0, 1, x, y] as Affine,
        fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
      },
    );
    doc = addNode(doc, node);
    nodeIds.push(id);
    m = rectStrokePattern.exec(epsStr);
  }

  // Extract text content
  const textPattern = /\(([^)]*)\)\s+show/g;
  m = textPattern.exec(epsStr);
  while (m !== null) {
    const text = m[1]!;
    if (text) {
      const { id, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const textNode = makeTextNode(id, text, {
        name: 'Text',
        transform: [1, 0, 0, 1, 20 * opts.scale, 50 * opts.scale] as Affine,
        fontSize: 16 * opts.scale,
      });
      doc = addNode(doc, textNode);
      nodeIds.push(id);
    }
    m = textPattern.exec(epsStr);
  }

  // Detect unsupported features
  if (epsStr.match(/clippath/i)) {
    warnings.push('EPS clipping paths are not supported');
  }
  if (epsStr.match(/pattern/i)) {
    warnings.push('EPS patterns are not supported');
  }
  if (epsStr.match(/gradient/i)) {
    warnings.push('EPS gradients are not supported');
  }

  return { document: doc, nodeIds, warnings };
}
