import { describe, expect, it } from 'vitest';
import {
  CURRENT_DOCUMENT_VERSION,
  detectForwardCompatWarning,
  isForwardCompatible,
  migrateDocument,
  migrateDocumentDetailed,
  migrateDocumentJson,
  normalizeLegacyBackgroundRemoval,
  SUPPORTED_VERSIONS,
  serializeDocument,
  stampVersion,
} from './version';

describe('Document Versioning', () => {
  it('uses the native raster-mask schema version', () => {
    expect(CURRENT_DOCUMENT_VERSION).toBe('2.18');
    expect(SUPPORTED_VERSIONS).toContain('2.4');
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
  it('migrates v2.1 source fingerprints into honest metadata identities', () => {
    const migrated = migrateDocument({
      id: 'v21',
      name: 'v21',
      formatVersion: '2.1',
      rootChildren: ['image'],
      components: {},
      nextId: 1,
      nodes: {
        image: {
          id: 'image',
          kind: 'shape',
          mask: {
            type: 'alpha',
            visible: true,
            rasterMask: {
              assetId: 'mask',
              coordinateSpace: 'source-image-pixels',
              sourceFingerprint: 'source:asset/image.png',
              sourcePixelRevision: 4,
            },
          },
        },
      },
      rasterMaskAssets: {},
    })!;
    const rasterMask = (
      (migrated.nodes as Record<string, Record<string, unknown>>).image?.mask as Record<
        string,
        unknown
      >
    ).rasterMask as Record<string, unknown>;
    expect(migrated.formatVersion).toBe('2.18');
    expect(rasterMask.sourceIdentity).toEqual({
      kind: 'source-metadata',
      locator: 'asset/image.png',
      revision: 4,
    });
    expect(rasterMask).not.toHaveProperty('sourceFingerprint');
    expect(rasterMask).not.toHaveProperty('sourcePixelRevision');
  });

  it('preserves a verified v2.1 SHA-256 fingerprint as content identity', () => {
    const sha256 = 'a'.repeat(64);
    const migrated = migrateDocument({
      formatVersion: '2.1',
      nodes: {
        image: {
          mask: {
            rasterMask: {
              sourceFingerprint: `sha256:${sha256}`,
              sourcePixelRevision: 2,
            },
          },
        },
      },
    })!;
    const rasterMask = (
      (migrated.nodes as Record<string, Record<string, unknown>>).image?.mask as Record<
        string,
        unknown
      >
    ).rasterMask as Record<string, unknown>;

    expect(rasterMask.sourceIdentity).toEqual({
      kind: 'content-sha256',
      sha256,
      revision: 2,
    });
  });

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
                imageWidth: 1,
                imageHeight: 1,
              },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
          shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1 },
          strokes: [],
          effects: [],
          backgroundRemoval: {
            maskDataUrl:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
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

    expect(migrated.formatVersion).toBe('2.18');
    expect(mask.type).toBe('alpha');
    expect(mask.feather).toBe(2);
    expect(rasterMask.assetId).toBe('raster-mask:legacy:1');
    expect(rasterMask.provenance).toMatchObject({
      method: 'ai-quality',
      runtime: 'typescript',
      generatedAt: 1234,
      confidence: 0.91,
    });
    expect(assets['raster-mask:legacy:1']).toMatchObject({ width: 1, height: 1, byteLength: 68 });
    expect('backgroundRemoval' in image).toBe(false);
  });

  it('omits legacy backgroundRemoval when serializing a normalized document', () => {
    const doc = {
      id: 'd1',
      name: 'Legacy',
      formatVersion: '2.2',
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
    expect(JSON.parse(encoded).formatVersion).toBe('2.18');
  });

  it('suffixes colliding legacy asset IDs without breaking existing references', () => {
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const baseId = 'raster-mask:legacy:image';
    const migrated = normalizeLegacyBackgroundRemoval({
      nodes: {
        image: {
          id: 'image',
          kind: 'shape',
          shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1 },
          fills: [
            {
              type: 'image',
              image: { src: 'source', imageWidth: 1, imageHeight: 1 },
            },
          ],
          backgroundRemoval: {
            maskDataUrl: dataUrl,
            method: 'quick',
            confidence: 0.5,
            appliedAt: 1,
          },
        },
        consumer: {
          id: 'consumer',
          kind: 'shape',
          mask: {
            type: 'alpha',
            visible: true,
            rasterMask: {
              assetId: baseId,
              coordinateSpace: 'source-image-pixels',
              sourceIdentity: {
                kind: 'source-metadata',
                locator: 'existing',
                revision: 1,
              },
            },
          },
        },
      },
      rasterMaskAssets: {
        [baseId]: {
          id: baseId,
          mimeType: 'image/png',
          dataUrl,
          width: 1,
          height: 1,
          byteLength: 68,
          checksum: 'existing-semantic-asset',
        },
      },
    });
    const nodes = migrated.nodes as Record<string, Record<string, unknown>>;
    const assets = migrated.rasterMaskAssets as Record<string, Record<string, unknown>>;
    expect(
      ((nodes.image?.mask as Record<string, unknown>).rasterMask as Record<string, unknown>)
        .assetId,
    ).toBe(`${baseId}:1`);
    expect(
      ((nodes.consumer?.mask as Record<string, unknown>).rasterMask as Record<string, unknown>)
        .assetId,
    ).toBe(baseId);
    expect(assets[baseId]?.checksum).toBe('existing-semantic-asset');
    expect(assets[`${baseId}:1`]).toBeDefined();
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

  it('migrates v2.3 → v2.4: adds bitDepth and workingSpace to colorConfig', () => {
    const raw = {
      formatVersion: '2.3',
      colorConfig: {
        mode: 'cmyk',
        rgbProfile: { id: 'srgb', name: 'sRGB' },
        cmykProfile: { id: 'fogra39', name: 'Fogra39' },
        blackGeneration: { mode: 'standard', overprintBlack: false },
      },
    };
    const result = migrateDocument(raw);
    expect(result).not.toBeNull();
    const config = (result as Record<string, unknown>).colorConfig as Record<string, unknown>;
    expect(config.bitDepth).toBe('uint8');
    expect(config.workingSpace).toBe('srgb');
    // Existing fields preserved
    expect(config.mode).toBe('cmyk');
    expect((config.cmykProfile as Record<string, unknown>).id).toBe('fogra39');
  });

  it('migrates v2.3 → v2.5: full chain ends at latest version', () => {
    const raw = {
      formatVersion: '2.3',
      nodes: {},
    };
    const result = migrateDocument(raw);
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).formatVersion).toBe('2.18');
  });

  it('migrates v2.4 → v2.5: bakes rotation into transform', () => {
    const raw = {
      formatVersion: '2.4',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          rotation: 90,
          transform: [1, 0, 0, 1, 100, 200],
        },
        n2: {
          id: 'n2',
          kind: 'shape',
          rotation: 0,
          transform: [1, 0, 0, 1, 50, 50],
        },
      },
    };
    const result = migrateDocument(raw) as Record<string, unknown>;
    expect(result.formatVersion).toBe('2.18');
    const nodes = result.nodes as Record<string, Record<string, unknown>>;
    // n1: rotation 90 baked into transform
    expect(nodes.n1!.rotation).toBe(0);
    const t = nodes.n1!.transform as number[];
    // rotateDeg(90) * identity-ish transform with translation
    // cos(90) ≈ 0, sin(90) ≈ 1
    expect(t[0]).toBeCloseTo(0, 6); // a*cos + c*sin = 1*0 + 0*1 = 0
    expect(t[1]).toBeCloseTo(1, 6); // b*cos + d*sin = 0*0 + 1*1 = 1... wait
    expect(t[4]).toBeCloseTo(100, 6); // translation preserved
    expect(t[5]).toBeCloseTo(200, 6);
    // n2: zero rotation, transform unchanged
    expect(nodes.n2!.rotation).toBe(0);
    expect(nodes.n2!.transform).toEqual([1, 0, 0, 1, 50, 50]);
  });

  it('migrates v2.5 → v2.6: extracts embedded image fills into Document.assets', () => {
    const raw = {
      formatVersion: '2.5',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          fills: [{ type: 'image', image: { src: 'data:image/png;base64,AAAA', fit: 'fill' } }],
        },
      },
    };
    const result = migrateDocument(raw) as Record<string, unknown>;
    expect(result.formatVersion).toBe('2.18');
    const nodes = result.nodes as Record<string, Record<string, unknown>>;
    const fills = nodes.n1!.fills as Record<string, unknown>[];
    const image = fills[0]!.image as Record<string, unknown>;
    expect(typeof image.assetId).toBe('string');
    // src stays populated in-memory — only stripped at serialize time.
    expect(image.src).toBe('data:image/png;base64,AAAA');
    const assets = result.assets as Record<string, Record<string, unknown>>;
    expect(assets[image.assetId as string]?.dataUrl).toBe('data:image/png;base64,AAAA');
  });

  it('migrates v2.5 → v2.6: dedups identical image bytes across nodes into one asset', () => {
    const raw = {
      formatVersion: '2.5',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          fills: [{ type: 'image', image: { src: 'data:image/png;base64,SAME', fit: 'fill' } }],
        },
        n2: {
          id: 'n2',
          kind: 'shape',
          fills: [{ type: 'image', image: { src: 'data:image/png;base64,SAME', fit: 'fill' } }],
        },
      },
    };
    const result = migrateDocument(raw) as Record<string, unknown>;
    const nodes = result.nodes as Record<string, Record<string, unknown>>;
    const assetId1 = (
      (nodes.n1!.fills as Record<string, unknown>[])[0]!.image as Record<string, unknown>
    ).assetId;
    const assetId2 = (
      (nodes.n2!.fills as Record<string, unknown>[])[0]!.image as Record<string, unknown>
    ).assetId;
    expect(assetId1).toBe(assetId2);
    expect(Object.keys(result.assets as Record<string, unknown>)).toHaveLength(1);
  });

  it('rehydrates image fill src from Document.assets on load, even without a migration step', () => {
    const raw = {
      formatVersion: '2.6',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          fills: [{ type: 'image', image: { assetId: 'asset-1', src: '', fit: 'fill' } }],
        },
      },
      assets: {
        'asset-1': {
          id: 'asset-1',
          storage: 'embedded',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,REHYDRATED',
          naturalWidth: 10,
          naturalHeight: 10,
          byteLength: 4,
          hash: 'abc',
        },
      },
    };
    const result = migrateDocument(raw) as Record<string, unknown>;
    const nodes = result.nodes as Record<string, Record<string, unknown>>;
    const image = (nodes.n1!.fills as Record<string, unknown>[])[0]!.image as Record<
      string,
      unknown
    >;
    expect(image.src).toBe('data:image/png;base64,REHYDRATED');
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
    expect(doc.colorConfig).toEqual({
      bitDepth: 'uint8',
      workingSpace: 'srgb',
      mode: 'cmyk',
    });
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

  it('strips redundant embedded-asset src payloads from image fills on save', () => {
    const doc = {
      id: 'd1',
      name: 'test',
      rootChildren: ['n1'],
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          fills: [
            {
              type: 'image',
              image: { assetId: 'asset-1', src: 'data:image/png;base64,DUPLICATED', fit: 'fill' },
            },
          ],
        },
      },
      assets: {
        'asset-1': {
          id: 'asset-1',
          storage: 'embedded',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,DUPLICATED',
          naturalWidth: 10,
          naturalHeight: 10,
          byteLength: 4,
          hash: 'abc',
        },
      },
    };
    const json = serializeDocument(doc);
    // The canonical copy in the asset table survives...
    expect(json).toContain('data:image/png;base64,DUPLICATED');
    const parsed = JSON.parse(json);
    // ...but the per-fill duplicate does not: src is gone from the fill.
    expect(parsed.nodes.n1.fills[0].image.src).toBeUndefined();
    expect(parsed.assets['asset-1'].dataUrl).toBe('data:image/png;base64,DUPLICATED');
    // Occurs exactly once in the whole payload — proof of dedup, not just omission.
    expect(json.split('DUPLICATED').length - 1).toBe(1);
  });

  it('leaves src alone for image fills with no assetId (legacy/unmigrated)', () => {
    const doc = {
      id: 'd1',
      name: 'test',
      rootChildren: ['n1'],
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          fills: [{ type: 'image', image: { src: 'data:image/png;base64,LEGACY', fit: 'fill' } }],
        },
      },
    };
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json);
    expect(parsed.nodes.n1.fills[0].image.src).toBe('data:image/png;base64,LEGACY');
  });

  it('preserves src when it has drifted from the referenced asset (safety net)', () => {
    const doc = {
      id: 'd1',
      name: 'test',
      rootChildren: ['n1'],
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          fills: [
            {
              type: 'image',
              image: { assetId: 'asset-1', src: 'data:image/png;base64,DRIFTED', fit: 'fill' },
            },
          ],
        },
      },
      assets: {
        'asset-1': {
          id: 'asset-1',
          storage: 'embedded',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,CANONICAL',
          naturalWidth: 10,
          naturalHeight: 10,
          byteLength: 4,
          hash: 'abc',
        },
      },
    };
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json);
    // Never silently discard data that doesn't match the asset table.
    expect(parsed.nodes.n1.fills[0].image.src).toBe('data:image/png;base64,DRIFTED');
  });
});

