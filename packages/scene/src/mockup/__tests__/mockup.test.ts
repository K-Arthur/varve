import { describe, expect, it } from 'vitest';
import { pruneUnusedAssets } from '../../assets';
import type { Document } from '../../document';
import { createDocument, makeFrameNode, nextNodeId } from '../../document';
import { DocumentCodec } from '../../documentCodec';
import type { FrameNode } from '../../types';
import { canBindMockupSource } from '../binding';
import { getBuiltinMockupTemplates } from '../builtinTemplates';
import { classifyMockupIntent, validateMockupRequest } from '../multimodal';
import { sanitizeMockupState } from '../normalize';
import {
  addMockupTemplate,
  applyMockupTemplateRemap,
  buildTemplateFromJson,
  clearMockup,
  computeMockupSourceDigest,
  createMockupInstanceData,
  isMockupFrame,
  makeMockupTemplateUnique,
  markMockupDetached,
  planMockupTemplateRemap,
  pruneUnusedMockupTemplates,
  setMockupBinding,
  setMockupSurfaceOverride,
  setMockupTemplate,
} from '../ops';
import { validateTemplate } from '../validate';

function frameWithMockup(doc: Document, templateId: string, nodeId: string): Document {
  const frame = doc.nodes[nodeId] as FrameNode;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: { ...frame, mockup: createMockupInstanceData(templateId, {}) },
    },
  };
}

function fixtureDoc(): { doc: Document; frameId: string; sourceId: string } {
  let doc = createDocument('mockup-fixture', { flat: true });
  const f = nextNodeId(doc);
  doc = f.doc;
  const frameId = f.id;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [frameId]: makeFrameNode(frameId, { transform: [1, 0, 0, 1, 0, 0], w: 300, h: 500 }),
    },
    rootChildren: [...doc.rootChildren, frameId],
  };
  const s = nextNodeId(doc);
  doc = s.doc;
  const sourceId = s.id;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [sourceId]: makeFrameNode(sourceId, { transform: [1, 0, 0, 1, 400, 0], w: 300, h: 500 }),
    },
    rootChildren: [...doc.rootChildren, sourceId],
  };
  return { doc, frameId, sourceId };
}

