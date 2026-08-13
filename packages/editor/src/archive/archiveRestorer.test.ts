/**
 * Tests for archive restorer module.
 *
 * Verifies archive validation, extraction, decryption, conflict detection,
 * and restore application.
 */

import type { Document } from '@varve/scene';
import { strToU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildArchive } from './archiveBuilder';
import {
  applyRestore,
  decryptArchive,
  detectConflicts,
  extractArchiveDocument,
  extractArchiveSettings,
  restoreArchive,
  validateArchive,
} from './archiveRestorer';
import type { ArchiveManifest, SettingsBackupEntry } from './archiveTypes';
import { ARCHIVE_FORMAT_VERSION } from './archiveTypes';
import { encryptBytes } from './encryption';

function makeTestDocument(): Document {
  return {
    formatVersion: '2.7',
    id: 'doc-test-restore',
    name: 'Restore Test',
    rootChildren: ['n1'],
    nodes: {
      n1: {
        id: 'n1',
        kind: 'shape',
        name: 'Rect',
        order: 'a0',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        transform: [1, 0, 0, 1, 0, 0],
        fills: [],
        shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      },
    },
    components: {},
    nextId: 2,
  } as unknown as Document;
}

function makeManifest(overrides?: Partial<ArchiveManifest>): ArchiveManifest {
  return {
    formatVersion: ARCHIVE_FORMAT_VERSION,
    kind: 'full',
    appVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    document: {
      id: 'doc-test-restore',
      name: 'Restore Test',
      formatVersion: '2.7',
      nodeCount: 1,
    },
    checksums: {},
    compatibility: {
      minAppVersion: '0.1.0',
      flags: [],
    },
    ...overrides,
  };
}