describe('v2.7 migration (image crop + transform fields)', () => {
  it('stamps v2.7 on migrated documents', () => {
    const migrated = migrateDocument({
      formatVersion: '2.6',
      nodes: {},
    });
    expect(migrated!.formatVersion).toBe('2.18');
  });

  it('normalizes an out-of-bounds crop rect', () => {
    const migrated = migrateDocument({
      formatVersion: '2.6',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fills: [
            {
              type: 'image',
              image: {
                src: 'data:image/png;base64,AA',
                fit: 'fill',
                x: 0,
                y: 0,
                scale: 1,
                imageWidth: 200,
                imageHeight: 200,
                crop: { x: -10, y: -10, w: 300, h: 300 },
              },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
        },
      },
    });
    const fill = (
      migrated!.nodes as Record<string, { fills: Array<{ image?: Record<string, unknown> }> }>
    ).n1!.fills[0]!.image as Record<string, unknown>;
    // Crop should be clamped to source dimensions → full image → normalized to undefined
    expect(fill.crop).toBeUndefined();
  });

  it('removes a crop that covers the full source', () => {
    const migrated = migrateDocument({
      formatVersion: '2.6',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fills: [
            {
              type: 'image',
              image: {
                src: 'data:image/png;base64,AA',
                fit: 'fill',
                x: 0,
                y: 0,
                scale: 1,
                imageWidth: 200,
                imageHeight: 200,
                crop: { x: 0, y: 0, w: 200, h: 200 },
              },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
        },
      },
    });
    const fill = (
      migrated!.nodes as Record<string, { fills: Array<{ image?: Record<string, unknown> }> }>
    ).n1!.fills[0]!.image as Record<string, unknown>;
    expect(fill.crop).toBeUndefined();
  });

  it('normalizes rotation to [0, 360)', () => {
    const migrated = migrateDocument({
      formatVersion: '2.6',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fills: [
            {
              type: 'image',
              image: {
                src: 'data:image/png;base64,AA',
                fit: 'fill',
                x: 0,
                y: 0,
                scale: 1,
                rotation: -90,
              },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
        },
      },
    });
    const fill = (
      migrated!.nodes as Record<string, { fills: Array<{ image?: Record<string, unknown> }> }>
    ).n1!.fills[0]!.image as Record<string, unknown>;
    expect(fill.rotation).toBe(270);
  });

  it('leaves valid crop/rotation/flip unchanged', () => {
    const migrated = migrateDocument({
      formatVersion: '2.6',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fills: [
            {
              type: 'image',
              image: {
                src: 'data:image/png;base64,AA',
                fit: 'fill',
                x: 0,
                y: 0,
                scale: 1,
                imageWidth: 200,
                imageHeight: 200,
                crop: { x: 10, y: 20, w: 50, h: 60 },
                rotation: 45,
                flipH: true,
              },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
        },
      },
    });
    const fill = (
      migrated!.nodes as Record<string, { fills: Array<{ image?: Record<string, unknown> }> }>
    ).n1!.fills[0]!.image as Record<string, unknown>;
    expect(fill.crop).toEqual({ x: 10, y: 20, w: 50, h: 60 });
    expect(fill.rotation).toBe(45);
    expect(fill.flipH).toBe(true);
  });
});