describe('mockup templates', () => {
  it('builtin catalog is valid and has stable ids', () => {
    const templates = getBuiltinMockupTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(10);
    const ids = new Set(templates.map((t) => t.id));
    expect(ids.size).toBe(templates.length);
    for (const t of templates) {
      const result = validateTemplate(t);
      expect(result.ok, `${t.id}: ${result.errors.join('; ')}`).toBe(true);
      expect(result.warnings, `${t.id}: ${result.warnings.join('; ')}`).toEqual([]);
      expect(t.contentHash).toBeTruthy();
      expect(t.licence?.spdx).toBe('FSL-1.1-MIT');
      expect(t.capabilities).toBeTruthy();
    }
  });

  it('deduplicates identical templates by content hash', () => {
    const { doc } = fixtureDoc();
    const template = getBuiltinMockupTemplates()[0]!;
    const first = addMockupTemplate(doc, template);
    const second = addMockupTemplate(first.document, template);
    expect(second.templateId).toBe(first.templateId);
    expect(Object.keys(second.document.mockupTemplates ?? {})).toHaveLength(1);
  });

  it('rejects invalid templates', () => {
    const perspective = getBuiltinMockupTemplates().find(
      (t) => t.id === 'builtin:phone-perspective',
    )!;
    const invalid = {
      ...perspective,
      surfaces: [
        {
          ...perspective.surfaces[0],
          quad: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
            { x: 100, y: 0 },
            { x: 0, y: 100 },
          ],
        },
      ],
    };
    const result = validateTemplate(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('quad'))).toBe(true);
  });

  it('rejects reserved surface kinds, displacement, and luminance masks; accepts raster clip masks', () => {
    const [template] = getBuiltinMockupTemplates();
    const mesh = { ...template!, surfaces: [{ ...template!.surfaces[0], kind: 'mesh' }] };
    expect(validateTemplate(mesh).ok).toBe(false);

    // Clip/occlusion coverage is implemented (alpha only); a well-formed
    // reference passes structural validation. Asset existence is checked at
    // load time against the document asset table.
    const withMask = {
      ...template!,
      surfaces: [
        {
          ...template!.surfaces[0],
          clipMaskAssetId: 'asset-1',
          occlusionMaskAssetId: 'asset-2',
          maskOptions: { feather: 4, invert: true },
        },
      ],
    };
    expect(validateTemplate(withMask).ok).toBe(true);

    // Luminance coverage and displacement maps have no renderer path yet.
    const withLuminance = {
      ...template!,
      surfaces: [
        {
          ...template!.surfaces[0],
          clipMaskAssetId: 'asset-1',
          maskOptions: { channel: 'luminance' },
        },
      ],
    };
    expect(validateTemplate(withLuminance).ok).toBe(false);
    const withDisplacement = {
      ...template!,
      surfaces: [{ ...template!.surfaces[0], displacementAssetId: 'asset-1' }],
    };
    expect(validateTemplate(withDisplacement).ok).toBe(false);
  });

  it('validates photographic plate images', () => {
    const [template] = getBuiltinMockupTemplates();
    const good = {
      ...template!,
      plateImage: { assetId: 'asset-photo', width: 1600, height: 1200, fit: 'cover' as const },
    };
    expect(validateTemplate(good).ok).toBe(true);
    const badFit = {
      ...template!,
      plateImage: { assetId: 'asset-photo', width: 1600, height: 1200, fit: 'squish' },
    };
    expect(validateTemplate(badFit).ok).toBe(false);
    const badDims = {
      ...template!,
      plateImage: { assetId: 'asset-photo', width: 0, height: 1200, fit: 'cover' as const },
    };
    expect(validateTemplate(badDims).ok).toBe(false);
  });

  it('migrates schema 1 templates and re-hashes them without enabling reserved geometry', () => {
    const [template] = getBuiltinMockupTemplates();
    const legacy = {
      ...template!,
      id: 'legacy',
      source: 'user' as const,
      library: true,
      schemaVersion: 1,
      contentHash: 'old-hash',
    };
    const built = buildTemplateFromJson(legacy);
    expect('template' in built).toBe(true);
    if (!('template' in built)) return;
    expect(built.template.schemaVersion).toBe(2);
    expect(built.template.contentHash).not.toBe('old-hash');

    const legacyCylinder = {
      ...legacy,
      surfaces: [
        {
          ...legacy.surfaces[0],
          kind: 'cylindrical' as const,
          cylindrical: {
            axis: 'vertical' as const,
            wrapDegrees: 90,
            seam: 0,
            crop: 'slot' as const,
          },
        },
      ],
    };
    expect(buildTemplateFromJson(legacyCylinder)).toEqual(
      expect.objectContaining({
        errors: expect.arrayContaining([expect.stringContaining('schemaVersion 2')]),
      }),
    );

    const warnings: Array<{ code: string }> = [];
    const sanitized = sanitizeMockupState(
      {
        ...fixtureDoc().doc,
        mockupTemplates: { legacy: legacy },
      },
      { push: (warning) => warnings.push(warning) },
    );
    expect(sanitized.mockupTemplates?.legacy?.schemaVersion).toBe(2);
    expect(warnings.some((warning) => warning.code === 'mockup.template-schema-migrated')).toBe(
      true,
    );
  });

  it('validates bounded cylindrical geometry and mask placement', () => {
    const [template] = getBuiltinMockupTemplates();
    const cylindrical = {
      ...template!,
      schemaVersion: 2,
      surfaces: [
        {
          ...template!.surfaces[0],
          kind: 'cylindrical' as const,
          cylindrical: {
            axis: 'vertical' as const,
            wrapDegrees: 120,
            seam: 0.25,
            crop: 'visible' as const,
          },
          clipMaskAssetId: 'mask',
          clipMaskPlacement: { x: 20, y: 30, width: 80, height: 90 },
          clipMaskOptions: { invert: true, feather: 3 },
        },
      ],
    };
    expect(validateTemplate(cylindrical).ok).toBe(true);
    expect(
      validateTemplate({
        ...cylindrical,
        surfaces: [
          { ...cylindrical.surfaces[0], clipMaskPlacement: { x: 0, y: 0, width: 0, height: 10 } },
        ],
      }).ok,
    ).toBe(false);
  });

  it('retains library templates when unreferenced and prunes applied ones', () => {
    const { doc } = fixtureDoc();
    const template = getBuiltinMockupTemplates()[0]!;
    const library = {
      ...template,
      id: 'user:library-template',
      source: 'user' as const,
      library: true,
    };
    const applied = { ...template, id: 'user:applied-template', source: 'user' as const };
    let next = addMockupTemplate(doc, library).document;
    next = addMockupTemplate(next, applied).document;
    const pruned = pruneUnusedMockupTemplates(next);
    expect(Object.keys(pruned.mockupTemplates ?? {})).toEqual(['user:library-template']);

    const sanitized = sanitizeMockupState(next, { push: () => {} });
    expect(Object.keys(sanitized.mockupTemplates ?? {})).toEqual(['user:library-template']);
  });

  it('retains snapshot bindings and template raster assets through GC', () => {
    const { doc, frameId } = fixtureDoc();
    const template = getBuiltinMockupTemplates()[0]!;
    const withAssets = {
      ...doc,
      assets: {
        'asset-snapshot': {
          id: 'asset-snapshot',
          storage: 'embedded' as const,
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA',
          naturalWidth: 10,
          naturalHeight: 10,
          byteLength: 8,
          hash: 'h1',
        },
        'asset-plate': {
          id: 'asset-plate',
          storage: 'embedded' as const,
          mimeType: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,BBBB',
          naturalWidth: 100,
          naturalHeight: 80,
          byteLength: 8,
          hash: 'h2',
        },
        'asset-mask': {
          id: 'asset-mask',
          storage: 'embedded' as const,
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,CCCC',
          naturalWidth: 100,
          naturalHeight: 80,
          byteLength: 8,
          hash: 'h3',
        },
        'asset-orphan': {
          id: 'asset-orphan',
          storage: 'embedded' as const,
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,DDDD',
          naturalWidth: 10,
          naturalHeight: 10,
          byteLength: 8,
          hash: 'h4',
        },
      },
    };
    const photoTemplate = {
      ...template,
      id: 'user:photo-template',
      source: 'user' as const,
      library: true,
      plateImage: { assetId: 'asset-plate', width: 100, height: 80, fit: 'cover' as const },
      surfaces: [
        {
          ...template.surfaces[0]!,
          clipMaskAssetId: 'asset-mask',
          occlusionMaskAssetId: 'asset-mask',
        },
      ],
    };
    let next = addMockupTemplate(withAssets, photoTemplate).document;
    next = frameWithMockup(next, 'user:photo-template', frameId);
    next = setMockupBinding(next, frameId, template.surfaces[0]!.id, {
      mode: 'snapshot',
      assetId: 'asset-snapshot',
    });
    const pruned = pruneUnusedAssets(next);
    const kept = Object.keys(pruned.assets ?? {}).sort();
    expect(kept).toEqual(['asset-mask', 'asset-plate', 'asset-snapshot']);
  });
});

