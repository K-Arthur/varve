import { describe, expect, it } from 'vitest';
import {
  CURRENT_DOCUMENT_VERSION,
  detectForwardCompatWarning,
  isForwardCompatible,
  migrateDocument,
  migrateDocumentDetailed,
  migrateDocumentJson,
  SUPPORTED_VERSIONS,
  serializeDocument,
  stampVersion,
} from './version';

describe('Document Versioning', () => {
  it('uses the native raster-mask schema version', () => {
    expect(CURRENT_DOCUMENT_VERSION).toBe('2.1');
    expect(SUPPORTED_VERSIONS).toContain('2.1');
  });
  it('stamps current version on new documents', () => {
    const doc = stampVersion({
      id: 'd1',
      name: 'test',
    } as unknown as import('./document').Document);
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });

  it('preserves existing version if already current', () => {
    const doc = stampVersion({
      id: 'd1',
      name: 'test',
      formatVersion: CURRENT_DOCUMENT_VERSION,
    } as unknown as import('./document').Document);
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });

  it('reports supported versions list', () => {
    expect(SUPPORTED_VERSIONS).toContain(CURRENT_DOCUMENT_VERSION);
  });
});

describe('Legacy background removal migration', () => {
  it('migrates legacy backgroundRemoval into a stable native raster mask asset', () => {
    const raw = {
      id: 'legacy-mask-doc',
      name: 'Legacy mask',
      formatVersion: '2.0',
      rootChildren: ['1'],
      components: {},
      nextId: 2,
      nodes: {
        '1': {
          id: '1',
          kind: 'shape',
          name: 'Image',
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          transform: [1, 0, 0, 1, 0, 0],
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
          fills: [
            {
              type: 'image',
              image: {
                src: 'legacy-image',
                fit: 'fill',
                x: 0,
                y: 0,
                scale: 1,
                imageWidth: 64,
                imageHeight: 32,
              },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
          shape: { kind: 'rect', x: 0, y: 0, w: 64, h: 32 },
          strokes: [],
          effects: [],
          backgroundRemoval: {
            maskDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            method: 'ai-quality',
            confidence: 0.91,
            appliedAt: 1234,
            feather: 2,
            decontaminate: true,
          },
        },
      },
    };

    const migrated = migrateDocument(raw)!;
    const image = (migrated.nodes as Record<string, Record<string, unknown>>)['1']!;
    const mask = image.mask as Record<string, unknown>;
    const rasterMask = mask.rasterMask as Record<string, unknown>;
    const assets = migrated.rasterMaskAssets as Record<string, Record<string, unknown>>;

    expect(migrated.formatVersion).toBe('2.1');
    expect(mask.type).toBe('alpha');
    expect(mask.feather).toBe(2);
    expect(rasterMask.assetId).toBe('raster-mask:legacy:1');
    expect(rasterMask.provenance).toMatchObject({
      method: 'ai-quality',
      runtime: 'typescript',
      generatedAt: 1234,
      confidence: 0.91,
    });
    expect(assets['raster-mask:legacy:1']).toMatchObject({ width: 64, height: 32, byteLength: 8 });
    expect('backgroundRemoval' in image).toBe(false);
  });

  it('omits legacy backgroundRemoval when serializing a normalized document', () => {
    const doc = {
      id: 'd1',
      name: 'Legacy',
      formatVersion: '2.1',
      rootChildren: ['image-1'],
      nodes: {
        'image-1': {
          id: 'image-1',
          kind: 'shape',
          backgroundRemoval: { method: 'quick', confidence: 0.2 },
        },
      },
      components: {},
      nextId: 1,
    };
    const encoded = serializeDocument(doc);
    expect(encoded).not.toContain('backgroundRemoval');
    expect(JSON.parse(encoded).formatVersion).toBe('2.1');
  });
});

describe('Document Migration', () => {
  it('passes through a current-version document unchanged', () => {
    const raw = {
      id: 'd1',
      name: 'test',
      formatVersion: CURRENT_DOCUMENT_VERSION,
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    };
    const result = migrateDocument(raw);
    expect(result).not.toBeNull();
    const doc = result!;
    expect(doc.id).toBe('d1');
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });

  it('migrates an unversioned document (pre-1.0)', () => {
    const raw = {
      id: 'd1',
      name: 'Old Doc',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    };
    const result = migrateDocument(raw);
    expect(result).not.toBeNull();
    const doc = result!;
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(doc.id).toBe('d1');
    expect(doc.name).toBe('Old Doc');
    // The v1.2 migration wraps rootChildren into a page with a contentRoot
    expect(doc.rootChildren).toEqual(['n1']);
    expect((doc.nodes as Record<string, unknown>).n1).toBeDefined();
    expect(doc.components).toEqual({});
    expect(doc.nextId).toBe(2);
    expect((doc as Record<string, unknown>).pages).toBeDefined();
  });

  it('strips BOM and handles whitespace in JSON via migrateDocumentJson', () => {
    const json =
      '{"id":"d1","name":"test","rootChildren":[],"nodes":{},"components":{},"nextId":1}';
    const result = migrateDocumentJson(json);
    expect(result).not.toBeNull();
    const doc = result!;
    expect(doc.id).toBe('d1');
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });

  it('preserves unknown additional fields during migration', () => {
    const raw = {
      id: 'd1',
      name: 'test',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
      someFutureField: 'hello',
      nested: { a: 1 },
    };
    const result = migrateDocument(raw);
    expect(result).not.toBeNull();
    const doc = result!;
    expect(doc.someFutureField).toBe('hello');
    expect(doc.nested).toEqual({ a: 1 });
  });

  it('handles corrupt JSON gracefully', () => {
    const result = migrateDocumentJson('not valid json{{{');
    expect(result).toBeNull();
  });

  it('handles null input gracefully', () => {
    const result = migrateDocument(null);
    expect(result).toBeNull();
  });

  it('handles undefined input gracefully', () => {
    const result = migrateDocument(undefined);
    expect(result).toBeNull();
  });

  it('handles empty string JSON gracefully', () => {
    const result = migrateDocumentJson('');
    expect(result).toBeNull();
  });

  it('handles whitespace-only JSON gracefully', () => {
    const result = migrateDocumentJson('   ');
    expect(result).toBeNull();
  });
});

describe('Forward Compatibility Detection', () => {
  it('isForwardCompatible returns true for current version', () => {
    expect(isForwardCompatible(CURRENT_DOCUMENT_VERSION)).toBe(true);
  });

  it('isForwardCompatible returns true for older version', () => {
    expect(isForwardCompatible('0.9')).toBe(true);
  });

  it('isForwardCompatible returns false for newer version', () => {
    expect(isForwardCompatible('99.0')).toBe(false);
    expect(isForwardCompatible('3.0')).toBe(false);
  });

  it('isForwardCompatible returns true for 1.0 (supported older)', () => {
    expect(isForwardCompatible('1.0')).toBe(true);
  });

  it('detectForwardCompatWarning returns null for current version', () => {
    expect(detectForwardCompatWarning(CURRENT_DOCUMENT_VERSION)).toBeNull();
  });

  it('detectForwardCompatWarning returns message for newer version', () => {
    const warning = detectForwardCompatWarning('99.0');
    expect(warning).not.toBeNull();
    expect(warning).toContain('99.0');
    expect(warning).toContain('newer');
  });
});

describe('Detailed Migration', () => {
  it('returns migration result with from/to versions', () => {
    const raw = {
      id: 'd1',
      name: 'Old',
      formatVersion: '0.9',
      rootChildren: [],
      nodes: {},
    };
    const result = migrateDocumentDetailed(raw);
    expect(result).not.toBeNull();
    expect(result?.fromVersion).toBe('0.9');
    expect(result?.toVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(result?.migrated).toBe(true);
  });

  it('returns migrated=false for current version', () => {
    const raw = {
      id: 'd1',
      name: 'Current',
      formatVersion: CURRENT_DOCUMENT_VERSION,
      rootChildren: [],
      nodes: {},
    };
    const result = migrateDocumentDetailed(raw);
    expect(result).not.toBeNull();
    expect(result?.migrated).toBe(false);
    expect(result?.fromVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(result?.toVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });

  it('includes forward compat warning for newer version', () => {
    const raw = {
      id: 'd1',
      name: 'Future',
      formatVersion: '99.0',
      rootChildren: [],
      nodes: {},
    };
    const result = migrateDocumentDetailed(raw);
    expect(result).not.toBeNull();
    expect(result?.warnings.length).toBeGreaterThan(0);
    expect(result?.warnings[0]).toContain('99.0');
  });

  it('returns null for invalid input', () => {
    expect(migrateDocumentDetailed(null)).toBeNull();
    expect(migrateDocumentDetailed(undefined)).toBeNull();
    expect(migrateDocumentDetailed('string')).toBeNull();
  });

  it('preserves unknown fields through migration', () => {
    const raw = {
      id: 'd1',
      name: 'test',
      formatVersion: '0.9',
      rootChildren: [],
      nodes: {},
      customField: 'value',
    };
    const result = migrateDocumentDetailed(raw);
    expect(result).not.toBeNull();
    expect(result?.document.customField).toBe('value');
  });

  it('migrates v1.0 to current version adding print production defaults', () => {
    const raw = {
      id: 'd1',
      name: 'v1doc',
      formatVersion: '1.0',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
      canvasWidth: 1920,
      canvasHeight: 1080,
    };
    const result = migrateDocument(raw);
    expect(result).not.toBeNull();
    const doc = result!;
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(doc.documentUnit).toBe('px');
    expect(doc.dpi).toBe(0);
    expect(doc.pages).toBeDefined();
    expect((doc.pages as Record<string, unknown>[]).length).toBe(1);
    expect(doc.activePageId).toBeDefined();
    expect(doc.globalChildren).toEqual([]);
  });

  it('migrates v1.0 to current version preserving existing colorConfig', () => {
    const raw = {
      id: 'd1',
      name: 'cmyk-doc',
      formatVersion: '1.0',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
      colorConfig: { mode: 'cmyk' },
      bleed: { top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' },
    };
    const result = migrateDocument(raw);
    expect(result).not.toBeNull();
    const doc = result!;
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(doc.colorConfig).toEqual({ mode: 'cmyk' });
    expect(doc.bleed).toEqual({ top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' });
  });

  it('migrates v1.1 to current version adding motion/animation fields', () => {
    const raw = {
      id: 'd1',
      name: 'pre-motion',
      formatVersion: '1.1',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
      canvasWidth: 1440,
      canvasHeight: 1024,
      documentUnit: 'px',
      dpi: 0,
    };
    const result = migrateDocument(raw);
    expect(result).not.toBeNull();
    const doc = result!;
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(doc).toHaveProperty('timelines');
    expect(doc.timelines).toBeUndefined();
    expect(doc).toHaveProperty('activeTimelineId');
    expect(doc.activeTimelineId).toBeUndefined();
  });

  it('preserves existing timelines during 1.1→current migration', () => {
    const raw = {
      id: 'd1',
      name: 'with-motion',
      formatVersion: '1.1',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
      timelines: {
        'tl-1': {
          id: 'tl-1',
          name: 'Existing',
          duration: 3000,
          defaultEasing: { kind: 'easeOut' },
          tracks: [],
        },
      },
    };
    const result = migrateDocument(raw);
    expect(result).not.toBeNull();
    const doc = result!;
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(doc.timelines).toBeDefined();
    expect((doc.timelines as Record<string, unknown>)['tl-1']).toBeDefined();
  });

  it('migrates 1.6 guides to page-scoped 1.7', () => {
    const raw = {
      id: 'd1',
      name: 'test',
      formatVersion: '1.6',
      activePageId: 'page-1',
      pages: [{ id: 'page-1', name: 'Page 1', contentRoot: 'root' }],
      guides: [{ id: 'g1', axis: 'vertical', position: 100 }],
      rootChildren: [],
      nodes: {},
    };
    const migrated = migrateDocument(raw);
    expect(migrated?.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect((migrated?.guides as { pageId: string }[])?.[0]?.pageId).toBe('page-1');
  });
});

describe('serializeDocument', () => {
  it('stamps current version and produces valid JSON', () => {
    const doc = { id: 'd1', name: 'test', rootChildren: [], nodes: {} };
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json);
    expect(parsed.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(parsed.id).toBe('d1');
  });

  it('preserves all document fields', () => {
    const doc = {
      id: 'd1',
      name: 'My Design',
      rootChildren: ['n1'],
      nodes: { n1: { id: 'n1', kind: 'rect', name: 'Box' } },
      nextId: 2,
    };
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('My Design');
    expect(parsed.nodes.n1.kind).toBe('rect');
    expect(parsed.nextId).toBe(2);
  });

  it('overrides existing older version with current version', () => {
    const doc = { id: 'd1', name: 'test', formatVersion: '1.0', rootChildren: [], nodes: {} };
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json);
    expect(parsed.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });

  it('returns a string', () => {
    const doc = { id: 'd1', name: 'test', rootChildren: [], nodes: {} };
    const result = serializeDocument(doc);
    expect(typeof result).toBe('string');
  });
});
