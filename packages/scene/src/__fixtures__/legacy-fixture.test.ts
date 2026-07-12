import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { validateDocument } from '../document';
import { CURRENT_DOCUMENT_VERSION, migrateDocument, serializeDocument } from '../version';
import legacyFixture from './legacy-v1.5.json';

describe('Legacy v1.5 Document Fixture', () => {
  it('migrates v1.5 fixture to current version', () => {
    const result = migrateDocument(legacyFixture as Record<string, unknown>);
    expect(result).not.toBeNull();

    const doc = result!;
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);

    const nodes = doc.nodes as Record<string, unknown>;
    expect(nodes['n2']).toBeDefined();
    expect(nodes['n3']).toBeDefined();
    expect(nodes['n4']).toBeDefined();
    expect(nodes['n5']).toBeDefined();

    const frame = nodes['n2'] as Record<string, unknown>;
    expect(frame.kind).toBe('frame');
    const frameChildren = frame.children as string[];
    expect(frameChildren).toContain('n2c');
    expect(nodes['n2c']).toBeDefined();

    const group = nodes['n3'] as Record<string, unknown>;
    expect(group.kind).toBe('group');
    const groupChildren = group.children as string[];
    expect(groupChildren).toContain('n3c');
    expect(nodes['n3c']).toBeDefined();
  });

  it('migrated document has no orphans and passes validateDocument', () => {
    const result = migrateDocument(legacyFixture as Record<string, unknown>);
    expect(result).not.toBeNull();

    const validation = validateDocument(result as unknown as Document);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('round-trips: migrate -> serialize -> parse -> migrate again, still valid', () => {
    const result = migrateDocument(legacyFixture as Record<string, unknown>);
    expect(result).not.toBeNull();

    // Serialize to JSON (stamps version)
    const json = serializeDocument(result!);
    const parsed = JSON.parse(json);

    // Migrate again (should be a no-op since already at current version)
    const reResult = migrateDocument(parsed);
    expect(reResult).not.toBeNull();
    expect(reResult!.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);

    // Still passes validation
    const reValidation = validateDocument(reResult as unknown as Document);
    expect(reValidation.valid).toBe(true);
    expect(reValidation.errors).toEqual([]);
  });
});