describe('template replacement planning and uniqueness', () => {
  function twoTemplateFixture(): {
    doc: Document;
    frameId: string;
    sourceA: string;
    sourceB: string;
  } {
    const base = getBuiltinMockupTemplates()[0]!;
    const templateA = {
      ...base,
      id: 'test:two-a',
      source: 'user' as const,
      contentHash: 'hash-a',
      surfaces: [
        { ...base.surfaces[0]!, id: 'front', name: 'Front', sourceSlot: 'front' },
        { ...base.surfaces[0]!, id: 'back', name: 'Back', sourceSlot: 'back' },
      ],
    };
    const templateB = {
      ...templateA,
      id: 'test:two-b',
      contentHash: 'hash-b',
      surfaces: [
        { ...templateA.surfaces[0]!, id: 'left', name: 'Left', sourceSlot: 'back' },
        { ...templateA.surfaces[1]!, id: 'right', name: 'Right', sourceSlot: 'front' },
        { ...templateA.surfaces[0]!, id: 'extra', name: 'Extra', sourceSlot: 'artwork' },
      ],
    };
    const { doc: baseDoc, frameId, sourceId } = fixtureDoc();
    let doc = addMockupTemplate(baseDoc, templateA).document;
    doc = addMockupTemplate(doc, templateB).document;
    const s2 = nextNodeId(doc);
    doc = s2.doc;
    const sourceB = s2.id;
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [sourceB]: makeFrameNode(sourceB, { transform: [1, 0, 0, 1, 800, 0], w: 200, h: 300 }),
      },
      rootChildren: [...doc.rootChildren, sourceB],
    };
    doc = frameWithMockup(doc, 'test:two-a', frameId);
    doc = setMockupBinding(doc, frameId, 'front', { mode: 'live', nodeId: sourceId });
    doc = setMockupBinding(doc, frameId, 'back', { mode: 'live', nodeId: sourceB });
    return { doc, frameId, sourceA: sourceId, sourceB };
  }

  it('remaps bindings by sourceSlot, not array position', () => {
    const { doc, frameId, sourceA, sourceB } = twoTemplateFixture();
    const plan = planMockupTemplateRemap(doc, frameId, 'test:two-b');
    expect(plan.templateFound).toBe(true);
    expect(plan.remappedCount).toBe(2);
    expect(plan.unboundSurfaceIds).toEqual(['extra']);
    expect(plan.ambiguousSurfaceIds).toEqual([]);
    const byId = Object.fromEntries(plan.assignments.map((a) => [a.surfaceId, a.binding]));
    expect(byId.left).toMatchObject({ mode: 'live', nodeId: sourceB });
    expect(byId.right).toMatchObject({ mode: 'live', nodeId: sourceA });
    expect(byId.extra).toBeUndefined();

    const applied = applyMockupTemplateRemap(doc, frameId, 'test:two-b');
    const node = applied.document.nodes[frameId] as FrameNode & {
      mockup: NonNullable<FrameNode['mockup']>;
    };
    expect(applied.unboundSurfaceIds).toEqual(['extra']);
    expect(node.mockup.templateId).toBe('test:two-b');
    expect(node.mockup.surfaceBindings.left).toMatchObject({ nodeId: sourceB });
    expect(node.mockup.surfaceBindings.right).toMatchObject({ nodeId: sourceA });
    expect(node.mockup.surfaceBindings.extra).toBeUndefined();
  });

  it('reports ambiguous source slots instead of guessing a replacement', () => {
    const { doc: fixture, frameId, sourceA, sourceB } = twoTemplateFixture();
    const base = getBuiltinMockupTemplates()[0]!;
    const oldTemplate = {
      ...base,
      id: 'test:ambiguous-old',
      source: 'user' as const,
      surfaces: [
        { ...base.surfaces[0]!, id: 'old-a', sourceSlot: 'artwork' },
        { ...base.surfaces[0]!, id: 'old-b', sourceSlot: 'artwork' },
      ],
    };
    const newTemplate = {
      ...base,
      id: 'test:ambiguous-new',
      source: 'user' as const,
      surfaces: [{ ...base.surfaces[0]!, id: 'new-artwork', sourceSlot: 'artwork' }],
    };
    let doc = addMockupTemplate(fixture, oldTemplate).document;
    doc = addMockupTemplate(doc, newTemplate).document;
    doc = frameWithMockup(doc, 'test:ambiguous-old', frameId);
    doc = setMockupBinding(doc, frameId, 'old-a', { mode: 'live', nodeId: sourceA });
    doc = setMockupBinding(doc, frameId, 'old-b', { mode: 'live', nodeId: sourceB });

    const plan = planMockupTemplateRemap(doc, frameId, 'test:ambiguous-new');
    expect(plan.remappedCount).toBe(0);
    expect(plan.ambiguousSurfaceIds).toEqual(['new-artwork']);
    expect(plan.unboundSurfaceIds).toEqual(['new-artwork']);
    expect(plan.assignments[0]?.binding).toBeUndefined();
  });

  it('gives one instance a private template copy without mutating the original', () => {
    const { doc, frameId } = twoTemplateFixture();
    const result = makeMockupTemplateUnique(doc, frameId);
    expect(result).not.toBeNull();
    const unique = result!.document;
    const node = unique.nodes[frameId] as FrameNode & {
      mockup: NonNullable<FrameNode['mockup']>;
    };
    expect(node.mockup.templateId).toMatch(/^user:test:two-a-/);
    expect(unique.mockupTemplates?.[node.mockup.templateId]?.library).toBe(true);
    expect(unique.mockupTemplates?.['test:two-a']).toBeDefined();
    expect(unique.mockupTemplates?.['test:two-a']).toBe(doc.mockupTemplates?.['test:two-a']);
  });
});

