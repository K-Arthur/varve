/**
 * Package export — ZIP bundle for handoff and archive workflows.
 *
 * Research basis: Illustrator package files gather the source document,
 * linked assets, font/license notes, and a report. Browser/native filesystem
 * APIs favor binary ZIP payloads over many loose writes for portability.
 */

import { dataUrlToBytes } from '@strata/import';
import {
  type Document,
  DocumentCodec,
  type Fill,
  type NodeId,
  type SceneNode,
} from '@strata/scene';
import { dtcgExport } from '@strata/ui/tokens';
import { strToU8, zipSync } from 'fflate';
import type { ExportReport } from './exportService';

export interface PackageExportResult {
  fileName: string;
  mimeType: 'application/zip';
  bytes: Uint8Array;
  manifest: PackageManifest;
}

export interface PackageManifest {
  schemaVersion: '1.0';
  kind: 'strata-package';
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
    tier: 'lossless-strata-document';
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
  bundled: false;
  reason: string;
}

interface MutablePackage {
  files: Record<string, Uint8Array>;
  contents: PackageContentEntry[];
}

export function buildPackageExport(
  doc: Document,
  exportReport?: ExportReport,
): PackageExportResult {
  const pkg: MutablePackage = { files: {}, contents: [] };
  const assets = collectAssets(doc, pkg);
  const fonts = collectFonts(doc);

  addJson(pkg, 'document.strata', 'document', DocumentCodec.encode(doc));
  addJson(pkg, 'tokens/tokens.dtcg.json', 'tokens', dtcgExport());
  addJson(pkg, 'assets/manifest.json', 'asset-manifest', { assets });
  addJson(pkg, 'fonts/manifest.json', 'font-manifest', { fonts });
  addJson(pkg, 'export-report.json', 'report', exportReport ?? emptyExportReport());

  const manifest: PackageManifest = {
    schemaVersion: '1.0',
    kind: 'strata-package',
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
      tier: 'lossless-strata-document',
      notes: [
        '.strata document is the lossless source of truth',
        'External assets and fonts are listed with license/availability notes when not bundled',
      ],
    },
  };

  addJson(pkg, 'manifest.json', 'manifest', manifest);

  return {
    fileName: `${safePackageName(doc.name)}.strata-package.zip`,
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

  return assets;
}

function collectFonts(doc: Document): PackageFontEntry[] {
  const families = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'text' && node.fontFamily) families.add(node.fontFamily);
  }
  return [...families].sort().map((family) => ({
    family,
    bundled: false,
    reason: 'Font files are not bundled unless the user confirms redistribution rights',
  }));
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
  return name.replace(/[^a-zA-Z0-9-_\s]/g, '').trim() || 'strata-package';
}