describe('v2.13 migration (glyph-level typography)', () => {
  it('normalizes kerningMode to auto for unknown values', () => {
    const raw = {
      formatVersion: '2.12',
      nodes: {
        n1: { id: 'n1', kind: 'text', text: 'Hi', kerningMode: 'optical' },
      },
    };
    const result = migrateDocument(raw) as Record<string, unknown>;
    const nodes = result.nodes as Record<string, Record<string, unknown>>;
    expect(nodes.n1!.kerningMode).toBe('auto');
  });

  it('keeps valid kerningMode values', () => {
    const raw = {
      formatVersion: '2.12',
      nodes: {
        n1: { id: 'n1', kind: 'text', text: 'Hi', kerningMode: 'none' },
      },
    };
    const result = migrateDocument(raw) as Record<string, unknown>;
    const nodes = result.nodes as Record<string, Record<string, unknown>>;
    expect(nodes.n1!.kerningMode).toBe('none');
  });

  it('drops malformed glyph adjustment entries and keeps valid ones', () => {
    const raw = {
      formatVersion: '2.12',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'text',
          text: 'Hi',
          glyphAdjustments: {
            0: { dx: 1, dy: 2, advance: 3, rotation: 0, scaleX: 1, scaleY: 1 },
            1: { dx: 'nope' },
            2: null,
          },
        },
      },
    };
    const result = migrateDocument(raw) as Record<string, unknown>;
    const nodes = result.nodes as Record<string, Record<string, unknown>>;
    const glyphs = nodes.n1!.glyphAdjustments as Record<string, unknown>;
    expect(Object.keys(glyphs)).toEqual(['0']);
    expect(glyphs['0']).toEqual({ dx: 1, dy: 2, advance: 3, rotation: 0, scaleX: 1, scaleY: 1 });
  });

  it('drops non-numeric pair adjustments', () => {
    const raw = {
      formatVersion: '2.12',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'text',
          text: 'Hi',
          pairAdjustments: { 0: 4, 1: 'x', 2: NaN },
        },
      },
    };
    const result = migrateDocument(raw) as Record<string, unknown>;
    const nodes = result.nodes as Record<string, Record<string, unknown>>;
    const pairs = nodes.n1!.pairAdjustments as Record<string, unknown>;
    expect(Object.keys(pairs)).toEqual(['0']);
    expect(pairs['0']).toBe(4);
  });

  it('leaves non-text nodes untouched', () => {
    const raw = {
      formatVersion: '2.12',
      nodes: {
        n1: { id: 'n1', kind: 'shape', kerningMode: 'bogus' },
      },
    };
    const result = migrateDocument(raw) as Record<string, unknown>;
    const nodes = result.nodes as Record<string, Record<string, unknown>>;
    expect(nodes.n1!.kerningMode).toBe('bogus');
  });
});

