/**
 * Archive builder — packages documents, settings, and assets into a
 * versioned ZIP archive with optional encryption.
 *
 * Archive ZIP structure:
 *   manifest.json
 *   document.varve            (full archive; legacy archives carry
 *                              document.strata instead — see archiveRestorer)
 *   settings/
 *     {category}.json        (per category)
 *   assets/
 *     {assetId}.{ext}        (embedded images)
 *   masks/
 *     {assetId}.png          (raster masks)
 *   checksums/
 *     manifest.sha256
 *
 * Research basis: Illustrator .ai packaging, Figma .fig export,
 * Sketch .sketch archive format.
 */

import { type Document, DocumentCodec } from '@varve/scene';
import { strToU8, zipSync } from 'fflate';
import type {
  ArchiveBuildOptions,
  ArchiveBuildResult,
  ArchiveKind,
  ArchiveManifest,
  SettingsBackupEntry,
  SettingsCategory,
} from './archiveTypes';
import { ARCHIVE_FORMAT_VERSION } from './archiveTypes';
import { computeChecksum, encryptBytes, getKdfParams } from './encryption';
import { collectSettingsBackup } from './settingsBackup';

/**
 * Build a complete archive (full or settings-only).
 * This is the main entry point for archive creation.
 */
export async function buildArchive(options: ArchiveBuildOptions): Promise<ArchiveBuildResult> {
  const { kind, signal, onProgress } = options;
  onProgress?.('preparing', 0);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  let result: ArchiveBuildResult;
  if (kind === 'full' && options.document) {
    result = await buildFullArchive(options.document, options);
  } else {
    result = await buildSettingsArchive(options);
  }

  onProgress?.('complete', 1);
  return result;
}

/**
 * Build a full project archive with document, assets, and settings.
 */