describe('mockup instance ops', () => {
  it('binds a surface to a live node', () => {
    const { doc, frameId, sourceId } = fixtureDoc();
    const [template] = getBuiltinMockupTemplates();
    const withTemplate = addMockupTemplate(doc, template!).document;
    const inst = frameWithMockup(withTemplate, template!.id, frameId);
    const bound = setMockupBinding(inst, frameId, 'screen', { mode: 'live', nodeId: sourceId });
    const node = bound.nodes[frameId] as FrameNode & { mockup: NonNullable<FrameNode['mockup']> };
    expect(isMockupFrame(node)).toBe(true);
    expect(node.mockup.surfaceBindings.screen).toMatchObject({ mode: 'live', nodeId: sourceId });
  });

  it('rejects self and indirect recursive live bindings', () => {
    const { doc, frameId, sourceId } = fixtureDoc();
    const template = getBuiltinMockupTemplates()[0]!;
    let next = addMockupTemplate(doc, template).document;
    next = frameWithMockup(next, template.id, frameId);
    next = frameWithMockup(next, template.id, sourceId);

    expect(canBindMockupSource(next, frameId, frameId)).toMatchObject({
      ok: false,
      code: 'self-reference',
    });
    next = setMockupBinding(next, sourceId, 'screen', { mode: 'live', nodeId: frameId });
    const unchanged = setMockupBinding(next, frameId, 'screen', {
      mode: 'live',
      nodeId: sourceId,
    });
    expect(unchanged.nodes[frameId]).toEqual(next.nodes[frameId]);
    expect(canBindMockupSource(next, frameId, sourceId)).toMatchObject({
      ok: false,
      code: 'indirect-cycle',
    });
  });

  it('allows valid shared sources in a non-cyclic binding graph', () => {
    const { doc, frameId, sourceId } = fixtureDoc();
    const template = getBuiltinMockupTemplates()[0]!;
    let next = addMockupTemplate(doc, template).document;
    const leafA = nextNodeId(next);
    next = leafA.doc;
    next = {
      ...next,
      nodes: {
        ...next.nodes,
        [leafA.id]: makeFrameNode(leafA.id, {
          transform: [1, 0, 0, 1, 0, 700],
          w: 120,
          h: 120,
        }),
      },
      rootChildren: [...next.rootChildren, leafA.id],
    };
    next = frameWithMockup(next, template.id, sourceId);
    next = frameWithMockup(next, template.id, frameId);
    const sourceFrame = next.nodes[sourceId] as FrameNode & {
      mockup: NonNullable<FrameNode['mockup']>;
    };
    next = {
      ...next,
      nodes: {
        ...next.nodes,
        [sourceId]: {
          ...sourceFrame,
          mockup: {
            ...sourceFrame.mockup,
            surfaceBindings: {
              first: { mode: 'live', nodeId: leafA.id },
              second: { mode: 'live', nodeId: leafA.id },
            },
          },
        },
      },
    };
    expect(canBindMockupSource(next, frameId, sourceId)).toEqual({ ok: true });
  });

  it('applies per-surface overrides', () => {
    const { doc, frameId } = fixtureDoc();
    const [template] = getBuiltinMockupTemplates();
    const withTemplate = addMockupTemplate(doc, template!).document;
    const inst = frameWithMockup(withTemplate, template!.id, frameId);
    const overridden = setMockupSurfaceOverride(inst, frameId, 'screen', {
      fit: 'cover',
      shadow: { blur: 10, offsetY: 2, opacity: 0.5 },
    });
    const node = overridden.nodes[frameId] as FrameNode & {
      mockup: NonNullable<FrameNode['mockup']>;
    };
    expect(node.mockup.overrides?.screen?.fit).toBe('cover');
    expect(node.mockup.overrides?.screen?.shadow?.blur).toBe(10);
    const again = setMockupSurfaceOverride(overridden, frameId, 'screen', { rotation: 15 });
    const againNode = again.nodes[frameId] as FrameNode & {
      mockup: NonNullable<FrameNode['mockup']>;
    };
    expect(againNode.mockup.overrides?.screen?.fit).toBe('cover');
    expect(againNode.mockup.overrides?.screen?.rotation).toBe(15);

    const rejected = setMockupSurfaceOverride(again, frameId, 'screen', {
      width: 0,
    });
    expect(rejected).toBe(again);
  });

  it('replaces templates and clears mockups', () => {
    const { doc, frameId } = fixtureDoc();
    const templates = getBuiltinMockupTemplates();
    const a = addMockupTemplate(doc, templates[0]!).document;
    const inst = frameWithMockup(a, templates[0]!.id, frameId);
    const b = addMockupTemplate(inst, templates[1]!).document;
    const replaced = setMockupTemplate(b, frameId, templates[1]!.id);
    const node = replaced.nodes[frameId] as FrameNode & {
      mockup: NonNullable<FrameNode['mockup']>;
    };
    expect(node.mockup.templateId).toBe(templates[1]!.id);
    const cleared = clearMockup(replaced, frameId);
    expect((cleared.nodes[frameId] as FrameNode).mockup).toBeUndefined();
  });

  it('marks detached', () => {
    const { doc, frameId } = fixtureDoc();
    const [template] = getBuiltinMockupTemplates();
    const withTemplate = addMockupTemplate(doc, template!).document;
    const inst = frameWithMockup(withTemplate, template!.id, frameId);
    const detached = markMockupDetached(inst, frameId, true);
    expect(
      (detached.nodes[frameId] as FrameNode & { mockup: NonNullable<FrameNode['mockup']> }).mockup
        .detached,
    ).toBe(true);
  });

  it('prunes templates not referenced by any frame', () => {
    const { doc, frameId } = fixtureDoc();
    const [template] = getBuiltinMockupTemplates();
    const withTemplate = addMockupTemplate(doc, template!).document;
    const inst = frameWithMockup(withTemplate, template!.id, frameId);
    const [other] = getBuiltinMockupTemplates().filter((t) => t.id !== template!.id);
    const withOther = addMockupTemplate(inst, other!).document;
    expect(Object.keys(withOther.mockupTemplates ?? {})).toHaveLength(2);
    const pruned = pruneUnusedMockupTemplates(withOther);
    expect(Object.keys(pruned.mockupTemplates ?? {})).toHaveLength(1);
    expect(pruned.mockupTemplates?.[template!.id]).toBeTruthy();
  });
});

