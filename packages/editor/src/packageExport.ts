/**
 * Package export — ZIP bundle for handoff and archive workflows.
 *
 * Research basis: Illustrator package files gather the source document,
 * linked assets, font/license notes, and a report. Browser/native filesystem
 * APIs favor binary ZIP payloads over many loose writes for portability.
 */

import {
  collectFontData,
  type FontCatalog,
  type FontEmbeddingPolicy,
  type FontIdentity,
  type FontManifestStatus,
  type FontReference,
  type FontSourceKind,
  fontReferenceFromIdentity,
  inheritedFontReference,
  fontReferenceKey,
} from '@varve/engine/font';
import { dataUrlToBytes } from '@varve/import';
import {
  type Document,
  type DocumentAsset,
  DocumentCodec,
  type Fill,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import { dtcgExport } from '@varve/ui/tokens';
import { strToU8, zipSync } from 'fflate';
import type { ExportReport } from './exportService';

/**
 * Convert raw fsType embedding bits to a PackageFontEntry embedding status string.
 * Exported for use by callers who have parsed fsType data.
 */
export function embeddingStatusFromRights(fsType?: number): PackageFontEntry['embeddingStatus'] {
  if (fsType === undefined || fsType === null) return 'unknown';
  const noSubsetting = (fsType & 0x0100) !== 0;
  if (noSubsetting) return 'no-subsetting';
  if (fsType & 0x0002) return 'restricted';
  if (fsType & 0x0004) return 'preview-and-print';
  if (fsType & 0x0008) return 'editable';
  return 'installable';
}

/** Determine if embedding rights permit including the font in a package. */
function canBundleFont(status: PackageFontEntry['embeddingStatus']): boolean {
  return status === 'installable' || status === 'editable' || status === 'no-subsetting';
}

export interface PackageExportResult {
  fileName: string;
  mimeType: 'application/zip';
  bytes: Uint8Array;
  manifest: PackageManifest;
}

export interface PackageManifest {
  schemaVersion: '2.0';
  kind: 'varve-package';
  createdAt: string;
  document: {
    id: string;
    name: string;
    formatVersion: string;
    nodeCount: number;
  };
  contents: PackageContentEntry[];
  assets: PackageAssetEntry[];
  fonts: PackageFontEntry[];
  /** The scoped document manifest retained alongside the package notes. */
  fontManifest?: Document['fontManifest'];
  compatibility: {
    tier: 'lossless-varve-document';
    notes: string[];
  };
}

export interface PackageContentEntry {
  path: string;
  kind:
    | 'document'
    | 'manifest'
    | 'report'
    | 'tokens'
    | 'asset-manifest'
    | 'font-manifest'
    | 'font'
    | 'asset';
  byteCount: number;
}

export interface PackageAssetEntry {
  nodeId: NodeId;
  fillIndex: number;
  source: string;
  status: 'embedded' | 'external';
  assetId?: string;
  purpose?: string;
  path?: string;
  mimeType?: string;
  byteCount?: number;
}

export interface PackageFontEntry {
  family: string;
  /** Exact requested artifact/member when the document carries one. */
  fontReference?: FontReference;
  identity?: FontIdentity;
  source?: FontSourceKind;
  status?: FontManifestStatus;
  embeddingPolicy?: FontEmbeddingPolicy;
  bundled: boolean;
  reason: string;
  embeddingStatus:
    | 'installable'
    | 'preview-and-print'
    | 'editable'
    | 'restricted'
    | 'no-subsetting'
    | 'unknown';
  embedded?: boolean;
  filePath?: string;
  byteCount?: number;
}

interface MutablePackage {
  files: Record<string, Uint8Array>;
  contents: PackageContentEntry[];
}

export async function buildPackageExport(
  doc: Document,
  exportReport?: ExportReport,
  catalog?: FontCatalog,
): Promise<PackageExportResult> {
  const pkg: MutablePackage = { files: {}, contents: [] };
  const assets = collectAssets(doc, pkg);
  const fonts = await collectFonts(doc, catalog, pkg);

  addJson(pkg, 'document.varve', 'document', DocumentCodec.encode(doc));
  addJson(pkg, 'tokens/tokens.dtcg.json', 'tokens', dtcgExport());
  addJson(pkg, 'assets/manifest.json', 'asset-manifest', { assets });
  addJson(pkg, 'fonts/manifest.json', 'font-manifest', {
    version: 2,
    fonts,
    ...(doc.fontManifest ? { documentManifest: doc.fontManifest } : {}),
  });
  addJson(pkg, 'export-report.json', 'report', exportReport ?? emptyExportReport());

  const manifest: PackageManifest = {
    schemaVersion: '2.0',
    kind: 'varve-package',
    createdAt: new Date().toISOString(),
    document: {
      id: doc.id,
      name: doc.name,
      formatVersion: doc.formatVersion,
      nodeCount: Object.keys(doc.nodes).length,
    },
    contents: pkg.contents,
    assets,
    fonts,
    ...(doc.fontManifest ? { fontManifest: doc.fontManifest } : {}),
    compatibility: {
      tier: 'lossless-varve-document',
      notes: [
        '.varve document is the lossless source of truth',
        'External assets and fonts are listed with license/availability notes when not bundled',
        'Font files are only bundled when embedding is permitted by the font license',
      ],
    },
  };

  addJson(pkg, 'manifest.json', 'manifest', manifest);

  return {
    fileName: `${safePackageName(doc.name)}.varve-package.zip`,
    mimeType: 'application/zip',
    bytes: zipSync(pkg.files, { level: 6 }),
    manifest,
  };
}

function collectAssets(doc: Document, pkg: MutablePackage): PackageAssetEntry[] {
  const assets: PackageAssetEntry[] = [];
  const seen = new Map<string, string>();

  for (const node of Object.values(doc.nodes)) {
    const fills = fillsForNode(node);
    for (let i = 0; i < fills.length; i++) {
      const src = fills[i]?.image?.src ?? fills[i]?.pattern?.tileSrc;
      if (!src) continue;
      const embedded = dataUrlAsset(src);
      if (!embedded) {
        assets.push({ nodeId: node.id, fillIndex: i, source: src, status: 'external' });
        continue;
      }
      const existingPath = seen.get(src);
      const path =
        existingPath ??
        `assets/${String(seen.size + 1).padStart(4, '0')}.${extensionForMime(embedded.mimeType)}`;
      if (!existingPath) {
        seen.set(src, path);
        addBytes(pkg, path, 'asset', embedded.bytes);
      }
      assets.push({
        nodeId: node.id,
        fillIndex: i,
        source: src,
        status: 'embedded',
        path,
        mimeType: embedded.mimeType,
        byteCount: embedded.bytes.byteLength,
      });
    }
  }

  // Collect raster mask assets from doc.rasterMaskAssets.
  // Each mask asset is a data URL that must be decoded and stored as a
  // separate file in the package with a deterministic name derived from
  // the asset id. Checksums are preserved for deduplication.
  if (doc.rasterMaskAssets) {
    for (const [assetId, maskAsset] of Object.entries(doc.rasterMaskAssets)) {
      const src = maskAsset.dataUrl;
      if (!src) continue;
      const existingPath = seen.get(src);
      if (existingPath) {
        // Deduplicate: same data URL → same file path
        assets.push({
          nodeId: assetId,
          fillIndex: -1,
          source: src,
          status: 'embedded',
          path: existingPath,
          mimeType: 'image/png',
          byteCount: maskAsset.byteLength,
        });
        continue;
      }
      const safeName = assetId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const path = `masks/${safeName}.png`;
      seen.set(src, path);
      const decoded = dataUrlToBytes(src);
      addBytes(pkg, path, 'asset', decoded);
      assets.push({
        nodeId: assetId,
        fillIndex: -1,
        source: src,
        status: 'embedded',
        path,
        mimeType: 'image/png',
        byteCount: decoded.byteLength,
      });
    }
  }

  // Generative candidates and immutable sources are not necessarily attached
  // to a node fill. Include their embedded payloads in the package manifest so
  // an accepted edit can be reopened, restored, or regenerated after the
  // original source layer/model is unavailable.
  for (const edit of Object.values(doc.generativeEdits ?? {})) {
    const references: Array<{ assetId?: string; purpose: string }> = [
      { assetId: edit.sourceAssetId, purpose: 'generative-source' },
      { assetId: edit.sourceSnapshotAssetId, purpose: 'generative-source-snapshot' },
      ...edit.variations.flatMap((variation) => [
        { assetId: variation.assetId, purpose: 'generative-variation' },
        { assetId: variation.thumbnailAssetId, purpose: 'generative-thumbnail' },
        { assetId: variation.contextAssetId, purpose: 'generative-context' },
      ]),
    ];
    for (const reference of references) {
      if (!reference.assetId) continue;
      const asset = doc.assets?.[reference.assetId];
      if (asset) addGenerativeAsset(pkg, assets, seen, edit.sourceNodeId, asset, reference.purpose);
    }
  }

  return assets;
}

function addGenerativeAsset(
  pkg: MutablePackage,
  assets: PackageAssetEntry[],
  seen: Map<string, string>,
  nodeId: NodeId,
  asset: DocumentAsset,
  purpose: string,
): void {
  const embedded = dataUrlAsset(asset.dataUrl);
  if (!embedded) return;
  const existingPath = seen.get(asset.dataUrl);
  const path =
    existingPath ?? `generative/${safeAssetName(asset.id)}.${extensionForMime(embedded.mimeType)}`;
  if (!existingPath) {
    seen.set(asset.dataUrl, path);
    addBytes(pkg, path, 'asset', embedded.bytes);
  }
  assets.push({
    nodeId,
    fillIndex: -1,
    source: `asset:${asset.id}`,
    status: 'embedded',
    assetId: asset.id,
    purpose,
    path,
    mimeType: embedded.mimeType,
    byteCount: embedded.bytes.byteLength,
  });
}

async function collectFonts(
  doc: Document,
  catalog: FontCatalog | undefined,
  pkg: MutablePackage,
): Promise<PackageFontEntry[]> {
  const requests = new Map<string, { family: string; fontReference?: FontReference }>();
  const addRequest = (family: string | undefined, fontReference?: FontReference): void => {
    if (!family?.trim()) return;
    const normalizedFamily = family.trim();
    const key = fontReference
      ? `${normalizedFamily.toLocaleLowerCase()}\u0000${fontReferenceKey(fontReference)}`
      : normalizedFamily.toLocaleLowerCase();
    if (!requests.has(key)) requests.set(key, { family: normalizedFamily, fontReference });
  };
  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text') continue;
    addRequest(node.fontFamily, node.fontReference);
    for (const paragraph of node.richText?.paragraphs ?? []) {
      for (const run of paragraph.runs ?? []) {
        const runFamily = run.format?.fontFamily ?? node.fontFamily;
        const runReference = inheritedFontReference(
          node.fontFamily,
          node.fontReference,
          run.format?.fontFamily,
          run.format?.fontReference,
        );
        addRequest(runFamily, runReference);
      }
    }
  }
  for (const style of Object.values(doc.styles ?? {})) {
    const candidate = style as unknown as {
      type?: string;
      fontFamily?: string;
      fontReference?: FontReference;
      format?: { fontFamily?: string; fontReference?: FontReference };
      characterFormat?: { fontFamily?: string; fontReference?: FontReference };
    };
    if (candidate.type === 'text') addRequest(candidate.fontFamily, candidate.fontReference);
    addRequest(candidate.format?.fontFamily, candidate.format?.fontReference);
    addRequest(candidate.characterFormat?.fontFamily, candidate.characterFormat?.fontReference);
  }

  // Package export is an explicit user action, so bundled assets may be
  // resolved from the shipped registry. The manifest must still be honest:
  // a permitted license without bytes is listed as unavailable rather than
  // claiming a font that the ZIP does not contain.
  const requestedFonts = [...requests.values()].sort((a, b) => {
    const familyOrder = a.family.localeCompare(b.family);
    if (familyOrder !== 0) return familyOrder;
    return (a.fontReference ? fontReferenceKey(a.fontReference) : '').localeCompare(
      b.fontReference ? fontReferenceKey(b.fontReference) : '',
    );
  });
  // A legacy family-only request has no portable face identity. Do not fetch
  // the first family entry and present it as the authored face; that would
  // silently change weight/style or a same-family artifact on another device.
  // The manifest keeps the request visible so the user can choose an exact
  // face before exporting editable text.
  const records = await collectFontData(
    requestedFonts.filter((request) => request.fontReference !== undefined),
    { fetchBundled: true },
  );
  const recordByRequest = new Map(
    records.map((record) => [
      record.fontReference
        ? `${record.family.toLocaleLowerCase()}\u0000${fontReferenceKey(record.fontReference)}`
        : record.family.toLocaleLowerCase(),
      record,
    ]),
  );

  return requestedFonts.map(({ family, fontReference }) => {
    const requestKey = fontReference
      ? `${family.toLocaleLowerCase()}\u0000${fontReferenceKey(fontReference)}`
      : family.toLocaleLowerCase();
    const manifestEntry = findManifestEntry(doc.fontManifest, family, fontReference);
    const embeddingStatus = resolveEmbeddingStatus(
      family,
      catalog,
      fontReference,
      manifestEntry?.embeddingRights,
    );
    const canBundle = fontReference !== undefined && canBundleFont(embeddingStatus);
    const record = fontReference ? recordByRequest.get(requestKey) : undefined;
    const bundled = canBundle && record !== undefined;
    let filePath: string | undefined;
    if (bundled && record) {
      const suffix = fontReference
        ? `-${fontReference.artifactHash.slice(0, 12)}-${fontReference.collectionIndex ?? 'single'}`
        : '';
      filePath = `fonts/${safeFontName(family)}${suffix}.font`;
      addBytes(pkg, filePath, 'font', record.data);
    }

    return {
      family,
      ...(fontReference ? { fontReference } : {}),
      ...(manifestEntry?.identity ? { identity: manifestEntry.identity } : {}),
      ...(manifestEntry?.source ? { source: manifestEntry.source } : {}),
      ...(manifestEntry?.status ? { status: manifestEntry.status } : {}),
      ...(manifestEntry?.embeddingPolicy ? { embeddingPolicy: manifestEntry.embeddingPolicy } : {}),
      bundled,
      embeddingStatus,
      reason: embeddingReason(
        embeddingStatus,
        bundled,
        record !== undefined,
        fontReference !== undefined,
      ),
      ...(filePath ? { filePath, byteCount: record?.data.byteLength } : {}),
    };
  });
}

