/**
 * Portable mockup template bundles.
 *
 * A `.varve-mockup.json` bundle is `{ format, version, template, assets }`
 * where `assets` carries the template's photographic plate and clip/occlusion
 * coverage bitmaps as data URLs. Import validates every bound (template
 * bytes, asset count, MIME allowlist, per-asset bytes, referenced-asset
 * completeness) and embeds through the document's content-addressed asset
 * table, so identical bundles dedupe and no path or URL ever leaves the
 * document. Bound content is never included: a template exports its geometry
 * and plate, not a client's bound artwork.
 */

import {
  buildTemplateFromJson,
  type Document,
  findOrCreateEmbeddedAsset,
  hashMockupTemplate,
  type MockupTemplateAsset,
} from '@varve/scene';

export const MOCKUP_BUNDLE_FORMAT = 'varve-mockup-template';
export const MOCKUP_BUNDLE_VERSION = 1;

export const MOCKUP_BUNDLE_LIMITS = {
  /** Serialized template (without assets) and total bundle byte bounds. */
  maxTemplateBytes: 1_048_576,
  maxBundleBytes: 32 * 1024 * 1024,
  maxAssets: 8,
  maxAssetBytes: 20 * 1024 * 1024,
  maxAssetDimension: 16_384,
} as const;

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/;

