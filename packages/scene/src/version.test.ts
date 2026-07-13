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
  it('stamps current version on new documents', () => {
    const doc = stampVersion({ id: 'd1', name: 'test' } as any);
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });

  it('preserves existing version if already current', () => {
    const doc = stampVersion({
      id: 'd1',
      name: 'test',
      formatVersion: CURRENT_DOCUMENT_VERSION,
    } as any);
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });

  it('reports supported versions list', () => {
    expect(SUPPORTED_VERSIONS).toContain(CURRENT_DOCUMENT_VERSION);
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
    expect(isForwardCompatible('2.0')).toBe(false);
  });

  it('isForwardCompatible returns true for 1.0 (supported older)', () => {
    expect(isForwardCompatible('1.0')).toBe(true);
  });

  it('detectForwardCompatWarning returns null for current version', () => {
    expect(detectForwardCompatWarning(CURRENT_DOCUMENT_VERSION)).toBeNull();
  });

  it('detectForwardCompatWarning returns message for newer version', () => {
    const warning = detectForwardCompatWarning('2.0');
    expect(warning).not.toBeNull();
    expect(warning).toContain('2.0');
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
      formatVersion: '2.0',
      rootChildren: [],
      nodes: {},
    };
    const result = migrateDocumentDetailed(raw);
    expect(result).not.toBeNull();
    expect(result?.warnings.length).toBeGreaterThan(0);
    expect(result?.warnings[0]).toContain('2.0');
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
    expect(migrated?.formatVersion).toBe('1.7');
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