describe('source digest', () => {
  it('changes when the source paint changes and is stable otherwise', () => {
    const { doc, sourceId } = fixtureDoc();
    const d1 = computeMockupSourceDigest(doc, sourceId);
    const d2 = computeMockupSourceDigest(doc, sourceId);
    expect(d1).toBe(d2);
    const source = doc.nodes[sourceId] as FrameNode;
    const changed = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [sourceId]: { ...source, w: 400 },
      },
    };
    expect(computeMockupSourceDigest(changed, sourceId)).not.toBe(d1);
    const renamed = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [sourceId]: { ...source, name: 'Renamed' },
      },
    };
    expect(computeMockupSourceDigest(renamed, sourceId)).toBe(d1);
  });

  it('changes when a child is added', () => {
    const { doc, sourceId } = fixtureDoc();
    const d1 = computeMockupSourceDigest(doc, sourceId);
    const c = nextNodeId(doc);
    const childId = c.id;
    const source = doc.nodes[sourceId] as FrameNode;
    const changed = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [sourceId]: { ...source, children: [...source.children, childId] },
        [childId]: makeFrameNode(childId, { transform: [1, 0, 0, 1, 0, 0], w: 10, h: 10 }),
      },
    };
    expect(computeMockupSourceDigest(changed, sourceId)).not.toBe(d1);
  });
});