export interface MockupBundleAsset {
  id: string;
  mimeType: string;
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

export interface MockupTemplateBundle {
  format: typeof MOCKUP_BUNDLE_FORMAT;
  version: number;
  template: MockupTemplateAsset;
  assets: MockupBundleAsset[];
}

/** Asset ids referenced by a template's plate and surface masks. */
export function templateAssetIds(template: MockupTemplateAsset): string[] {
  const ids = new Set<string>();
  if (template.plateImage?.assetId) ids.add(template.plateImage.assetId);
  for (const surface of template.surfaces) {
    if (surface.clipMaskAssetId) ids.add(surface.clipMaskAssetId);
    if (surface.occlusionMaskAssetId) ids.add(surface.occlusionMaskAssetId);
  }
  return [...ids];
}

export function exportMockupTemplateBundle(
  doc: Document,
  templateId: string,
): { bundle: MockupTemplateBundle } | { errors: string[] } {
  const template = doc.mockupTemplates?.[templateId];
  if (!template) return { errors: [`Template ${templateId} is not embedded in this document`] };
  const assets: MockupBundleAsset[] = [];
  for (const assetId of templateAssetIds(template)) {
    const asset = doc.assets?.[assetId];
    if (!asset) {
      return { errors: [`Template references missing asset ${assetId}; cannot export`] };
    }
    if (!ALLOWED_MIME.has(asset.mimeType)) {
      return { errors: [`Template asset ${assetId} has unsupported MIME ${asset.mimeType}`] };
    }
    assets.push({
      id: asset.id,
      mimeType: asset.mimeType,
      dataUrl: asset.dataUrl,
      naturalWidth: asset.naturalWidth,
      naturalHeight: asset.naturalHeight,
    });
  }
  return {
    bundle: { format: MOCKUP_BUNDLE_FORMAT, version: MOCKUP_BUNDLE_VERSION, template, assets },
  };
}

export function serializeMockupTemplateBundle(bundle: MockupTemplateBundle): string {
  return JSON.stringify(bundle);
}

export function parseMockupTemplateBundle(
  raw: string,
): { bundle: MockupTemplateBundle } | { errors: string[] } {
  if (raw.length > MOCKUP_BUNDLE_LIMITS.maxBundleBytes) {
    return { errors: ['Bundle exceeds the maximum size'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { errors: ['Bundle is not valid JSON'] };
  }
  if (!parsed || typeof parsed !== 'object') return { errors: ['Bundle must be an object'] };
  const candidate = parsed as Record<string, unknown>;
  if (candidate.format !== MOCKUP_BUNDLE_FORMAT) {
    return { errors: [`Unsupported bundle format: ${String(candidate.format)}`] };
  }
  if (candidate.version !== MOCKUP_BUNDLE_VERSION) {
    return { errors: [`Unsupported bundle version: ${String(candidate.version)}`] };
  }
  const templateJson = JSON.stringify(candidate.template ?? {});
  if (templateJson.length > MOCKUP_BUNDLE_LIMITS.maxTemplateBytes) {
    return { errors: ['Template JSON exceeds the maximum size'] };
  }
  const built = buildTemplateFromJson(candidate.template);
  if ('errors' in built) return { errors: built.errors };

  const rawAssets = Array.isArray(candidate.assets) ? candidate.assets : [];
  if (rawAssets.length > MOCKUP_BUNDLE_LIMITS.maxAssets) {
    return { errors: [`Bundle carries more than ${MOCKUP_BUNDLE_LIMITS.maxAssets} assets`] };
  }
  const assets: MockupBundleAsset[] = [];
  const seen = new Set<string>();
  for (const entry of rawAssets) {
    if (!entry || typeof entry !== 'object') return { errors: ['Bundle asset must be an object'] };
    const a = entry as Record<string, unknown>;
    if (typeof a.id !== 'string' || a.id.length === 0 || a.id.length > 256) {
      return { errors: ['Bundle asset id must be a short string'] };
    }
    if (seen.has(a.id)) return { errors: [`Duplicate bundle asset id ${a.id}`] };
    seen.add(a.id);
    if (typeof a.mimeType !== 'string' || !ALLOWED_MIME.has(a.mimeType)) {
      return { errors: [`Bundle asset ${a.id} has unsupported MIME`] };
    }
    if (typeof a.dataUrl !== 'string' || a.dataUrl.length === 0) {
      return { errors: [`Bundle asset ${a.id} is missing data`] };
    }
    const match = DATA_URL_RE.exec(a.dataUrl);
    if (!match || match[1] !== a.mimeType) {
      return { errors: [`Bundle asset ${a.id} has an invalid data URL`] };
    }
    if (a.dataUrl.length > MOCKUP_BUNDLE_LIMITS.maxAssetBytes) {
      return { errors: [`Bundle asset ${a.id} exceeds the per-asset size limit`] };
    }
    const naturalWidth = a.naturalWidth;
    const naturalHeight = a.naturalHeight;
    if (
      typeof naturalWidth !== 'number' ||
      typeof naturalHeight !== 'number' ||
      !Number.isFinite(naturalWidth) ||
      !Number.isFinite(naturalHeight) ||
      naturalWidth <= 0 ||
      naturalHeight <= 0 ||
      naturalWidth > MOCKUP_BUNDLE_LIMITS.maxAssetDimension ||
      naturalHeight > MOCKUP_BUNDLE_LIMITS.maxAssetDimension
    ) {
      return { errors: [`Bundle asset ${a.id} has invalid dimensions`] };
    }
    assets.push({
      id: a.id,
      mimeType: a.mimeType,
      dataUrl: a.dataUrl,
      naturalWidth,
      naturalHeight,
    });
  }

  const referenced = templateAssetIds(built.template);
  const provided = new Set(assets.map((a) => a.id));
  for (const assetId of referenced) {
    if (!provided.has(assetId)) {
      return { errors: [`Bundle is missing referenced asset ${assetId}`] };
    }
  }
  return {
    bundle: {
      format: MOCKUP_BUNDLE_FORMAT,
      version: MOCKUP_BUNDLE_VERSION,
      template: built.template,
      assets,
    },
  };
}

/**
 * Import a parsed bundle: embed its assets, adopt `source: 'user'` +
 * `library: true`, and resolve id collisions by minting a content-derived id.
 * Returns the document and the template id to select.
 */
export function importMockupTemplateBundle(
  doc: Document,
  bundle: MockupTemplateBundle,
): { document: Document; templateId: string } | { errors: string[] } {
  let next = doc;
  const assetIdByOriginal = new Map<string, string>();
  for (const asset of bundle.assets) {
    const result = findOrCreateEmbeddedAsset(next, {
      dataUrl: asset.dataUrl,
      mimeType: asset.mimeType,
      naturalWidth: asset.naturalWidth,
      naturalHeight: asset.naturalHeight,
    });
    next = result.document;
    assetIdByOriginal.set(asset.id, result.assetId);
  }

  const template = bundle.template;
  const remapAsset = (assetId: string | undefined): string | undefined =>
    assetId ? (assetIdByOriginal.get(assetId) ?? assetId) : undefined;
  const remapped: MockupTemplateAsset = {
    ...template,
    source: 'user',
    library: true,
    plateImage: template.plateImage
      ? {
          ...template.plateImage,
          assetId: remapAsset(template.plateImage.assetId) ?? template.plateImage.assetId,
        }
      : undefined,
    surfaces: template.surfaces.map((surface) => ({
      ...surface,
      clipMaskAssetId: remapAsset(surface.clipMaskAssetId),
      occlusionMaskAssetId: remapAsset(surface.occlusionMaskAssetId),
    })),
    updatedAt: Date.now(),
  };

  let templateId = remapped.id;
  const existing = next.mockupTemplates?.[templateId];
  if (existing) {
    const incomingHash = hashMockupTemplate(remapped);
    if (existing.contentHash === incomingHash) return { document: next, templateId };
    templateId = `user:imported-${incomingHash.slice(0, 12)}`;
    if (next.mockupTemplates?.[templateId]) {
      return { document: next, templateId };
    }
  }
  const withId: MockupTemplateAsset = { ...remapped, id: templateId };
  return {
    document: {
      ...next,
      mockupTemplates: { ...next.mockupTemplates, [templateId]: withId },
    },
    templateId,
  };
}