export async function buildFullArchive(
  doc: Document,
  options: ArchiveBuildOptions,
): Promise<ArchiveBuildResult> {
  const { encryption, signal, onProgress } = options;
  const files: Record<string, Uint8Array> = {};
  const checksums: Record<string, string> = {};

  // 1. Encode document
  onProgress?.('encoding-document', 0.1);
  const docJson = DocumentCodec.encode(doc);
  const docBytes = strToU8(docJson);
  files['document.varve'] = docBytes;
  checksums['document.varve'] = await computeChecksum(docBytes);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // 2. Collect and encode settings
  onProgress?.('encoding-settings', 0.3);
  const settingsCategories = options.settingsCategories ?? [];
  const settings =
    options.settings ??
    (settingsCategories.length > 0 ? collectSettingsBackup(settingsCategories) : []);

  if (settings.length > 0) {
    const grouped = groupSettingsByCategory(settings);
    for (const [category, entries] of grouped) {
      const json = JSON.stringify(entries, null, 2);
      const bytes = strToU8(`${json}\n`);
      const path = `settings/${category}.json`;
      files[path] = bytes;
      checksums[path] = await computeChecksum(bytes);
    }
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // 3. Collect embedded assets
  onProgress?.('collecting-assets', 0.5);
  const assetEntries = collectArchiveAssets(doc);
  let totalAssetBytes = 0;

  for (const entry of assetEntries) {
    files[entry.path] = entry.bytes;
    checksums[entry.path] = await computeChecksum(entry.bytes);
    totalAssetBytes += entry.bytes.byteLength;
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // 4. Create manifest
  onProgress?.('creating-manifest', 0.7);
  const manifest = createArchiveManifest({
    kind: 'full',
    document: doc,
    settings,
    assetCount: assetEntries.length,
    totalAssetBytes,
    checksums,
  });

  files['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  // 5. Package into ZIP
  onProgress?.('packaging', 0.9);
  const rawZip = zipSync(files, { level: 6 });

  // 6. Encrypt if configured
  let finalBytes: Uint8Array;
  if (encryption?.enabled && encryption.password) {
    finalBytes = await encryptBytes(rawZip, encryption.password);
    // Update manifest with encryption metadata
    manifest.encryption = {
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2',
      kdfParams: getKdfParams(),
      nonceLength: 12,
      contentHash: await computeChecksum(rawZip),
    };
    files['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
    finalBytes = await encryptBytes(zipSync(files, { level: 6 }), encryption.password);
  } else {
    finalBytes = rawZip;
  }

  const fileName = `${safeArchiveName(doc.name)}.varve-archive.zip`;
  return { fileName, bytes: finalBytes, manifest };
}

/**
 * Build a settings-only archive (no document).
 */
export async function buildSettingsArchive(
  options: ArchiveBuildOptions,
): Promise<ArchiveBuildResult> {
  const { encryption, signal, onProgress } = options;
  const files: Record<string, Uint8Array> = {};
  const checksums: Record<string, string> = {};

  onProgress?.('encoding-settings', 0.2);

  const settingsCategories = options.settingsCategories ?? ALL_CATEGORIES;
  const settings = options.settings ?? collectSettingsBackup(settingsCategories);

  const grouped = groupSettingsByCategory(settings);
  for (const [category, entries] of grouped) {
    const json = JSON.stringify(entries, null, 2);
    const bytes = strToU8(`${json}\n`);
    const path = `settings/${category}.json`;
    files[path] = bytes;
    checksums[path] = await computeChecksum(bytes);
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  onProgress?.('creating-manifest', 0.5);
  const manifest = createArchiveManifest({
    kind: 'settings-only',
    settings,
    assetCount: 0,
    totalAssetBytes: 0,
    checksums,
  });

  files['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  onProgress?.('packaging', 0.8);
  const rawZip = zipSync(files, { level: 6 });

  let finalBytes: Uint8Array;
  if (encryption?.enabled && encryption.password) {
    finalBytes = await encryptBytes(rawZip, encryption.password);
    manifest.encryption = {
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2',
      kdfParams: getKdfParams(),
      nonceLength: 12,
      contentHash: await computeChecksum(rawZip),
    };
    files['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
    finalBytes = await encryptBytes(zipSync(files, { level: 6 }), encryption.password);
  } else {
    finalBytes = rawZip;
  }

  const fileName = 'varve-settings-archive.zip';
  return { fileName, bytes: finalBytes, manifest };
}

interface ArchiveAssetEntry {
  path: string;
  bytes: Uint8Array;
}

/**
 * Collect document assets for archive storage.
 * Extracts embedded image fills and raster mask assets into separate files.
 */
export function collectArchiveAssets(doc: Document): ArchiveAssetEntry[] {
  const entries: ArchiveAssetEntry[] = [];
  const seen = new Map<string, string>();

  // Collect image fill assets
  for (const node of Object.values(doc.nodes)) {
    const fills = 'fills' in node && Array.isArray(node.fills) ? node.fills : [];
    for (const fill of fills) {
      const src = fill?.image?.src ?? fill?.pattern?.tileSrc;
      if (!src) continue;

      const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/i.exec(src);
      if (!dataUrlMatch) continue;

      const mimeType = dataUrlMatch[1];
      const b64 = dataUrlMatch[2];
      if (!mimeType || !b64) continue;
      if (seen.has(b64)) continue;

      const ext = extensionForMime(mimeType);
      const path = `assets/${String(entries.length + 1).padStart(4, '0')}.${ext}`;
      seen.set(b64, path);
      entries.push({ path, bytes: base64ToBytes(b64) });
    }
  }

  // Collect raster mask assets
  if (doc.rasterMaskAssets) {
    for (const [assetId, maskAsset] of Object.entries(doc.rasterMaskAssets)) {
      if (!maskAsset?.dataUrl) continue;
      const b64Match = /^data:[^;]+;base64,(.+)$/i.exec(maskAsset.dataUrl);
      if (!b64Match) continue;
      const b64 = b64Match[1];
      if (!b64 || seen.has(b64)) continue;

      const safeName = assetId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const path = `masks/${safeName}.png`;
      seen.set(b64, path);
      entries.push({ path, bytes: base64ToBytes(b64) });
    }
  }

  return entries;
}

/**
 * Create a versioned archive manifest.
 */
export function createArchiveManifest(params: {
  kind: ArchiveKind;
  document?: Document;
  settings?: SettingsBackupEntry[];
  assetCount: number;
  totalAssetBytes: number;
  checksums: Record<string, string>;
}): ArchiveManifest {
  return {
    formatVersion: ARCHIVE_FORMAT_VERSION,
    kind: params.kind,
    appVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    document: params.document
      ? {
          id: params.document.id,
          name: params.document.name,
          formatVersion: params.document.formatVersion,
          nodeCount: Object.keys(params.document.nodes).length,
        }
      : undefined,
    settings:
      params.settings && params.settings.length > 0
        ? {
            categories: [...new Set(params.settings.map((s) => s.category))],
            itemCount: params.settings.length,
          }
        : undefined,
    assets:
      params.assetCount > 0
        ? {
            totalBytes: params.totalAssetBytes,
            count: params.assetCount,
          }
        : undefined,
    checksums: params.checksums,
    compatibility: {
      minAppVersion: '0.1.0',
      flags: [],
    },
  };
}

/**
 * Package files into a ZIP archive.
 */
export function packageArchive(
  files: Record<string, Uint8Array>,
  manifest: ArchiveManifest,
): Uint8Array {
  files['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  return zipSync(files, { level: 6 });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function groupSettingsByCategory(
  entries: SettingsBackupEntry[],
): Map<SettingsCategory, SettingsBackupEntry[]> {
  const grouped = new Map<SettingsCategory, SettingsBackupEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.category) ?? [];
    list.push(entry);
    grouped.set(entry.category, list);
  }
  return grouped;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

function safeArchiveName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_\s]/g, '').trim() || 'varve-archive';
}

const ALL_CATEGORIES: SettingsCategory[] = [
  'appearance',
  'shortcuts',
  'workspace',
  'export',
  'performance',
  'presets',
  'swatches',
  'plugins',
];
