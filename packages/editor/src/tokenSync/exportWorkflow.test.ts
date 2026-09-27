/**
 * Export fidelity tests (scenario D): descriptions, deprecation, nested
 * groups, $root, aliases, JSON Pointer references, unknown vendor
 * extensions, and hex-string colors must survive import → export, and the
 * output must re-parse clean under the strict 2025.10 parser.
 */

import { createDocument } from '@varve/scene';
import { createEmptyTokenSynchronization } from '@varve/scene/tokens';
import { parseFormatDocument } from '@varve/tokens';
import { describe, expect, it } from 'vitest';
import { exportTokensToDtcg } from './exportWorkflow';
import { buildImportPreview, NEW_SOURCE_OPTION, planDocumentImport } from './importWorkflow';

const SOURCE = JSON.stringify(
  {
    color: {
      $description: 'Color foundation',
      $extensions: { 'org.example.design': { scale: 12 } },
      brand: {
        $root: {
          $type: 'color',
          $value: { colorSpace: 'srgb', components: [0, 0.4, 0.8] },
          $description: 'The brand color',
        },
        primary: {
          $type: 'color',
          $value: '{color.brand.$root}',
          $deprecated: 'Use {color.brand.$root} instead.',
        },
        raw: { $type: 'color', $value: '#ff00ff' },
        pointer: { $ref: '#/color/brand/primary/$value' },
        vendor: {
          $type: 'color',
          $value: { colorSpace: 'srgb', components: [1, 0, 0] },
          $extensions: { 'org.example.tool': { role: 'danger' } },
        },
      },
    },
    spacing: {
      $type: 'dimension',
      $root: { $value: { value: 16, unit: 'px' } },
      gap: { $value: { value: 8, unit: 'px' }, $description: 'Default gap' },
    },
  },
  null,
  2,
);