describe('codec round-trip and normalization', () => {
  it('saves and reloads a mockup without visual change', () => {
    const { doc, frameId, sourceId } = fixtureDoc();
    const phone = getBuiltinMockupTemplates().find((t) => t.id === 'builtin:phone-flat')!;
    const withTemplate = addMockupTemplate(doc, phone).document;
    const inst = frameWithMockup(withTemplate, phone.id, frameId);
    const bound = setMockupBinding(inst, frameId, 'screen', { mode: 'live', nodeId: sourceId });
    const overridden = setMockupSurfaceOverride(bound, frameId, 'screen', { fit: 'cover' });

    const json = DocumentCodec.encode(overridden);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok).toBe(true);
    const reloaded = (decoded as { document: Document }).document;
    const node = reloaded.nodes[frameId] as FrameNode & {
      mockup: NonNullable<FrameNode['mockup']>;
    };
    expect(node.mockup.templateId).toBe(phone.id);
    expect(node.mockup.surfaceBindings.screen).toMatchObject({ mode: 'live', nodeId: sourceId });
    expect(node.mockup.overrides?.screen?.fit).toBe('cover');
    expect(reloaded.mockupTemplates?.[phone.id]).toBeTruthy();
    expect(reloaded.mockupTemplates?.[phone.id]?.contentHash).toBe(phone.contentHash);
  });

  it('normalization drops invalid instances and prunes orphan templates', () => {
    const { doc, frameId, sourceId } = fixtureDoc();
    const [template] = getBuiltinMockupTemplates();
    const withTemplate = addMockupTemplate(doc, template!).document;
    const inst = frameWithMockup(withTemplate, template!.id, frameId);
    const bound = setMockupBinding(inst, frameId, 'screen', { mode: 'live', nodeId: sourceId });
    const warnings: Array<{ code: string; severity: string }> = [];
    const broken = frameWithMockup(bound, 'missing-template', frameId);
    const sanitized = sanitizeMockupState(broken, {
      push: (w) => warnings.push({ code: w.code, severity: w.severity }),
    });
    expect((sanitized.nodes[frameId] as FrameNode).mockup).toBeUndefined();
    expect(warnings.some((w) => w.code === 'mockup.invalid-instance')).toBe(true);
    expect(sanitized.mockupTemplates).toBeUndefined();
  });

  it('preserves missing source bindings for explicit reconnect recovery', () => {
    const { doc, frameId } = fixtureDoc();
    const template = getBuiltinMockupTemplates()[0]!;
    const withTemplate = addMockupTemplate(doc, template).document;
    const frame = frameWithMockup(withTemplate, template.id, frameId);
    const broken = {
      ...frame,
      nodes: {
        ...frame.nodes,
        [frameId]: {
          ...(frame.nodes[frameId] as FrameNode),
          mockup: createMockupInstanceData(template.id, {
            screen: { mode: 'live' as const, nodeId: 'deleted-source' },
          }),
        },
      },
    };
    const warnings: string[] = [];
    const sanitized = sanitizeMockupState(broken, {
      push: (warning) => warnings.push(warning.code),
    });
    expect((sanitized.nodes[frameId] as FrameNode).mockup).toBeDefined();
    expect(warnings).toContain('mockup.missing-source');
  });

  it('preserves missing template asset references for recovery and export diagnostics', () => {
    const { doc, frameId } = fixtureDoc();
    const base = getBuiltinMockupTemplates()[0]!;
    const template = {
      ...base,
      id: 'user:missing-plate',
      source: 'user' as const,
      library: true,
      plateImage: {
        assetId: 'asset:missing-plate',
        width: base.outputWidth,
        height: base.outputHeight,
        fit: 'cover' as const,
      },
      surfaces: [{ ...base.surfaces[0]!, clipMaskAssetId: 'asset:missing-mask' }],
    };
    const withTemplate = addMockupTemplate(doc, template).document;
    const withFrame = frameWithMockup(withTemplate, template.id, frameId);
    const warnings: string[] = [];
    const sanitized = sanitizeMockupState(withFrame, {
      push: (warning) => warnings.push(warning.code),
    });
    const retained = sanitized.mockupTemplates?.[template.id];
    expect(retained?.plateImage?.assetId).toBe('asset:missing-plate');
    expect(retained?.surfaces[0]?.clipMaskAssetId).toBe('asset:missing-mask');
    expect(warnings).toContain('mockup.missing-template-asset');
  });

  it('clipboard closure includes mockup templates', () => {
    const { doc, frameId, sourceId } = fixtureDoc();
    const [template] = getBuiltinMockupTemplates();
    const withTemplate = addMockupTemplate(doc, template!).document;
    const inst = frameWithMockup(withTemplate, template!.id, frameId);
    const bound = setMockupBinding(inst, frameId, 'screen', { mode: 'live', nodeId: sourceId });
    const closure = DocumentCodec.collectNodeClosure(bound, [frameId]);
    expect(closure.mockupTemplates?.[template!.id]).toBeTruthy();
  });
});