function resolveEmbeddingStatus(
  family: string,
  catalog?: FontCatalog,
  fontReference?: FontReference,
  manifestRights?: PackageFontEntry['embeddingStatus'],
): PackageFontEntry['embeddingStatus'] {
  if (!catalog) return manifestRights ?? 'unknown';

  const entries = catalog.getEntriesForFamily(family);
  if (entries.length === 0) return manifestRights ?? 'unknown';

  const entry = fontReference
    ? entries.find((candidate) => {
        const candidateReference = fontReferenceFromIdentity(candidate.identity);
        return (
          candidateReference !== undefined &&
          fontReferenceKey(candidateReference) === fontReferenceKey(fontReference)
        );
      })
    : entries[0];
  const rights =
    entry?.embeddingRights ?? (fontReference ? manifestRights : entries[0]!.embeddingRights);
  switch (rights) {
    case 'installable':
      return 'installable';
    case 'editable':
      return 'editable';
    case 'preview-and-print':
      return 'preview-and-print';
    case 'restricted':
      return 'restricted';
    case 'no-subsetting':
      return 'no-subsetting';
    default:
      return 'unknown';
  }
}

function findManifestEntry(
  manifest: Document['fontManifest'],
  family: string,
  reference?: FontReference,
): NonNullable<Document['fontManifest']>['fonts'][number] | undefined {
  const normalized = family.toLowerCase();
  return (manifest?.fonts ?? []).find((entry) => {
    if (entry.familyName.toLowerCase() !== normalized) return false;
    if (!reference) return !entry.fontReference;
    return (
      entry.fontReference !== undefined &&
      fontReferenceKey(entry.fontReference) === fontReferenceKey(reference)
    );
  });
}

