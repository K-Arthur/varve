import type { Affine } from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import {
  addNode,
  createDocument,
  findOrCreateEmbeddedAsset,
  nextNodeId,
  upsertIccProfile,
} from '@varve/scene';
import { detectImageMime } from './bitmap';
import { importImageAsFill, inspectImageSource } from './image';
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

  const inspected = inspectImageSource(data);
  let fill = importImageAsFill(data, filename, { embedAsDataUrl: opts.embedImages });
  if (opts.embedImages && fill.image) {
    let assetMetadata: import('@varve/scene').ImageSourceMetadata | undefined;
    if (inspected.metadata.orientation.kind === 'oriented') {
      assetMetadata = {
        ...(assetMetadata ?? {}),
        orientation: inspected.metadata.orientation.orientation,
        pixelWidth: inspected.storedWidth,
        pixelHeight: inspected.storedHeight,
      };
    }
    let profileId: string | undefined;
    let profileFingerprint: string | undefined;
    if (inspected.iccProfileBase64) {
      const profile =
        inspected.metadata.icc.kind === 'valid' ? inspected.metadata.icc.profile : undefined;
      const registered = upsertIccProfile(doc, inspected.iccProfileBase64, profile?.description);
      doc = registered.document;
      profileId = registered.profileId;
      profileFingerprint = doc.iccProfiles?.[profileId]?.fingerprint;
      if (profile && doc.iccProfiles?.[profileId]) {
        // Enrich the registry entry with parsed header info (class, colour
        // space, version, intent) so preflight/UI can label it without
        // re-parsing bytes.
        const entry = doc.iccProfiles[profileId];
        if (entry && !entry.profileClass) {
          doc = {
            ...doc,
            iccProfiles: {
              ...doc.iccProfiles,
              [profileId]: {
                ...entry,
                ...(profile.profileClass ? { profileClass: profile.profileClass } : {}),
                ...(profile.colorSpace ? { colorSpace: profile.colorSpace } : {}),
                ...(profile.version ? { version: profile.version } : {}),
                ...(profile.renderingIntent !== undefined
                  ? { renderingIntent: profile.renderingIntent }
                  : {}),
              },
            },
          };
        }
      }
    }
    if (profileId) {
      assetMetadata = {
        ...(assetMetadata ?? {}),
        iccProfileId: profileId,
        iccStatus: 'valid',
        ...(inspected.metadata.icc.kind === 'valid' && inspected.metadata.icc.profile.description
          ? { iccDescription: inspected.metadata.icc.profile.description }
          : {}),
      };
    } else if (inspected.metadata.icc.kind === 'invalid') {
      assetMetadata = { ...(assetMetadata ?? {}), iccStatus: 'invalid' };
    }

    const encoding = inspected.metadata.encoding;
    if (encoding) {
      assetMetadata = {
        ...(assetMetadata ?? {}),
        colorEncoding: {
          model: encoding.model,
          provenance: encoding.provenance,
          ...(encoding.primaries !== undefined ? { primaries: encoding.primaries } : {}),
          ...(encoding.transfer !== undefined ? { transfer: encoding.transfer } : {}),
          ...(encoding.matrixCoefficients !== undefined
            ? { matrixCoefficients: encoding.matrixCoefficients }
            : {}),
          ...(encoding.videoRange !== undefined ? { videoRange: encoding.videoRange } : {}),
          ...(encoding.bitDepth !== undefined ? { bitDepth: encoding.bitDepth } : {}),
          ...(encoding.alphaMode !== undefined ? { alphaMode: encoding.alphaMode } : {}),
          ...(encoding.diagnostics !== undefined && encoding.diagnostics.length > 0
            ? { diagnostics: encoding.diagnostics }
            : {}),
          ...(profileId ? { profileId } : {}),
          ...(profileFingerprint ? { profileFingerprint } : {}),
        },
      };
    }

    const registered = findOrCreateEmbeddedAsset(doc, {
      dataUrl: fill.image.src,
      mimeType: inspected.mimeType,
      naturalWidth: inspected.displayedWidth,
      naturalHeight: inspected.displayedHeight,
      ...(assetMetadata ? { metadata: assetMetadata } : {}),
      ...(inspected.animated ? { animated: inspected.animated } : {}),
    });
    doc = registered.document;
    fill = { ...fill, image: { ...fill.image, assetId: registered.assetId } };
  }
  // Fall back to a sensible default when the format's dimensions can't be parsed
  // (e.g. rare BMP variants, future formats). The engine will show the image at
  // natural size once the async cache load completes and triggers a re-render.
  const w = (inspected.displayedWidth || 200) * opts.scale;
  const h = (inspected.displayedHeight || 200) * opts.scale;

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