describe('template JSON import limits', () => {
  it('rejects oversized geometry and excessive surfaces', () => {
    const [template] = getBuiltinMockupTemplates();
    const huge = {
      ...template!,
      surfaces: [{ ...template!.surfaces[0], x: 1e9, y: 1e9, width: 1e9, height: 1e9 }],
    };
    expect(validateTemplate(huge).ok).toBe(false);
    const many = {
      ...template!,
      surfaces: Array.from({ length: 40 }, (_, i) => ({ ...template!.surfaces[0]!, id: `s${i}` })),
    };
    expect(validateTemplate(many).ok).toBe(false);
  });
});

describe('multimodal request contract', () => {
  it('validates well-formed requests', () => {
    const req = validateMockupRequest({
      sourceNodeIds: ['frame-1'],
      targetKind: 'phone',
      placementMode: 'flat',
      preserveSourceLink: true,
    });
    expect(req).not.toBeNull();
    expect(req?.targetKind).toBe('phone');
  });

  it('rejects unknown and contradictory values', () => {
    expect(
      validateMockupRequest({
        sourceNodeIds: [],
        targetKind: 'phone',
        placementMode: 'flat',
        preserveSourceLink: true,
      }),
    ).toBeNull();
    expect(
      validateMockupRequest({
        sourceNodeIds: ['a'],
        targetKind: 'holodeck',
        placementMode: 'flat',
        preserveSourceLink: true,
      }),
    ).toBeNull();
    expect(
      validateMockupRequest({
        sourceNodeIds: ['a'],
        targetKind: 'phone',
        placementMode: 'teleport',
        preserveSourceLink: true,
      }),
    ).toBeNull();
    expect(
      validateMockupRequest({
        sourceNodeIds: ['a'],
        targetKind: 'phone',
        placementMode: 'flat',
        preserveSourceLink: 'yes',
      }),
    ).toBeNull();
  });

  it('classifies auto placement and flags unsupported assisted geometry', () => {
    const auto = classifyMockupIntent({
      sourceNodeIds: ['a'],
      targetKind: 'poster',
      placementMode: 'auto',
      preserveSourceLink: true,
    });
    expect(auto).not.toHaveProperty('errors');
    expect((auto as { resolvedPlacementMode: string }).resolvedPlacementMode).toBe('quad');

    const mesh = classifyMockupIntent({
      sourceNodeIds: ['a'],
      targetKind: 'packaging',
      placementMode: 'mesh',
      preserveSourceLink: true,
    });
    expect(mesh).not.toHaveProperty('errors');
    const m = mesh as { resolvedPlacementMode: string; warnings: string[] };
    expect(m.resolvedPlacementMode).toBe('flat');
    expect(m.warnings.some((w) => w.includes('mesh'))).toBe(true);

    const variants = classifyMockupIntent({
      sourceNodeIds: ['a'],
      targetKind: 'apparel',
      placementMode: 'flat',
      preserveSourceLink: true,
      requestedVariants: 3,
    });
    expect(variants).not.toHaveProperty('errors');
    expect((variants as { warnings: string[] }).warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Mockup Variants panel')]),
    );
  });
});
