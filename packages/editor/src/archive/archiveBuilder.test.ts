/**
 * Tests for archive builder module.
 *
 * Verifies full and settings-only archive creation, manifest validation,
 * asset collection, and ZIP packaging.
 */

import type { Document } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildArchive,
  buildFullArchive,
  buildSettingsArchive,
  collectArchiveAssets,
  createArchiveManifest,
  packageArchive,
} from './archiveBuilder';
import type { SettingsBackupEntry } from './archiveTypes';
import { ARCHIVE_FORMAT_VERSION } from './archiveTypes';
import { inMemoryClear } from './safeWrite';

function makeTestDocument(): Document {
  return {
    formatVersion: '2.7',
    id: 'doc-test-1',
    name: 'Test Document',
    rootChildren: ['n1'],
    nodes: {
      n1: {
        id: 'n1',
        kind: 'shape',
        name: 'Rectangle',
        order: 'a0',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        transform: [1, 0, 0, 1, 100, 100],
        fills: [
          {
            type: 'solid',
            color: { r: 255, g: 0, b: 0, a: 1 },
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      },
    },
    components: {},
    nextId: 2,
  } as unknown as Document;
}

describe('archiveBuilder', () => {
  beforeEach(() => {
    localStorage.clear();
    inMemoryClear();
  });

  afterEach(() => {
    localStorage.clear();
    inMemoryClear();
  });

  describe('buildArchive', () => {
    it('builds a settings-only archive', async () => {
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({ export: { defaultScale: 2 } }),
      );

      const result = await buildArchive({
        kind: 'settings-only',
        settingsCategories: ['export'],
      });

      expect(result.bytes.byteLength).toBeGreaterThan(0);
      expect(result.manifest.kind).toBe('settings-only');
      expect(result.manifest.formatVersion).toBe(ARCHIVE_FORMAT_VERSION);
      expect(result.fileName).toBe('varve-settings-archive.zip');
    });

    it('builds a full archive with document', async () => {
      const doc = makeTestDocument();
      const result = await buildArchive({
        kind: 'full',
        document: doc,
      });

      expect(result.bytes.byteLength).toBeGreaterThan(0);
      expect(result.manifest.kind).toBe('full');
      expect(result.manifest.document).toBeDefined();
      expect(result.manifest.document?.id).toBe('doc-test-1');
      expect(result.manifest.document?.name).toBe('Test Document');
    });

    it('reports progress callbacks', async () => {
      const progressCalls: Array<{ phase: string; progress: number }> = [];
      const doc = makeTestDocument();

      await buildArchive({
        kind: 'full',
        document: doc,
        onProgress: (phase, progress) => progressCalls.push({ phase, progress }),
      });

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1]!.phase).toBe('complete');
      expect(progressCalls[progressCalls.length - 1]!.progress).toBe(1);
    });

    it('supports AbortSignal', async () => {
      const controller = new AbortController();
      controller.abort();
      const doc = makeTestDocument();

      await expect(
        buildArchive({
          kind: 'full',
          document: doc,
          signal: controller.signal,
        }),
      ).rejects.toThrow('Aborted');
    });
  });

  describe('buildFullArchive', () => {
    it('includes document data', async () => {
      const doc = makeTestDocument();
      const result = await buildFullArchive(doc, { kind: 'full' });

      expect(result.manifest.document).toBeDefined();
      expect(result.manifest.document?.nodeCount).toBe(1);
    });

    it('includes settings when provided', async () => {
      const doc = makeTestDocument();
      const settings: SettingsBackupEntry[] = [
        { category: 'export', key: 'strata-editor-settings', value: { defaultScale: 3 } },
      ];

      const result = await buildFullArchive(doc, {
        kind: 'full',
        settings,
      });

      expect(result.manifest.settings).toBeDefined();
      expect(result.manifest.settings?.itemCount).toBe(1);
    });

    it('includes checksums in manifest', async () => {
      const doc = makeTestDocument();
      const result = await buildFullArchive(doc, { kind: 'full' });

      expect(Object.keys(result.manifest.checksums).length).toBeGreaterThan(0);
      expect(result.manifest.checksums['document.varve']).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('buildSettingsArchive', () => {
    it('creates archive with settings entries', async () => {
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({
          export: { defaultScale: 2 },
          appearance: { theme: 'dark' },
        }),
      );

      const result = await buildSettingsArchive({
        kind: 'settings-only',
        settingsCategories: ['export', 'appearance'],
      });

      expect(result.manifest.settings).toBeDefined();
      expect(result.manifest.settings?.categories).toContain('export');
      expect(result.manifest.settings?.categories).toContain('appearance');
    });
  });

  describe('collectArchiveAssets', () => {
    it('collects image fill assets', () => {
      const doc = {
        ...makeTestDocument(),
        nodes: {
          n1: {
            ...makeTestDocument().nodes.n1,
            fills: [
              {
                type: 'image',
                image: {
                  src: 'data:image/png;base64,AAAA',
                  fit: 'fill',
                },
                opacity: 1,
                blendMode: 'normal',
                visible: true,
              },
            ],
          },
        },
      } as unknown as Document;

      const assets = collectArchiveAssets(doc);
      expect(assets.length).toBe(1);
      expect(assets[0]!.path).toMatch(/^assets\/\d{4}\.png$/);
    });

    it('collects raster mask assets', () => {
      const doc = {
        ...makeTestDocument(),
        rasterMaskAssets: {
          'mask-1': {
            id: 'mask-1',
            dataUrl: 'data:image/png;base64,BBBB',
            mimeType: 'image/png',
            width: 100,
            height: 100,
            byteLength: 3,
            hash: 'abc',
          },
        },
      } as unknown as Document;

      const assets = collectArchiveAssets(doc);
      expect(assets.length).toBe(1);
      expect(assets[0]!.path).toMatch(/^masks\/mask-1\.png$/);
    });

    it('deduplicates identical assets', () => {
      const doc = {
        ...makeTestDocument(),
        nodes: {
          n1: {
            ...makeTestDocument().nodes.n1,
            fills: [
              {
                type: 'image',
                image: { src: 'data:image/png;base64,AAAA', fit: 'fill' },
                opacity: 1,
                blendMode: 'normal',
                visible: true,
              },
            ],
          },
          n2: {
            ...makeTestDocument().nodes.n1,
            id: 'n2',
            fills: [
              {
                type: 'image',
                image: { src: 'data:image/png;base64,AAAA', fit: 'fill' },
                opacity: 1,
                blendMode: 'normal',
                visible: true,
              },
            ],
          },
        },
      } as unknown as Document;

      const assets = collectArchiveAssets(doc);
      expect(assets.length).toBe(1); // Deduplicated
    });

    it('returns empty array for documents without image assets', () => {
      const doc = makeTestDocument();
      const assets = collectArchiveAssets(doc);
      expect(assets).toEqual([]);
    });
  });

  describe('createArchiveManifest', () => {
    it('creates a valid manifest', () => {
      const doc = makeTestDocument();
      const manifest = createArchiveManifest({
        kind: 'full',
        document: doc,
        assetCount: 2,
        totalAssetBytes: 1024,
        checksums: { 'manifest.json': 'abc123' },
      });

      expect(manifest.formatVersion).toBe(ARCHIVE_FORMAT_VERSION);
      expect(manifest.kind).toBe('full');
      expect(manifest.document?.id).toBe('doc-test-1');
      expect(manifest.assets?.count).toBe(2);
      expect(manifest.assets?.totalBytes).toBe(1024);
      expect(manifest.compatibility.minAppVersion).toBe('0.1.0');
    });

    it('omits document for settings-only manifest', () => {
      const manifest = createArchiveManifest({
        kind: 'settings-only',
        assetCount: 0,
        totalAssetBytes: 0,
        checksums: {},
      });

      expect(manifest.document).toBeUndefined();
      expect(manifest.kind).toBe('settings-only');
    });
  });

  describe('packageArchive', () => {
    it('produces a valid ZIP', () => {
      const files: Record<string, Uint8Array> = {
        'test.txt': new TextEncoder().encode('hello'),
      };
      const manifest = createArchiveManifest({
        kind: 'settings-only',
        assetCount: 0,
        totalAssetBytes: 0,
        checksums: {},
      });

      const zip = packageArchive(files, manifest);
      expect(zip.byteLength).toBeGreaterThan(0);
      // ZIP magic number
      expect(zip[0]).toBe(0x50); // P
      expect(zip[1]).toBe(0x4b); // K
    });
  });
});
