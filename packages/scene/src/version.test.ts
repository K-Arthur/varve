import { describe, expect, it } from 'vitest';
import {
  CURRENT_DOCUMENT_VERSION,
  migrateDocument,
  stampVersion,
  SUPPORTED_VERSIONS,
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
    const doc = migrateDocument(raw);
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
    const doc = migrateDocument(raw);
    expect(doc.formatVersion).toBe('1.0');
    expect(doc.id).toBe('d1');
    expect(doc.name).toBe('Old Doc');
    expect(doc.rootChildren).toEqual([]);
    expect(doc.nodes).toEqual({});
    expect(doc.components).toEqual({});
    expect(doc.nextId).toBe(1);
  });

  it('strips BOM and handles whitespace in JSON via migrateDocumentJson', async () => {
    const { migrateDocumentJson } = await import('./version');
    const json = '{"id":"d1","name":"test","rootChildren":[],"nodes":{},"components":{},"nextId":1}';
    const doc = migrateDocumentJson(json);
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
    const doc = migrateDocument(raw);
    expect((doc as any).someFutureField).toBe('hello');
    expect((doc as any).nested).toEqual({ a: 1 });
  });

  it('handles corrupt JSON gracefully', async () => {
    const { migrateDocumentJson } = await import('./version');
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
});