describe('v2.16 trace metadata', () => {
  it('preserves traceMetadata through migration and serialization', () => {
    const traceMetadata = {
      schemaVersion: 1,
      sourceNodeId: 'img-1',
      mode: 'pixel-art',
      traceMode: 'silhouette',
      threshold: 128,
      foreground: 'dark',
      alphaThreshold: 1,
      minArea: 1,
      simplifyTolerance: 0,
      maxPaths: 1000,
      maxColors: 16,
      compoundHoles: true,
      cornerAngle: 135,
      centerlineWidth: 2,
      centerlinePrune: 4,
      engine: 'native',
      stats: { pathCount: 3, pointCount: 24, holeCount: 1, omittedHoles: 0 },
      createdAt: 1234,
    };
    const doc = {
      formatVersion: '2.15',
      nodes: {
        g1: { id: 'g1', kind: 'group', traceMetadata, children: [] },
      },
    };
    const migrated = migrateDocument(doc);
    const group = (migrated?.nodes as Record<string, { traceMetadata?: unknown }>)?.g1;
    expect(migrated?.formatVersion).toBe('2.18');
    expect(group?.traceMetadata).toEqual(traceMetadata);
    expect(JSON.parse(serializeDocument(migrated ?? {})).formatVersion).toBe('2.18');
  });
});
