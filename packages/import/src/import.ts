import type { Affine } from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import { addNode, createDocument, findOrCreateEmbeddedAsset, nextNodeId } from '@varve/scene';
import { detectImageMime } from './bitmap';
import { getBitmapInfo, importImageAsFill } from './image';
import { getParser, getParserForData, getParserForExtension } from './registry';
import type { ImportOptions, ImportResult } from './types';

export function importFile(
  filename: string,
  data: string | Uint8Array,
  options?: Partial<ImportOptions>,
): ImportResult {
  const ext = filename.split('.').pop() ?? '';
  const parser = getParserForExtension(ext) ?? getParserForData(data);

  if (parser) {
    return parser.parse(data, options);
  }

  // Raster fallback is content-sniffed. The filename is presentation data,
  // not authority for MIME or decoder selection.
  if (typeof data !== 'string' && detectImageMime(data) !== null) {
    return importImageAsFile(data, filename, options);
  }

  return {
    document: createDocument('Import'),
    nodeIds: [],
    warnings: [`No parser found for format: ${ext}`],
  };
}

export function importSvgString(svg: string, options?: Partial<ImportOptions>): ImportResult {
  const parser = getParser('svg');
  if (parser) {
    return parser.parse(svg, options);
  }
  return {
    document: createDocument('Import'),
    nodeIds: [],
    warnings: ['SVG parser not registered'],
  };
}

export async function importImageFile(
  data: Uint8Array,
  filename: string,
  options?: Partial<ImportOptions>,
): Promise<ImportResult> {
  return importImageAsFile(data, filename, options);
}

function importImageAsFile(
  data: Uint8Array,
  filename: string,
  options?: Partial<ImportOptions>,
): ImportResult {
  const opts: ImportOptions = {
    embedImages: options?.embedImages ?? true,
    scale: options?.scale ?? 1,
    center: options?.center ?? false,
    keepPosition: options?.keepPosition ?? false,
  };

  const warnings: string[] = [];
  let doc = createDocument(filename);
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;

  let fill = importImageAsFill(data, filename, { embedAsDataUrl: opts.embedImages });
  const info = getBitmapInfo(data);
  if (opts.embedImages && fill.image) {
    const registered = findOrCreateEmbeddedAsset(doc, {
      dataUrl: fill.image.src,
      mimeType: info.mime,
      naturalWidth: info.w,
      naturalHeight: info.h,
    });
    doc = registered.document;
    fill = { ...fill, image: { ...fill.image, assetId: registered.assetId } };
  }
  // Fall back to a sensible default when the format's dimensions can't be parsed
  // (e.g. rare BMP variants, future formats). The engine will show the image at
  // natural size once the async cache load completes and triggers a re-render.
  const w = (info.w || 200) * opts.scale;
  const h = (info.h || 200) * opts.scale;

  const node: SceneNode = {
    id,
    kind: 'shape',
    name: filename,
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    shape: { kind: 'rect', x: 0, y: 0, w, h },
    transform: [1, 0, 0, 1, 0, 0] as Affine,
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
    fills: [fill],
    strokes: [],
    effects: [],
  };

  doc = addNode(doc, node);

  return { document: doc, nodeIds: [id], warnings };
}