describe('archiveRestorer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('restoreArchive', () => {
    it('restores a settings-only archive', async () => {
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({ export: { defaultScale: 1 } }),
      );

      const archive = await buildArchive({
        kind: 'settings-only',
        settingsCategories: ['export'],
      });

      const result = await restoreArchive({
        bytes: archive.bytes,
        onConflict: 'overwrite',
      });

      expect(result.warnings).toBeDefined();
      expect(result.restoredCategories).toContain('export');
    });

    it('restores a full archive with document', async () => {
      const doc = makeTestDocument();
      const archive = await buildArchive({
        kind: 'full',
        document: doc,
      });

      const result = await restoreArchive({
        bytes: archive.bytes,
      });

      expect(result.document).toBeDefined();
      expect(result.document?.id).toBe('doc-test-restore');
    });

    it('rejects empty archive', async () => {
      await expect(restoreArchive({ bytes: new Uint8Array(0) })).rejects.toThrow('empty');
    });

    it('rejects oversized archive', async () => {
      const huge = new Uint8Array(200 * 1024 * 1024);
      await expect(restoreArchive({ bytes: huge })).rejects.toThrow('exceeds maximum size');
    });

    it('rejects invalid ZIP', async () => {
      const garbage = new Uint8Array([0, 1, 2, 3, 4, 5]);
      await expect(restoreArchive({ bytes: garbage })).rejects.toThrow('Invalid ZIP');
    });

    it('reports progress during restore', async () => {
      const archive = await buildArchive({
        kind: 'settings-only',
        settingsCategories: ['export'],
      });

      const phases: string[] = [];
      await restoreArchive({
        bytes: archive.bytes,
        onProgress: (phase) => phases.push(phase),
      });

      expect(phases.length).toBeGreaterThan(0);
    });
  });

  describe('validateArchive', () => {
    it('validates a good archive', async () => {
      const archive = await buildArchive({
        kind: 'settings-only',
        settingsCategories: ['export'],
      });

      const result = await validateArchive(archive.bytes);
      expect(result.valid).toBe(true);
      expect(result.manifest).toBeDefined();
    });

    it('rejects invalid ZIP', async () => {
      const result = await validateArchive(new Uint8Array([0, 1, 2]));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid ZIP');
    });

    it('rejects archive without manifest', async () => {
      const files: Record<string, Uint8Array> = {
        'other.txt': strToU8('hello'),
      };
      const zip = await import('fflate').then((f) => f.zipSync(files));
      const result = await validateArchive(zip);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing manifest');
    });

    it('rejects entries with path-traversal names before extracting anything', async () => {
      const { zipSync } = await import('fflate');
      const files: Record<string, Uint8Array> = {
        'manifest.json': strToU8(
          JSON.stringify({
            formatVersion: ARCHIVE_FORMAT_VERSION,
            kind: 'settings-only',
            appVersion: '0.1.0',
            createdAt: new Date().toISOString(),
            checksums: {},
            compatibility: { minAppVersion: '0.1.0', flags: [] },
          }),
        ),
        '../../../../etc/passwd': strToU8('malicious'),
      };
      const zip = zipSync(files);
      const result = await validateArchive(zip);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/unsafe path/i);
    });

    it.each([
      'C:/Windows/System32/file',
      '\\\\server\\share\\file',
      'file:///etc/passwd',
      'dir/./file',
    ])('rejects absolute, URL, and dot archive names: %s', async (entryName) => {
      const { zipSync } = await import('fflate');
      const files: Record<string, Uint8Array> = {
        'manifest.json': strToU8(
          JSON.stringify({
            formatVersion: ARCHIVE_FORMAT_VERSION,
            kind: 'settings-only',
            appVersion: '0.1.0',
            createdAt: new Date().toISOString(),
            checksums: {},
            compatibility: { minAppVersion: '0.1.0', flags: [] },
          }),
        ),
        [entryName]: strToU8('malicious'),
      };
      const result = await validateArchive(zipSync(files));
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/unsafe path/i);
    });

    it('rejects entries whose declared uncompressed size exceeds the per-entry cap', async () => {
      const { zipSync } = await import('fflate');
      // A highly compressible payload — small on disk, declares a huge
      // originalSize once fflate reads its local header. The filter must
      // reject it using that declared size, without inflating it first.
      //
      // Compression level 1, not 9: the test only needs the *declared*
      // originalSize to exceed the cap (the guard rejects from the header
      // without inflating), and level 9 on a 210 MB buffer takes ~5s —
      // flirting with the 5s test timeout under parallel load.
      const bomb = new Uint8Array(210 * 1024 * 1024); // zeros compress extremely well
      const files: Record<string, Uint8Array> = {
        'manifest.json': strToU8(
          JSON.stringify({
            formatVersion: ARCHIVE_FORMAT_VERSION,
            kind: 'settings-only',
            appVersion: '0.1.0',
            createdAt: new Date().toISOString(),
            checksums: {},
            compatibility: { minAppVersion: '0.1.0', flags: [] },
          }),
        ),
        'assets/huge.bin': bomb,
      };
      const zip = zipSync(files, { level: 1 });
      const result = await validateArchive(zip);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/decompression bomb/i);
    }, 30_000);
  });

  describe('decryptArchive', () => {
    it('decrypts an encrypted archive', async () => {
      const data = new TextEncoder().encode('encrypted content');
      const password = 'test-password';
      const encrypted = await encryptBytes(data, password);
      const decrypted = await decryptArchive(encrypted, password);
      expect(decrypted.byteLength).toBe(data.byteLength);
      for (let i = 0; i < data.byteLength; i++) {
        expect(decrypted[i]).toBe(data[i]);
      }
    });

    it('throws on wrong password', async () => {
      const data = new TextEncoder().encode('secret');
      const encrypted = await encryptBytes(data, 'correct-password');
      await expect(decryptArchive(encrypted, 'wrong-password')).rejects.toThrow();
    });
  });

  describe('extractArchiveDocument', () => {
    it('extracts document from archive files', async () => {
      const doc = makeTestDocument();
      const { DocumentCodec } = await import('@varve/scene');
      const docJson = DocumentCodec.encode(doc);

      const manifest = makeManifest();
      const files: Record<string, Uint8Array> = {
        'document.strata': strToU8(docJson),
      };

      const result = extractArchiveDocument(manifest, files);
      expect(result.document).toBeDefined();
      expect(result.document?.id).toBe('doc-test-restore');
    });

    it('returns warning when document is missing', () => {
      const manifest = makeManifest();
      const result = extractArchiveDocument(manifest, {});
      expect(result.document).toBeUndefined();
      expect(result.warnings.some((w) => w.includes('no document'))).toBe(true);
    });
  });

  describe('extractArchiveSettings', () => {
    it('extracts settings entries', () => {
      const entries: SettingsBackupEntry[] = [
        { category: 'export', key: 'strata-editor-settings', value: { defaultScale: 2 } },
      ];

      const manifest = makeManifest({
        kind: 'settings-only',
        document: undefined,
        settings: { categories: ['export'], itemCount: 1 },
      });

      const files: Record<string, Uint8Array> = {
        'settings/export.json': strToU8(JSON.stringify(entries)),
      };

      const result = extractArchiveSettings(manifest, files);
      expect(result.entries).toHaveLength(1);
      expect(result.categories).toContain('export');
    });

    it('reports warnings for missing files', () => {
      const manifest = makeManifest({
        kind: 'settings-only',
        document: undefined,
        settings: { categories: ['export', 'appearance'], itemCount: 2 },
      });

      const result = extractArchiveSettings(manifest, {});
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('detectConflicts', () => {
    it('detects conflicts between archive and existing settings', () => {
      const archiveSettings: SettingsBackupEntry[] = [
        { category: 'export', key: 'test', value: { scale: 5 } },
      ];
      const existingSettings: SettingsBackupEntry[] = [
        { category: 'export', key: 'test', value: { scale: 2 } },
      ];

      const conflicts = detectConflicts(archiveSettings, existingSettings);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.category).toBe('export');
    });

    it('returns empty when no conflicts', () => {
      const archiveSettings: SettingsBackupEntry[] = [
        { category: 'export', key: 'test', value: { scale: 2 } },
      ];
      const existingSettings: SettingsBackupEntry[] = [
        { category: 'export', key: 'test', value: { scale: 2 } },
      ];

      const conflicts = detectConflicts(archiveSettings, existingSettings);
      expect(conflicts).toHaveLength(0);
    });

    it('handles empty inputs', () => {
      expect(detectConflicts([], [])).toHaveLength(0);
      expect(detectConflicts([{ category: 'export', key: 'a', value: 1 }], [])).toHaveLength(0);
    });
  });

  describe('applyRestore', () => {
    it('applies settings from restore result', async () => {
      const result = {
        settings: [
          {
            category: 'export' as const,
            key: 'strata-editor-settings',
            value: { defaultScale: 3 },
          },
        ],
        warnings: [],
        conflicts: [],
        restoredCategories: ['export' as const],
      };

      const applied = await applyRestore(result, { onConflict: 'overwrite' });
      expect(applied.applied).toBe(1);

      const stored = JSON.parse(localStorage.getItem('strata-editor-settings') ?? '{}');
      expect(stored.export).toEqual({ defaultScale: 3 });
    });

    it('returns 0 applied when no settings', async () => {
      const result = {
        warnings: [],
        conflicts: [],
        restoredCategories: [],
      };

      const applied = await applyRestore(result);
      expect(applied.applied).toBe(0);
    });
  });
});
