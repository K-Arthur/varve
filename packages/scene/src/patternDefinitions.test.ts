import {
  addNode,
  createDocument,
  createEmbeddedAsset,
  createPatternDefinitionFromSelection,
  imageFill,
  isAssetReferenced,
  makeFrameNode,
  makePatternDefinitionUnique,
  makeShapeNode,
  patternFill,
  patternFillForDefinition,
  pruneUnusedAssets,
  updatePatternDefinition,
  validatePatternDefinitionDependencies,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { DocumentCodec } from './documentCodec';
import type { PatternDefinition } from './types';

function shape(id: string, x: number, y: number) {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: 20, h: 12 },
    {
      name: id,
      transform: [1, 0, 0, 1, x, y],
    },
  );
}

describe('editable pattern definitions', () => {
  it('keeps a source preview valid when only repeat settings change', () => {
    const definition = {
      ...emptyDefinition('pattern-cache'),
      previewSrc: 'data:image/svg+xml;base64,PHN2Zz4=',
      previewRevision: 1,
    };
    const doc = {
      ...createDocument('Cached', true),
      patternDefinitions: { [definition.id]: definition },
    };
    const updated = updatePatternDefinition(doc, definition.id, (current) => ({
      ...current,
      repeat: { ...current.repeat, arrangement: 'brick', rowShift: 0.5 },
    }));
    const next = updated.patternDefinitions?.[definition.id];
    expect(next?.revision).toBe(2);
    expect(next?.previewSrc).toBe(definition.previewSrc);
    expect(next?.previewRevision).toBe(next?.revision);
  });

  it('invalidates vector source previews when the repeat lattice changes', () => {
    const artwork = shape('lattice-motif', 0, 0);
    const sourceDoc = addNode(createDocument('Vector cache', true), artwork);
    const created = createPatternDefinitionFromSelection(sourceDoc, [artwork.id], {
      id: 'vector-cache',
    });
    const definition = {
      ...created.definition,
      previewSrc: 'data:image/svg+xml;base64,PHN2Zz4=',
      previewRevision: 1,
    };
    const doc = {
      ...created.document,
      patternDefinitions: { [definition.id]: definition },
    };

    const updated = updatePatternDefinition(doc, definition.id, (current) => ({
      ...current,
      repeat: { ...current.repeat, arrangement: 'brick', rowShift: 0.5 },
    }));

    const next = updated.patternDefinitions?.[definition.id];
    expect(next?.revision).toBe(2);
    expect(next?.previewSrc).toBeUndefined();
    expect(next?.previewRevision).toBeUndefined();
  });

  it('copies selected vector artwork into a private mini-scene and leaves the originals intact', () => {
    const first = shape('source-a', 40, 30);
    const second = shape('source-b', 72, 30);
    let doc = addNode(createDocument('Source', true), first);
    doc = addNode(doc, second);

    const result = createPatternDefinitionFromSelection(doc, [first.id, second.id], {
      id: 'pattern-botanical',
      name: 'Botanical',
    });

    expect(result.document.nodes[first.id]).toEqual(doc.nodes[first.id]);
    expect(result.document.nodes[second.id]).toEqual(doc.nodes[second.id]);
    expect(result.document.rootChildren).toEqual(doc.rootChildren);
    expect(result.definition.source.kind).toBe('vector');
    if (result.definition.source.kind !== 'vector') throw new Error('expected vector source');
    expect(result.definition.source.rootIds).toHaveLength(2);
    expect(Object.keys(result.definition.source.nodes)).toHaveLength(2);
    expect(result.definition.cell).toEqual({ x: 0, y: 0, width: 52, height: 12 });
    expect(result.document.patternDefinitions?.[result.definition.id]).toEqual(result.definition);
    expect(result.document.nextId).toBeGreaterThan(doc.nextId);
  });

  it('keeps application placement on each fill while sharing the definition source', () => {
    const definition: PatternDefinition = {
      id: 'pattern-1',
      name: 'Grid',
      revision: 1,
      cell: { x: 0, y: 0, width: 20, height: 12 },
      repeat: {
        arrangement: 'grid',
        gapX: 0,
        gapY: 0,
        rowShift: 0,
        mirrorX: false,
        mirrorY: false,
        originX: 0,
        originY: 0,
      },
      source: {
        kind: 'procedural',
        recipe: {
          type: 'checkerboard',
          tileWidth: 20,
          tileHeight: 12,
          color1: '#fff',
          color2: '#000',
          seed: 0,
        },
      },
      previewSrc: 'data:image/png;base64,AAA=',
      previewRevision: 1,
    };

    const fill = patternFillForDefinition(definition, { offsetX: -2.5, rotation: 15 });

    expect(fill.definitionId).toBe(definition.id);
    expect(fill.tileSrc).toBe(definition.previewSrc);
    expect(fill.offsetX).toBe(-2.5);
    expect(fill.rotation).toBe(15);
    expect(fill.imageWidth).toBeUndefined();
    expect(fill.imageHeight).toBeUndefined();
  });

  it('saves and reopens a reusable raster source with its embedded bytes', () => {
    const tile =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const asset = createEmbeddedAsset({
      dataUrl: tile,
      mimeType: 'image/png',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    const definition = emptyDefinition('pattern-raster');
    definition.source = { kind: 'raster', assetId: asset.id, width: 1, height: 1 };
    const node = {
      ...shape('patterned-shape', 0, 0),
      fills: [patternFill(tile, { definitionId: definition.id })],
    };
    const doc = {
      ...addNode(createDocument('Portable pattern', true), node),
      assets: { [asset.id]: asset },
      patternDefinitions: { [definition.id]: definition },
    };

    const reopened = DocumentCodec.decode(DocumentCodec.encode(doc));

    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.document.patternDefinitions?.[definition.id]?.source).toEqual(
      definition.source,
    );
    expect(reopened.document.assets?.[asset.id]?.dataUrl).toBe(tile);
    expect(reopened.document.nodes[node.id]?.fills?.[0]).toMatchObject({
      type: 'pattern',
      pattern: { definitionId: definition.id },
    });
  });

  it('keeps a vector source image portable through the codec and node closure', () => {
    const tile =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const asset = createEmbeddedAsset({
      dataUrl: tile,
      mimeType: 'image/png',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    const definition = emptyDefinition('vector-with-image');
    const motif = {
      ...shape('motif', 0, 0),
      fills: [imageFill(tile, { assetId: asset.id, imageWidth: 1, imageHeight: 1 })],
    };
    definition.source = {
      kind: 'vector',
      rootIds: [motif.id],
      nodes: { [motif.id]: motif },
      assetIds: [asset.id],
      styleIds: [],
      componentIds: [],
    };
    const applied = {
      ...shape('applied', 0, 0),
      fills: [patternFill('', { definitionId: definition.id })],
    };
    const doc = {
      ...addNode(createDocument('Portable vector pattern', true), applied),
      assets: { [asset.id]: asset },
      patternDefinitions: { [definition.id]: definition },
    };

    const closure = DocumentCodec.collectNodeClosure(doc, [applied.id]);
    expect(closure.patternDefinitions?.[definition.id]).toEqual(definition);
    expect(closure.assets?.[asset.id]).toEqual(asset);
    expect(isAssetReferenced(doc, asset.id)).toBe(true);
    expect(pruneUnusedAssets(doc).assets?.[asset.id]).toEqual(asset);

    const encoded = DocumentCodec.encode(doc);
    const stored = JSON.parse(encoded) as typeof doc;
    const storedSource = stored.patternDefinitions[definition.id]?.source;
    if (storedSource?.kind !== 'vector') throw new Error('expected stored vector source');
    expect(storedSource.nodes[motif.id]?.fills?.[0]?.image?.src).toBeUndefined();

    const reopened = DocumentCodec.decode(encoded);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const source = reopened.document.patternDefinitions?.[definition.id]?.source;
    if (source?.kind !== 'vector') throw new Error('expected reopened vector source');
    expect(source.nodes[motif.id]?.fills?.[0]?.image?.src).toBe(tile);
    expect(reopened.document.assets?.[asset.id]?.dataUrl).toBe(tile);
  });

  it('makes an independent definition copy with remapped source node IDs', () => {
    const first = shape('source-a', 0, 0);
    const doc = addNode(createDocument('Source', true), first);
    const created = createPatternDefinitionFromSelection(doc, [first.id], {
      id: 'pattern-original',
      name: 'Original',
    });

    const unique = makePatternDefinitionUnique(created.document, 'pattern-original', {
      id: 'pattern-unique',
    });

    expect(unique.definition.id).toBe('pattern-unique');
    expect(unique.definition.source).not.toBe(created.definition.source);
    if (unique.definition.source.kind !== 'vector' || created.definition.source.kind !== 'vector') {
      throw new Error('expected vector sources');
    }
    expect(unique.definition.source.rootIds[0]).not.toBe(created.definition.source.rootIds[0]);
    expect(unique.document.nodes[first.id]).toEqual(created.document.nodes[first.id]);
  });

  it('rejects recursive definition dependencies before the renderer sees them', () => {
    const cyclic = {
      a: { ...emptyDefinition('a'), dependencyPatternIds: ['b'] },
      b: { ...emptyDefinition('b'), dependencyPatternIds: ['a'] },
    } satisfies Record<string, PatternDefinition>;

    expect(validatePatternDefinitionDependencies(cyclic)).toEqual([
      expect.stringContaining('a → b → a'),
    ]);
  });

  it('finds recursion in vector source fills even when dependency metadata is absent', () => {
    const a = emptyDefinition('a');
    const b = emptyDefinition('b');
    a.source = {
      kind: 'vector',
      rootIds: ['a-motif'],
      nodes: {
        'a-motif': {
          ...shape('a-motif', 0, 0),
          fills: [patternFill('', { definitionId: 'b' })],
        },
      },
      assetIds: [],
      styleIds: [],
      componentIds: [],
    };
    b.source = {
      kind: 'vector',
      rootIds: ['b-motif'],
      nodes: {
        'b-motif': {
          ...shape('b-motif', 0, 0),
          fills: [patternFill('', { definitionId: 'a' })],
        },
      },
      assetIds: [],
      styleIds: [],
      componentIds: [],
    };
    const definitions = { a, b };
    expect(validatePatternDefinitionDependencies(definitions)).toEqual([
      expect.stringContaining('a → b → a'),
    ]);
    const doc = { ...createDocument('Recursive pattern', true), patternDefinitions: definitions };
    expect(() => DocumentCodec.encode(doc)).toThrow('Recursive pattern dependency');
    const reopened = DocumentCodec.decode(JSON.stringify(doc));
    expect(reopened.ok).toBe(false);
    if (!reopened.ok) {
      expect(reopened.warnings).toEqual([
        expect.objectContaining({ code: 'document.invalid-pattern-dependency', severity: 'error' }),
      ]);
    }
  });

  it('rejects dependency chains deeper than the supported bound', () => {
    const definitions = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => {
        const definition = emptyDefinition(`pattern-${index}`);
        definition.dependencyPatternIds = index < 16 ? [`pattern-${index + 1}`] : [];
        return [definition.id, definition];
      }),
    );
    expect(validatePatternDefinitionDependencies(definitions)).toEqual([
      expect.stringContaining('depth exceeds 16'),
    ]);
    const doc = { ...createDocument('Too-deep pattern', true), patternDefinitions: definitions };
    const reopened = DocumentCodec.decode(JSON.stringify(doc));
    expect(reopened.ok).toBe(false);
    if (!reopened.ok) expect(reopened.error).toContain('depth exceeds 16');
  });

  it('rejects a pattern that reaches itself through a component master', () => {
    const definition = emptyDefinition('component-pattern');
    definition.source = {
      kind: 'vector',
      rootIds: ['instance'],
      nodes: {
        instance: makeFrameNode('instance', {
          componentId: 'motif-component',
          w: 20,
          h: 12,
        }),
      },
      assetIds: [],
      styleIds: [],
      componentIds: ['motif-component'],
    };
    const master = {
      ...shape('master', 0, 0),
      fills: [patternFill('', { definitionId: definition.id })],
    };
    const doc = {
      ...createDocument('Component recursion', true),
      nodes: { master },
      components: {
        'motif-component': {
          id: 'motif-component',
          name: 'Motif component',
          masterRootId: 'master',
          slots: [],
        },
      },
      patternDefinitions: { [definition.id]: definition },
    };
    expect(validatePatternDefinitionDependencies(doc.patternDefinitions, doc)).toEqual([
      expect.stringContaining('component-pattern → component-pattern'),
    ]);
    expect(DocumentCodec.decode(JSON.stringify(doc)).ok).toBe(false);
  });
});

function emptyDefinition(id: string): PatternDefinition {
  return {
    id,
    name: id,
    revision: 1,
    cell: { x: 0, y: 0, width: 10, height: 10 },
    repeat: {
      arrangement: 'grid',
      gapX: 0,
      gapY: 0,
      rowShift: 0,
      mirrorX: false,
      mirrorY: false,
      originX: 0,
      originY: 0,
    },
    source: { kind: 'raster', assetId: 'asset-1', width: 10, height: 10 },
  };
}