function importSource(text = SOURCE, fileName = 'brand.tokens.json') {
  const doc = createDocument('Round Trip');
  const preview = buildImportPreview(
    text,
    { name: fileName, size: text.length, lastModified: 1 },
    undefined,
  );
  expect(preview.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const plan = planDocumentImport(doc, preview, NEW_SOURCE_OPTION);
  expect(plan).not.toBeNull();
  expect(plan?.imported).toBeGreaterThan(0);
  return { plan, sync: plan?.variableStore.tokenSync };
}

describe('exportTokensToDtcg', () => {
  it('exports prototype-like path segments and group metadata without polluting objects', () => {
    const sync = createEmptyTokenSynchronization();
    const records = [
      {
        id: 'tok_proto',
        path: ['__proto__', 'child'],
        displayName: 'child',
        type: 'number',
        value: 1,
        extensions: {},
        localState: {
          createdLocally: true,
          detachedFromSource: false,
          locallyModified: false,
          unresolved: false,
          conflicted: false,
        },
      },
      {
        id: 'tok_constructor',
        path: ['constructor', 'child'],
        displayName: 'child',
        type: 'number',
        value: 2,
        extensions: {},
        localState: {
          createdLocally: true,
          detachedFromSource: false,
          locallyModified: false,
          unresolved: false,
          conflicted: false,
        },
      },
      {
        id: 'tok_to_string',
        path: ['toString', 'child'],
        displayName: 'child',
        type: 'number',
        value: 3,
        extensions: {},
        localState: {
          createdLocally: true,
          detachedFromSource: false,
          locallyModified: false,
          unresolved: false,
          conflicted: false,
        },
      },
    ];
    const tokens = Object.create(null) as typeof sync.store.tokens;
    for (const record of records) {
      Object.defineProperty(tokens, record.id, {
        configurable: true,
        enumerable: true,
        value: record,
        writable: true,
      });
    }
    const groupMeta = Object.create(null) as NonNullable<typeof sync.store.groupMeta>;
    Object.defineProperty(groupMeta, '__proto__', {
      configurable: true,
      enumerable: true,
      value: { description: 'Safe group', extensions: {} },
      writable: true,
    });
    sync.store = { ...sync.store, tokens, groupMeta };

    expect(({} as Record<string, unknown>).child).toBeUndefined();
    const result = exportTokensToDtcg(sync);
    const reparsed = parseFormatDocument(result.text);

    expect(result.tokenCount).toBe(3);
    expect(reparsed.tokens['__proto__.child']?.value).toBe(1);
    expect(reparsed.tokens['constructor.child']?.value).toBe(2);
    expect(reparsed.tokens['toString.child']?.value).toBe(3);
    expect(reparsed.groups[0]?.description).toBe('Safe group');
    expect(({} as Record<string, unknown>).child).toBeUndefined();
  });

  it('round-trips descriptions, deprecation, extensions, $root, and references', () => {
    const { sync } = importSource();
    const result = exportTokensToDtcg(sync);

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.tokenCount).toBe(7);

    const reparsed = parseFormatDocument(result.text, { sourceFileId: 'exported.tokens.json' });
    expect(reparsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    // The only warning is the deliberate hex-string notice for the authored
    // `#ff00ff` value, which is preserved rather than converted.
    expect(reparsed.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.code)).toEqual(
      ['codec.color.hex-string-form'],
    );

    expect(reparsed.tokens['color.brand.$root']?.description).toBe('The brand color');
    expect(reparsed.tokens['color.brand.primary']?.deprecated).toBe(
      'Use {color.brand.$root} instead.',
    );
    expect(reparsed.tokens['color.brand.primary']?.value).toBe('{color.brand.$root}');
    expect(reparsed.tokens['color.brand.raw']?.value).toBe('#ff00ff');
    expect(reparsed.tokens['spacing.gap']?.description).toBe('Default gap');
    expect(reparsed.tokens['spacing.$root']?.value).toEqual({ value: 16, unit: 'px' });
    expect(reparsed.tokens['color.brand.vendor']?.extensions).toEqual({
      'org.example.tool': { role: 'danger' },
    });

    // Group metadata survives the round trip.
    expect(reparsed.groups.find((g) => g.name === 'color')?.description).toBe('Color foundation');
    expect(reparsed.groups.find((g) => g.name === 'color')?.extensions).toEqual({
      'org.example.design': { scale: 12 },
    });
  });

  it('is deterministic regardless of store insertion order', () => {
    const a = importSource();
    const b = importSource();
    // Rebuild the second store by inserting in a different order.
    const reversed = Object.fromEntries(Object.entries(b.sync?.store.tokens ?? {}).reverse());
    if (b.sync) b.sync.store.tokens = reversed;
    expect(exportTokensToDtcg(b.sync).text).toBe(exportTokensToDtcg(a.sync).text);
    expect(exportTokensToDtcg(a.sync).text).toBe(exportTokensToDtcg(a.sync).text);
  });

  it('omits $type on pure references so the target stays authoritative', () => {
    const { sync } = importSource();
    const exported = exportTokensToDtcg(sync).text;
    const parsed = JSON.parse(exported) as {
      color?: { brand?: Record<string, unknown> };
    };
    const brand = parsed.color?.brand;
    const primary = brand?.primary as Record<string, unknown>;
    expect(primary.$value).toBe('{color.brand.$root}');
    expect(primary.$type).toBeUndefined();
    const root = brand?.$root as Record<string, unknown>;
    expect(root.$type).toBe('color');
  });

  it('warns about hex-string colors without converting them', () => {
    const { sync } = importSource();
    const result = exportTokensToDtcg(sync);
    expect(result.diagnostics.some((d) => d.code === 'export.hex-string-colors')).toBe(true);
    expect(result.text).toContain('"#ff00ff"');
  });

  it('reports tokens with names the format forbids instead of emitting them', () => {
    const sync = createEmptyTokenSynchronization();
    sync.store.tokens = {
      tok_bad: {
        id: 'tok_bad',
        path: ['bad.name'],
        displayName: 'bad.name',
        type: 'number',
        value: 1,
        extensions: {},
        localState: {
          createdLocally: true,
          detachedFromSource: false,
          locallyModified: false,
          unresolved: false,
          conflicted: false,
        },
      },
    };
    const result = exportTokensToDtcg(sync);
    expect(result.tokenCount).toBe(0);
    expect(result.diagnostics.some((d) => d.code === 'export.invalid-name')).toBe(true);
  });

  it('refuses to export an empty store with an explanation', () => {
    const result = exportTokensToDtcg(undefined);
    expect(result.tokenCount).toBe(0);
    expect(result.text).toBe('');
    expect(result.diagnostics[0]?.code).toBe('export.empty');
  });

  it('reports non-2025.10 types it preserved', () => {
    const sync = createEmptyTokenSynchronization();
    sync.store.tokens = {
      tok_v: {
        id: 'tok_v',
        path: ['vendor', 'thing'],
        displayName: 'thing',
        type: 'vendorType',
        value: 'x',
        extensions: {},
        localState: {
          createdLocally: true,
          detachedFromSource: false,
          locallyModified: false,
          unresolved: false,
          conflicted: false,
        },
      },
    };
    const result = exportTokensToDtcg(sync);
    expect(result.diagnostics.some((d) => d.code === 'export.nonstandard-types')).toBe(true);
    expect(result.text).toContain('"vendorType"');
  });
});
