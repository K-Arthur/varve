/**
 * Package export — ZIP bundle for handoff and archive workflows.
 *
 * Research basis: Illustrator package files gather the source document,
 * linked assets, font/license notes, and a report. Browser/native filesystem
 * APIs favor binary ZIP payloads over many loose writes for portability.
 */

import type { FontCatalog } from '@varve/engine/font';
import { dataUrlToBytes } from '@varve/import';
import { type Document, DocumentCodec, type Fill, type NodeId, type SceneNode } from '@varve/scene';
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
  return status === 'installable' || status === 'editable';
}

export interface PackageExportResult {
  fileName: string;
  mimeType: 'application/zip';
  bytes: Uint8Array;
  manifest: PackageManifest;
}

export interface PackageManifest {
  schemaVersion: '1.0';
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
    | 'asset';
  byteCount: number;
}

export interface PackageAssetEntry {
  nodeId: NodeId;
  fillIndex: number;
  source: string;
  status: 'embedded' | 'external';
  path?: string;
  mimeType?: string;
  byteCount?: number;
}

export interface PackageFontEntry {
  family: string;
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

export function buildPackageExport(
  doc: Document,
  exportReport?: ExportReport,
  catalog?: FontCatalog,
): PackageExportResult {
  const pkg: MutablePackage = { files: {}, contents: [] };
  const assets = collectAssets(doc, pkg);
  const fonts = collectFonts(doc, catalog);

  addJson(pkg, 'document.varve', 'document', DocumentCodec.encode(doc));
  addJson(pkg, 'tokens/tokens.dtcg.json', 'tokens', dtcgExport());
  addJson(pkg, 'assets/manifest.json', 'asset-manifest', { assets });
  addJson(pkg, 'fonts/manifest.json', 'font-manifest', { fonts });
  addJson(pkg, 'export-report.json', 'report', exportReport ?? emptyExportReport());

  const manifest: PackageManifest = {
    schemaVersion: '1.0',
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

  return assets;
}

function collectFonts(doc: Document, catalog?: FontCatalog): PackageFontEntry[] {
  const families = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'text' && node.fontFamily) families.add(node.fontFamily);
  }

  return [...families].sort().map((family) => {
    const embeddingStatus = resolveEmbeddingStatus(family, catalog);
    const canBundle = canBundleFont(embeddingStatus);

    return {
      family,
      bundled: canBundle,
      embeddingStatus,
      reason: embeddingReason(embeddingStatus, canBundle),
    };
  });
}

function resolveEmbeddingStatus(
  family: string,
  catalog?: FontCatalog,
): PackageFontEntry['embeddingStatus'] {
  if (!catalog) return 'unknown';

  const entries = catalog.getEntriesForFamily(family);
  if (entries.length === 0) return 'unknown';

  const rights = entries[0]!.embeddingRights;
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

function embeddingReason(status: PackageFontEntry['embeddingStatus'], canBundle: boolean): string {
  if (canBundle) {
    return 'Font embedding is permitted by the font license';
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
