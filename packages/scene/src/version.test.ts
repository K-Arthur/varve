import { describe, expect, it } from 'vitest';
import {
  CURRENT_DOCUMENT_VERSION,
  detectForwardCompatWarning,
  isForwardCompatible,
  migrateDocument,
  migrateDocumentDetailed,
  migrateDocumentJson,
  SUPPORTED_VERSIONS,
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
    expect(doc.formatVersion).toBe('1.0');
    expect(doc.id).toBe('d1');
    expect(doc.name).toBe('Old Doc');
    expect(doc.rootChildren).toEqual([]);
    expect(doc.nodes).toEqual({});
    expect(doc.components).toEqual({});
    expect(doc.nextId).toBe(1);
  });

  it('strips BOM and handles whitespace in JSON via migrateDocumentJson', () => {
    const json =
      '{"id":"d1","name":"test","rootChildren":[],"nodes":{},"components":{},"nextId":1}';
    const result = migrateDocumentJson(json);
    expect(result).not.toBeNull();
    const doc = result!;
    expect(doc.id).toBe('d1');
    expect(doc.formatVersion).toBe('1.0');
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
    expect(isForwardCompatible('2.0')).toBe(false);
    expect(isForwardCompatible('1.1')).toBe(false);
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
    expect(result!.fromVersion).toBe('0.9');
    expect(result!.toVersion).toBe('1.0');
    expect(result!.migrated).toBe(true);
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
    expect(result!.migrated).toBe(false);
    expect(result!.fromVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(result!.toVersion).toBe(CURRENT_DOCUMENT_VERSION);
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
    expect(result!.warnings.length).toBeGreaterThan(0);
    expect(result!.warnings[0]).toContain('2.0');
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
    expect(result!.document.customField).toBe('value');
  });
});
