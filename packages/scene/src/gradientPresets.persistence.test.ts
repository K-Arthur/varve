/**
 * Gradient-preset persistence tests: document-local helpers + the
 * 2.10 -> 2.11 migration.
 */

import { makeAdjustment } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { DocumentCodec } from './documentCodec';
import {
  addGradientPresetsToDocument,
  findDocumentGradientPreset,
  getDocumentGradientPresets,
  gradientPresetIsReferenced,
  makeGradientPreset,
  removeGradientPresetsFromDocument,
  renameDocumentGradientPreset,
  replaceDocumentGradientPreset,
} from './gradientPresets';
import { migrateDocumentDetailed, serializeDocument } from './version';

const rgb = (r: number, g = r, b = r) => ({ space: 'rgb' as const, r, g, b, a: 255 });

function preset(name: string, id: string, color: number) {
  return makeGradientPreset({
    id,
    name,
    colorStops: [
      { position: 0, color: rgb(0) },
      { position: 1, color: rgb(color) },
    ],
  });
}

describe('document-local preset helpers', () => {
  it('reads an empty list when absent', () => {
    expect(getDocumentGradientPresets({})).toEqual([]);
  });

  it('adds presets and merges content-identical duplicates', () => {
    const a = preset('A', 'gpreset-1', 10);
    const b = preset('B', 'gpreset-2', 200);
    const first = addGradientPresetsToDocument({}, [a]);
    expect(first.addedIds).toEqual(['gpreset-1']);
    // Same content, different id/name → merged, not appended.
    const dupe = makeGradientPreset({
      id: 'gpreset-3',
      name: 'A copy',
      colorStops: a.colorStops,
    });
    const second = addGradientPresetsToDocument(first.doc, [b, dupe]);
    expect(second.doc.gradientPresets).toHaveLength(2);
    expect(second.addedIds).toEqual(['gpreset-2']);
  });

  it('removes, renames, replaces, and finds presets', () => {
    const a = preset('A', 'gpreset-1', 10);
    const b = preset('B', 'gpreset-2', 200);
    const withBoth = addGradientPresetsToDocument(addGradientPresetsToDocument({}, [a]).doc, [
      b,
    ]).doc;

    const removed = removeGradientPresetsFromDocument(withBoth, ['gpreset-1']);
    expect(getDocumentGradientPresets(removed).map((p) => p.id)).toEqual(['gpreset-2']);

    const renamed = renameDocumentGradientPreset(removed, 'gpreset-2', 'Bee');
    expect(findDocumentGradientPreset(renamed, 'gpreset-2')?.name).toBe('Bee');

    const replaced = replaceDocumentGradientPreset(renamed, {
      ...preset('C', 'gpreset-2', 200),
      name: 'Cee',
    });
    expect(findDocumentGradientPreset(replaced, 'gpreset-2')?.name).toBe('Cee');
  });

  it('detects preset references from gradient-map adjustments', () => {
    const doc = createDocument('ref', true) as ReturnType<typeof createDocument> & {
      nodes: Record<string, unknown>;
    };
    const adjustment = makeAdjustment('adj-1', 'gradientMap') as {
      kind: string;
      presetId?: string;
      embeddedGradient?: { id: string };
    };
    adjustment.presetId = 'gpreset-1';
    (doc.nodes as Record<string, { kind?: string; adjustments?: unknown[] }>).n1 = {
      kind: 'adjustment',
      adjustments: [adjustment],
    };
    expect(gradientPresetIsReferenced(doc as never, 'gpreset-1')).toBe(true);
    expect(gradientPresetIsReferenced(doc as never, 'gpreset-2')).toBe(false);
  });
});

describe('2.10 -> 2.11 migration', () => {
  it('stamps gradientPresets on old documents', () => {
    const oldDoc = {
      formatVersion: '2.10',
      id: 'x',
      name: 'old',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    };
    const migrated = migrateDocumentDetailed(oldDoc);
    expect(migrated).not.toBeNull();
    const doc = migrated?.document as { formatVersion: string; gradientPresets: unknown[] };
    expect(doc.formatVersion).toBe('2.19');
    expect(doc.gradientPresets).toEqual([]);
  });

  it('preserves existing gradientPresets through encode/decode', () => {
    const base = createDocument('gd', true);
    const withPresets = addGradientPresetsToDocument(base, [
      preset('Saved', 'gpreset-saved', 200),
    ]).doc;
    const json = DocumentCodec.encode(withPresets as never);
    const decoded = DocumentCodec.decode(json);
    if (!decoded.ok) {
      throw new Error(`decode failed: ${decoded.error}`);
    }
    const reloaded = decoded.document as {
      formatVersion: string;
      gradientPresets: { id: string; name: string }[];
    };
    expect(reloaded.formatVersion).toBe('2.19');
    expect(reloaded.gradientPresets).toHaveLength(1);
    expect(reloaded.gradientPresets[0]!.id).toBe('gpreset-saved');
    expect(reloaded.gradientPresets[0]!.name).toBe('Saved');
  });

  it('serializes deterministically', () => {
    const base = createDocument('gd', true);
    const withPresets = addGradientPresetsToDocument(base, [
      preset('Saved', 'gpreset-saved', 200),
    ]).doc;
    const a = serializeDocument(withPresets as unknown as Record<string, unknown>);
    const b = serializeDocument(withPresets as unknown as Record<string, unknown>);
    expect(a).toBe(b);
  });
});