function embeddingReason(
  status: PackageFontEntry['embeddingStatus'],
  bundled: boolean,
  bytesAvailable: boolean,
  hasExactReference: boolean,
): string {
  if (!hasExactReference) {
    return 'Family-only legacy request has no exact face identity; choose a face before embedding';
  }
  if (bundled) {
    return 'Font bytes were verified and included because embedding is permitted by the font license';
  }
  if (canBundleFont(status) && !bytesAvailable) {
    return 'Embedding is permitted, but the exact font bytes are unavailable on this device';
  }
  switch (status) {
    case 'restricted':
      return 'Font embedding is restricted by the font license';
    case 'preview-and-print':
      return 'Font permits preview/print embedding only — not editable document embedding';
    case 'no-subsetting':
      return 'Font permits embedding but prohibits subsetting';
    default:
      return 'Font files are not bundled. Embedding requires user confirmation of redistribution rights';
  }
}

function fillsForNode(node: SceneNode): Fill[] {
  return 'fills' in node && Array.isArray(node.fills) ? node.fills : [];
}

function dataUrlAsset(src: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,/i.exec(src);
  if (!match?.[1]) return null;
  return { mimeType: match[1], bytes: dataUrlToBytes(src) };
}

function addJson(
  pkg: MutablePackage,
  path: string,
  kind: PackageContentEntry['kind'],
  value: unknown,
): void {
  addBytes(pkg, path, kind, strToU8(`${JSON.stringify(value, null, 2)}\n`));
}

function addBytes(
  pkg: MutablePackage,
  path: string,
  kind: PackageContentEntry['kind'],
  bytes: Uint8Array,
): void {
  pkg.files[path] = bytes;
  pkg.contents.push({ path, kind, byteCount: bytes.byteLength });
}

function emptyExportReport(): ExportReport {
  const now = Date.now();
  return {
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    totalJobs: 0,
    successCount: 0,
    failureCount: 0,
    files: [],
  };
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/svg+xml':
      return 'svg';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

function safePackageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_\s]/g, '').trim() || 'varve-package';
}

function safeFontName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_').trim() || 'font';
}

function safeAssetName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_').trim() || 'asset';
}
