import { describe, expect, it } from 'vitest';
import type { Document } from '../../document';
import { createDocument, makeFrameNode, nextNodeId } from '../../document';
import { DocumentCodec } from '../../documentCodec';
import type { FrameNode } from '../../types';
import { getBuiltinMockupTemplates } from '../builtinTemplates';
import { classifyMockupIntent, validateMockupRequest } from '../multimodal';
import { sanitizeMockupState } from '../normalize';
import {
  addMockupTemplate,
  clearMockup,
  computeMockupSourceDigest,
  createMockupInstanceData,
  isMockupFrame,
  markMockupDetached,
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

  it('rejects reserved surface kinds and reserved asset fields', () => {
    const [template] = getBuiltinMockupTemplates();
    const mesh = { ...template!, surfaces: [{ ...template!.surfaces[0], kind: 'mesh' }] };
    expect(validateTemplate(mesh).ok).toBe(false);
    const withMask = {
      ...template!,
      surfaces: [{ ...template!.surfaces[0], clipMaskAssetId: 'asset-1' }],
    };
    expect(validateTemplate(withMask).ok).toBe(false);
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

  it('classifies auto placement and flags reserved modes', () => {
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
  });
});
