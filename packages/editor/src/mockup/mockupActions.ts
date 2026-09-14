/**
 * Mockup creation actions.
 *
 * All mutations go through the editor's normal `updateDoc` + transaction
 * path, so applying a mockup is a single undoable step. The source design
 * stays in place; the mockup frame is created beside it and selected.
 */

import {
  addChild,
  addMockupTemplate,
  addNode,
  applyMockupTemplateRemap,
  canBindMockupSource,
  computeMockupSourceDigest,
  createMockupInstanceData,
  type Document,
  findOrCreateEmbeddedAsset,
  getBuiltinMockupTemplate,
  getBuiltinMockupTemplates,
  getMockupTemplate,
  isMockupFrame,
  MOCKUP_LIMITS,
  type MockupCategory,
  type MockupMaskOptions,
  type MockupMaskPlacement,
  type MockupSourceBinding,
  type MockupTemplateAsset,
  makeFrameNode,
  makeMockupTemplateUnique,
  type NodeId,
  nextNodeId,
  nodeWorldBounds,
  nodeWorldTransform,
  resolveOwnership,
  updateMockupTemplate,
} from '@varve/scene';
import { type Affine, applyAffine, multiplyAffine, tryInvertAffine } from '@varve/shared';
import type { EditorContextValue } from '../context';
import { captureMockupSourceSnapshot } from './mockupCapture';
import { requestMockupsTab } from './mockupTabStore';

/** Template asset with a cached reference (builtin or document-embedded). */
export interface ResolvedMockupTemplate {
  template: MockupTemplateAsset;
  templateId: string;
}

/** Open the Mockups tab, remembering the current selection as sources. */
export function openMockupsWithSelection(editor: EditorContextValue): void {
  requestMockupsTab(editor.state.selection.length > 0 ? editor.state.selection : undefined);
  if (!editor.state.libraryPanelVisible) {
    editor.toggleLibraryPanel();
  }
}

/** Resolve a template for use in a document (builtin catalog or embedded). */
export function resolveTemplateForDocument(
  doc: Document,
  templateId: string,
): ResolvedMockupTemplate | null {
  const embedded = doc.mockupTemplates?.[templateId];
  if (embedded) return { template: embedded, templateId };
  const builtin = getBuiltinMockupTemplate(templateId);
  if (builtin) return { template: builtin, templateId };
  return null;
}

/** Effective surface binding for a template slot and source. */
export function bindingForSource(
  sourceIds: NodeId[],
  surfaceIndex: number,
  preserveLink: boolean,
): MockupSourceBinding | undefined {
  const sourceId = sourceIds[surfaceIndex % sourceIds.length];
  // A synchronous apply cannot manufacture a valid snapshot. Leaving the
  // slot unbound is explicit and recoverable; the Snapshot command performs
  // the asynchronous capture when the user asks for one.
  if (!preserveLink || !sourceId) return undefined;
  return { mode: 'live', nodeId: sourceId };
}

/**
 * Resolve the logical editing surface that owns a source node.  Page and
 * Design Canvas content roots are deliberately hidden implementation groups;
 * adding a new mockup directly to `rootChildren` would bypass the active
 * surface and make it disappear from the canvas and Layers panel.
 */
function mockupInsertionParent(doc: Document, sourceId: NodeId): NodeId | null {
  const owner = resolveOwnership(doc, sourceId);
  switch (owner.kind) {
    case 'designCanvas':
      return (
        doc.designCanvases?.find((canvas) => canvas.id === owner.designCanvasId)?.contentRoot ??
        null
      );
    case 'page':
      return doc.pages?.find((page) => page.id === owner.pageId)?.contentRoot ?? null;
    case 'master':
      return doc.masters?.[owner.masterId]?.contentRoot ?? null;
    default:
      return null;
  }
}

/** Convert the desired pasteboard position into the target surface's local space. */
function mockupTransformForParent(
  editor: EditorContextValue,
  parentId: NodeId | null,
  x: number,
  y: number,
): Affine {
  const world: Affine = [1, 0, 0, 1, x, y];
  if (!parentId) return world;
  const inverse = tryInvertAffine(editor.getWorldTransform(parentId));
  return inverse ? multiplyAffine(inverse, world) : world;
}

/**
 * Apply a template to the given source nodes: creates a mockup frame beside
 * the first source, embeds the template asset (deduped), binds surfaces to
 * the sources (cycled for multi-surface templates), and selects the frame.
 * One undoable transaction.
 */
export function applyMockupToSources(
  editor: EditorContextValue,
  templateId: string,
  sourceIds: NodeId[],
  preserveLink = true,
): NodeId | null {
  const doc = editor.state.document;
  const resolved = resolveTemplateForDocument(doc, templateId);
  if (!resolved || sourceIds.length === 0) return null;

  const sourceId = sourceIds.find((id) => Boolean(doc.nodes[id]));
  const sourceNode = sourceId ? doc.nodes[sourceId] : undefined;
  if (!sourceId || !sourceNode) return null;

  const { template } = resolved;
  // Reserve the ID synchronously. `updateDoc` evaluates its updater during
  // React's state flush, so an ID assigned inside that updater is not
  // available when the post-transaction selection is applied.
  const templateDoc = addMockupTemplate(doc, template).document;
  const { id: createdNodeId } = nextNodeId(templateDoc);

  // Placement: to the right of the first source, fitted to ~600px height.
  const sourceBounds = editor.getWorldBounds(sourceId);
  const targetH = 600;
  const frameW = template.outputWidth * (targetH / template.outputHeight);
  const frameH = targetH;
  const x = (sourceBounds?.x ?? 0) + (sourceBounds?.w ?? 400) + 80;
  const y = sourceBounds?.y ?? 0;
  const parentId = mockupInsertionParent(doc, sourceId);
  const transform = mockupTransformForParent(editor, parentId, x, y);

  // Validate the proposed dependency edges against a provisional frame. The
  // synchronous apply path used to write bindings directly, which meant a
  // multi-selection containing a malformed mockup could bypass the same
  // cycle/ancestor checks used by inspector replacement.
  const provisionalFrame = makeFrameNode(createdNodeId, {
    transform,
    w: frameW,
    h: frameH,
    name: `${template.name} mockup`,
    clipContent: false,
  });
  const provisionalDocument =
    parentId && templateDoc.nodes[parentId]
      ? addChild(templateDoc, parentId, provisionalFrame)
      : addNode(templateDoc, provisionalFrame);
  const safeSourceIds = preserveLink
    ? sourceIds.filter((id) => canBindMockupSource(provisionalDocument, createdNodeId, id).ok)
    : sourceIds.filter((id) => Boolean(doc.nodes[id]));
  if (safeSourceIds.length === 0) return null;

  const bindings: Record<string, MockupSourceBinding> = {};
  template.surfaces.forEach((surface, index) => {
    const binding = bindingForSource(safeSourceIds, index, preserveLink);
    if (binding) bindings[surface.id] = binding;
  });

  editor.beginTransaction();
  try {
    editor.updateDoc((current) => {
      const added = addMockupTemplate(current, template);
      const withTemplate = added.document;
      const resolvedTemplateId = added.templateId;
      const { doc: next } = nextNodeId(withTemplate);
      const nodeId = createdNodeId;
      const frame = makeFrameNode(nodeId, {
        transform,
        w: frameW,
        h: frameH,
        name: `${template.name} mockup`,
        clipContent: false,
      });
      const mockupFrame = {
        ...frame,
        mockup: createMockupInstanceData(resolvedTemplateId, bindings),
      };
      return parentId && next.nodes[parentId]
        ? addChild(next, parentId, mockupFrame)
        : addNode(next, mockupFrame);
    });
  } finally {
    editor.commitTransaction();
  }
  editor.setSelection(createdNodeId);
  return createdNodeId;
}

/** Apply the given template to the current selection (single/multi). */
export function applyMockupToSelection(
  editor: EditorContextValue,
  templateId: string,
): NodeId | null {
  const selection = editor.state.selection;
  if (selection.length === 0) return null;
  return applyMockupToSources(editor, templateId, selection, true);
}

/** Templates suitable for the current selection (all builtins + embedded). */
export function templatesForDocument(doc: Document): MockupTemplateAsset[] {
  const builtins = getBuiltinMockupTemplates();
  const embedded = Object.values(doc.mockupTemplates ?? {}).filter(
    (t) => !builtins.some((b) => b.id === t.id),
  );
  return [...builtins, ...embedded];
}

export interface ApplyTemplateToInstanceResult {
  unboundSurfaceIds: string[];
}

/**
 * Replace an instance's template, remapping bindings by `sourceSlot`
 * semantics. The template is embedded in the same transaction. Returns the
 * surfaces left without a source so the caller can report them.
 */
export function applyMockupTemplateToInstance(
  editor: EditorContextValue,
  frameId: NodeId,
  template: MockupTemplateAsset,
): ApplyTemplateToInstanceResult | null {
  const doc = editor.state.document;
  if (!isMockupFrame(doc.nodes[frameId])) return null;
  const { document: withTemplate, templateId } = addMockupTemplate(doc, template);
  const applied = applyMockupTemplateRemap(withTemplate, frameId, templateId);
  editor.beginTransaction();
  try {
    editor.updateDoc(() => applied.document);
  } finally {
    editor.commitTransaction();
  }
  return { unboundSurfaceIds: applied.unboundSurfaceIds };
}

export interface CreateMockupTemplateOptions {
  name?: string;
  category?: MockupCategory;
  sourceSlot?: string;
}

export interface CreateMockupTemplateResult {
  frameId: NodeId;
  templateId: string;
}

const USER_LICENCE = {
  title: 'User-authored mockup template',
  creator: 'Varve user',
  commercialUse: 'unknown' as const,
  modification: 'unknown' as const,
  redistribution: 'unknown' as const,
};

/**
 * Author a photographic template from the current selection: the selected
 * image/frame/group is captured once as an untouched base plate, wrapped in a
 * user library template with one replaceable surface, and instantiated as a
 * normal mockup frame beside the source. The source artwork stays in place;
 * the instance's surface starts unbound so artwork placement is deliberate.
 */
export async function createMockupTemplateFromSelection(
  editor: EditorContextValue,
  options: CreateMockupTemplateOptions = {},
): Promise<CreateMockupTemplateResult | null> {
  const doc = editor.state.document;
  const sourceId = editor.state.selection[0];
  const source = sourceId ? doc.nodes[sourceId] : undefined;
  if (!sourceId || !source) return null;
  const sourceDigest = computeMockupSourceDigest(doc, sourceId);
  const capture = await captureMockupSourceSnapshot(doc, sourceId);
  if (!capture) return null;
  const workingDoc = editor.state.document;
  if (
    !workingDoc.nodes[sourceId] ||
    computeMockupSourceDigest(workingDoc, sourceId) !== sourceDigest
  ) {
    return null;
  }

  const templateId = `user:from-selection-${Date.now().toString(36)}`;
  const { id: createdNodeId } = nextNodeId(workingDoc);
  const sourceBounds = editor.getWorldBounds(sourceId);
  const targetH = 600;
  const frameScale = targetH / Math.max(1, capture.height);
  const frameW = capture.width * frameScale;
  const frameH = targetH;
  const x = (sourceBounds?.x ?? 0) + (sourceBounds?.w ?? 400) + 80;
  const y = sourceBounds?.y ?? 0;
  const parentId = mockupInsertionParent(workingDoc, sourceId);
  const transform = mockupTransformForParent(editor, parentId, x, y);
  let resolvedTemplateId = templateId;

  const insetX = capture.width * 0.15;
  const insetY = capture.height * 0.15;
  const template: MockupTemplateAsset = {
    id: templateId,
    schemaVersion: 2,
    name: options.name?.trim() || `${source.name} mockup`,
    description: 'Created from a selection; the photo is the base plate.',
    category: options.category ?? 'print',
    source: 'user',
    orientation:
      capture.width > capture.height
        ? 'landscape'
        : capture.width < capture.height
          ? 'portrait'
          : 'square',
    outputWidth: capture.width,
    outputHeight: capture.height,
    backgroundColor: 'transparent',
    plateImage: {
      assetId: '',
      width: capture.width,
      height: capture.height,
      fit: 'cover',
    },
    plate: [],
    surfaces: [
      {
        id: 'artwork',
        name: 'Artwork',
        kind: 'flat',
        sourceSlot: options.sourceSlot ?? 'artwork',
        x: Math.round(insetX),
        y: Math.round(insetY),
        width: Math.max(1, Math.round(capture.width - insetX * 2)),
        height: Math.max(1, Math.round(capture.height - insetY * 2)),
        fit: 'contain',
        alignment: { x: 'center', y: 'center' },
      },
    ],
    overlays: [],
    licence: USER_LICENCE,
    tags: ['user', 'photo'],
    contentHash: '',
    capabilities: ['flat', 'photo-plate', 'alpha-masks'],
    library: true,
  };

  editor.beginTransaction();
  try {
    editor.updateDoc((current) => {
      const { document: withAsset, assetId } = findOrCreateEmbeddedAsset(current, {
        dataUrl: capture.dataUrl,
        mimeType: 'image/png',
        naturalWidth: capture.width,
        naturalHeight: capture.height,
      });
      const withPlateTemplate: MockupTemplateAsset = {
        ...template,
        plateImage: template.plateImage ? { ...template.plateImage, assetId } : undefined,
      };
      const added = addMockupTemplate(withAsset, withPlateTemplate);
      resolvedTemplateId = added.templateId;
      const frame = makeFrameNode(createdNodeId, {
        transform,
        w: frameW,
        h: frameH,
        name: `${withPlateTemplate.name}`,
        clipContent: false,
      });
      const mockupFrame = {
        ...frame,
        mockup: createMockupInstanceData(added.templateId, {}),
      };
      return parentId && added.document.nodes[parentId]
        ? addChild(added.document, parentId, mockupFrame)
        : addNode(added.document, mockupFrame);
    });
  } finally {
    editor.commitTransaction();
  }
  editor.setSelection(createdNodeId);
  return { frameId: createdNodeId, templateId: resolvedTemplateId };
}

/** Give this instance a private copy of its template (edits stay scoped). */
export function makeInstanceTemplateUnique(editor: EditorContextValue, frameId: NodeId): boolean {
  const result = makeMockupTemplateUnique(editor.state.document, frameId);
  if (!result) return false;
  editor.beginTransaction();
  try {
    editor.updateDoc(() => result.document);
  } finally {
    editor.commitTransaction();
  }
  return true;
}

/**
 * Run a template authoring edit against a frame-owned copy. Shared library
 * templates are never mutated by an instance edit; an already-owned copy is
 * reused so a sequence of edits remains one coherent template and does not
 * create a chain of orphaned copies.
 */
function updatePrivateInstanceTemplate(
  editor: EditorContextValue,
  frameId: NodeId,
  updater: (template: MockupTemplateAsset) => MockupTemplateAsset,
  finalize?: (doc: Document, templateId: string) => Document,
): boolean {
  const frame = editor.state.document.nodes[frameId];
  if (!isMockupFrame(frame) || !editor.state.document.mockupTemplates?.[frame.mockup.templateId]) {
    return false;
  }
  editor.beginTransaction();
  try {
    editor.updateDoc((current) => {
      const unique = makeMockupTemplateUnique(current, frameId);
      if (!unique) return current;
      const updated = updateMockupTemplate(unique.document, unique.templateId, updater);
      return finalize ? finalize(updated, unique.templateId) : updated;
    });
  } finally {
    editor.commitTransaction();
  }
  return true;
}

/** Map a captured world-space selection into template-output coordinates. */
function maskPlacementForCapture(
  doc: Document,
  frameId: NodeId,
  template: MockupTemplateAsset,
  bounds: { x: number; y: number; w: number; h: number },
): MockupMaskPlacement | undefined {
  const frame = doc.nodes[frameId];
  if (!isMockupFrame(frame) || frame.w <= 0 || frame.h <= 0) return undefined;
  const inverse = tryInvertAffine(nodeWorldTransform(doc, frameId));
  if (!inverse) return undefined;
  const worldCorners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x + bounds.w, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h],
  ];
  const local = worldCorners.map((point) => applyAffine(inverse, point as [number, number]));
  const minX = Math.min(...local.map(([x]) => x));
  const minY = Math.min(...local.map(([, y]) => y));
  const maxX = Math.max(...local.map(([x]) => x));
  const maxY = Math.max(...local.map(([, y]) => y));
  const scaleX = template.outputWidth / frame.w;
  const scaleY = template.outputHeight / frame.h;
  const placement = {
    x: minX * scaleX,
    y: minY * scaleY,
    width: (maxX - minX) * scaleX,
    height: (maxY - minY) * scaleY,
  };
  return Number.isFinite(placement.x) &&
    Number.isFinite(placement.y) &&
    Number.isFinite(placement.width) &&
    Number.isFinite(placement.height) &&
    placement.width > 0 &&
    placement.height > 0
    ? placement
    : undefined;
}

function templateRectForNode(
  doc: Document,
  frameId: NodeId,
  template: MockupTemplateAsset,
  sourceId: NodeId,
): { x: number; y: number; width: number; height: number } | undefined {
  const frame = doc.nodes[frameId];
  const bounds = nodeWorldBounds(doc, sourceId);
  if (!isMockupFrame(frame) || !bounds || frame.w <= 0 || frame.h <= 0) return undefined;
  const inverse = tryInvertAffine(nodeWorldTransform(doc, frameId));
  if (!inverse) return undefined;
  const corners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x + bounds.w, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h],
  ].map((point) => applyAffine(inverse, point as [number, number]));
  const minX = Math.min(...corners.map(([x]) => x));
  const minY = Math.min(...corners.map(([, y]) => y));
  const maxX = Math.max(...corners.map(([x]) => x));
  const maxY = Math.max(...corners.map(([, y]) => y));
  const scaleX = template.outputWidth / frame.w;
  const scaleY = template.outputHeight / frame.h;
  const rect = {
    x: minX * scaleX,
    y: minY * scaleY,
    width: (maxX - minX) * scaleX,
    height: (maxY - minY) * scaleY,
  };
  return Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
    ? rect
    : undefined;
}

function nextSurfaceIdentity(template: MockupTemplateAsset): { id: string; sourceSlot: string } {
  const usedIds = new Set(template.surfaces.map((surface) => surface.id));
  const usedSlots = new Set(template.surfaces.map((surface) => surface.sourceSlot));
  let index = template.surfaces.length + 1;
  while (usedIds.has(`surface-${index}`) || usedSlots.has(`artwork-${index}`)) index++;
  return { id: `surface-${index}`, sourceSlot: `artwork-${index}` };
}

/** Add a flat, source-sized replaceable surface to the selected template. */
export function addTemplateSurfaceFromSelection(
  editor: EditorContextValue,
  frameId: NodeId,
): boolean {
  const doc = editor.state.document;
  const sourceId = editor.state.selection.find((id) => id !== frameId);
  const frame = doc.nodes[frameId];
  if (!sourceId || !doc.nodes[sourceId] || !isMockupFrame(frame)) return false;
  const template = getMockupTemplate(doc, frame.mockup.templateId);
  const rect = template ? templateRectForNode(doc, frameId, template, sourceId) : undefined;
  if (
    !template ||
    template.surfaces.length >= MOCKUP_LIMITS.maxSurfaces ||
    !rect ||
    !canBindMockupSource(doc, frameId, sourceId).ok
  ) {
    return false;
  }
  const identity = nextSurfaceIdentity(template);
  return updatePrivateInstanceTemplate(
    editor,
    frameId,
    (current) => ({
      ...current,
      surfaces: [
        ...current.surfaces,
        {
          id: identity.id,
          name: `Surface ${current.surfaces.length + 1}`,
          kind: 'flat',
          sourceSlot: identity.sourceSlot,
          ...rect,
          fit: 'contain',
          alignment: { x: 'center', y: 'center' },
        },
      ],
    }),
    (updated) => {
      const updatedFrame = updated.nodes[frameId];
      if (!isMockupFrame(updatedFrame)) return updated;
      return {
        ...updated,
        nodes: {
          ...updated.nodes,
          [frameId]: {
            ...updatedFrame,
            mockup: {
              ...updatedFrame.mockup,
              surfaceBindings: {
                ...updatedFrame.mockup.surfaceBindings,
                [identity.id]: { mode: 'live', nodeId: sourceId },
              },
            },
          },
        },
      };
    },
  );
}

/** Duplicate a surface definition and its source binding as an editable variant. */
export function duplicateTemplateSurface(
  editor: EditorContextValue,
  frameId: NodeId,
  surfaceId: string,
): boolean {
  const doc = editor.state.document;
  const frame = doc.nodes[frameId];
  if (!isMockupFrame(frame)) return false;
  const template = getMockupTemplate(doc, frame.mockup.templateId);
  const source = template?.surfaces.find((surface) => surface.id === surfaceId);
  if (!template || !source) return false;
  const identity = nextSurfaceIdentity(template);
  const dx = Math.min(24, Math.max(0, template.outputWidth - source.x - source.width));
  const dy = Math.min(24, Math.max(0, template.outputHeight - source.y - source.height));
  const copy = {
    ...source,
    id: identity.id,
    name: `${source.name} copy`,
    sourceSlot: identity.sourceSlot,
    x: source.x + dx,
    y: source.y + dy,
    quad: source.quad?.map((point) => ({ x: point.x + dx, y: point.y + dy })) as
      | MockupTemplateAsset['surfaces'][number]['quad']
      | undefined,
    clipMaskPlacement: source.clipMaskPlacement
      ? {
          ...source.clipMaskPlacement,
          x: source.clipMaskPlacement.x + dx,
          y: source.clipMaskPlacement.y + dy,
        }
      : undefined,
    occlusionMaskPlacement: source.occlusionMaskPlacement
      ? {
          ...source.occlusionMaskPlacement,
          x: source.occlusionMaskPlacement.x + dx,
          y: source.occlusionMaskPlacement.y + dy,
        }
      : undefined,
  };
  return updatePrivateInstanceTemplate(
    editor,
    frameId,
    (current) => ({ ...current, surfaces: [...current.surfaces, copy] }),
    (updated) => {
      const updatedFrame = updated.nodes[frameId];
      if (!isMockupFrame(updatedFrame)) return updated;
      const binding = updatedFrame.mockup.surfaceBindings[surfaceId];
      return {
        ...updated,
        nodes: {
          ...updated.nodes,
          [frameId]: {
            ...updatedFrame,
            mockup: {
              ...updatedFrame.mockup,
              surfaceBindings: binding
                ? { ...updatedFrame.mockup.surfaceBindings, [identity.id]: binding }
                : updatedFrame.mockup.surfaceBindings,
            },
          },
        },
      };
    },
  );
}

/**
 * Capture the selected node as alpha coverage and assign it to a surface's
 * clip or occlusion slot. The instance first gets a private template copy so
 * this authoring edit cannot mutate every user of a shared template.
 */
export async function assignSurfaceMaskFromSelection(
  editor: EditorContextValue,
  frameId: NodeId,
  surfaceId: string,
  kind: 'clip' | 'occlusion',
): Promise<boolean> {
  const doc = editor.state.document;
  const sourceId = editor.state.selection.find((id) => id !== frameId);
  if (!sourceId || !doc.nodes[sourceId]) return false;
  const frame = doc.nodes[frameId];
  if (!isMockupFrame(frame)) return false;
  const template = getMockupTemplate(doc, frame.mockup.templateId);
  if (!template?.surfaces.some((surface) => surface.id === surfaceId)) return false;
  const sourceDigest = computeMockupSourceDigest(doc, sourceId);
  const templateHash = template.contentHash;
  const capture = await captureMockupSourceSnapshot(doc, sourceId);
  if (!capture) return false;

  let committed = false;
  editor.beginTransaction();
  try {
    editor.updateDoc((current) => {
      let next = current;
      const frame = next.nodes[frameId];
      if (!isMockupFrame(frame)) return current;
      const currentTemplate = getMockupTemplate(next, frame.mockup.templateId);
      if (
        frame.mockup.templateId !== template.id ||
        currentTemplate?.contentHash !== templateHash ||
        computeMockupSourceDigest(next, sourceId) !== sourceDigest
      ) {
        return current;
      }
      let templateId = frame.mockup.templateId;
      const unique = makeMockupTemplateUnique(next, frameId);
      if (unique) {
        next = unique.document;
        templateId = unique.templateId;
      }
      const targetTemplate = getMockupTemplate(next, templateId);
      const placement = targetTemplate
        ? maskPlacementForCapture(next, frameId, targetTemplate, capture.sourceBounds)
        : undefined;
      if (!placement) return current;
      const { document: withAsset, assetId } = findOrCreateEmbeddedAsset(next, {
        dataUrl: capture.dataUrl,
        mimeType: 'image/png',
        naturalWidth: capture.width,
        naturalHeight: capture.height,
      });
      const key = kind === 'clip' ? 'clipMaskAssetId' : 'occlusionMaskAssetId';
      const placementKey = kind === 'clip' ? 'clipMaskPlacement' : 'occlusionMaskPlacement';
      const updated = updateMockupTemplate(withAsset, templateId, (t) => ({
        ...t,
        surfaces: t.surfaces.map((surface) =>
          surface.id === surfaceId
            ? {
                ...surface,
                [key]: assetId,
                [placementKey]: placement,
                maskOptions: surface.maskOptions ?? {},
              }
            : surface,
        ),
      }));
      committed = updated !== current;
      return updated;
    });
  } finally {
    editor.commitTransaction();
  }
  return committed;
}

/** Set per-mask interpretation controls on the instance-owned template. */
export function setSurfaceMaskOptions(
  editor: EditorContextValue,
  frameId: NodeId,
  surfaceId: string,
  kind: 'clip' | 'occlusion',
  options: MockupMaskOptions,
): boolean {
  const key = kind === 'clip' ? 'clipMaskOptions' : 'occlusionMaskOptions';
  return updatePrivateInstanceTemplate(editor, frameId, (t) => ({
    ...t,
    surfaces: t.surfaces.map((surface) =>
      surface.id === surfaceId
        ? { ...surface, [key]: { ...(surface[key] ?? surface.maskOptions ?? {}), ...options } }
        : surface,
    ),
  }));
}

/** Reset per-mask interpretation controls, retaining the embedded mask. */
export function resetSurfaceMaskOptions(
  editor: EditorContextValue,
  frameId: NodeId,
  surfaceId: string,
  kind: 'clip' | 'occlusion',
): boolean {
  const key = kind === 'clip' ? 'clipMaskOptions' : 'occlusionMaskOptions';
  return updatePrivateInstanceTemplate(editor, frameId, (t) => ({
    ...t,
    surfaces: t.surfaces.map((surface) =>
      surface.id === surfaceId ? { ...surface, [key]: undefined } : surface,
    ),
  }));
}

/** Rename a surface on the instance's (private) template. */
export function renameTemplateSurface(
  editor: EditorContextValue,
  frameId: NodeId,
  surfaceId: string,
  name: string,
): boolean {
  const doc = editor.state.document;
  const frame = doc.nodes[frameId];
  if (!isMockupFrame(frame)) return false;
  const templateId = frame.mockup.templateId;
  if (!doc.mockupTemplates?.[templateId]) return false;
  return updatePrivateInstanceTemplate(editor, frameId, (t) => ({
    ...t,
    surfaces: t.surfaces.map((surface) =>
      surface.id === surfaceId ? { ...surface, name: name.trim() } : surface,
    ),
  }));
}

/** Remove a template surface and the instance bindings/overrides for it. */
export function removeTemplateSurface(
  editor: EditorContextValue,
  frameId: NodeId,
  surfaceId: string,
): boolean {
  const doc = editor.state.document;
  const frame = doc.nodes[frameId];
  if (!isMockupFrame(frame)) return false;
  const templateId = frame.mockup.templateId;
  const template = doc.mockupTemplates?.[templateId];
  if (!template || template.surfaces.length <= 1) return false;
  return updatePrivateInstanceTemplate(
    editor,
    frameId,
    (t) => ({
      ...t,
      surfaces: t.surfaces.filter((surface) => surface.id !== surfaceId),
    }),
    (updated, _templateId) => {
      const updatedFrame = updated.nodes[frameId];
      if (!isMockupFrame(updatedFrame)) return updated;
      const bindings = { ...updatedFrame.mockup.surfaceBindings };
      delete bindings[surfaceId];
      const overrides = { ...updatedFrame.mockup.overrides };
      delete overrides[surfaceId];
      return {
        ...updated,
        nodes: {
          ...updated.nodes,
          [frameId]: {
            ...updatedFrame,
            mockup: {
              ...updatedFrame.mockup,
              surfaceBindings: bindings,
              overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
            },
          },
        },
      };
    },
  );
}

/** Reorder a template surface (draw/stack order) by one step. */
export function moveTemplateSurface(
  editor: EditorContextValue,
  frameId: NodeId,
  surfaceId: string,
  direction: -1 | 1,
): boolean {
  const doc = editor.state.document;
  const frame = doc.nodes[frameId];
  if (!isMockupFrame(frame)) return false;
  const templateId = frame.mockup.templateId;
  const template = doc.mockupTemplates?.[templateId];
  if (!template) return false;
  const index = template.surfaces.findIndex((surface) => surface.id === surfaceId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= template.surfaces.length) return false;
  return updatePrivateInstanceTemplate(editor, frameId, (t) => {
    const surfaces = [...t.surfaces];
    const [moved] = surfaces.splice(index, 1);
    if (!moved) return t;
    surfaces.splice(target, 0, moved);
    return { ...t, surfaces };
  });
}

/** Clear a surface mask reference on the instance's (private) template. */
export function clearSurfaceMask(
  editor: EditorContextValue,
  frameId: NodeId,
  surfaceId: string,
  kind: 'clip' | 'occlusion',
): boolean {
  const doc = editor.state.document;
  const frame = doc.nodes[frameId];
  if (!isMockupFrame(frame)) return false;
  const templateId = frame.mockup.templateId;
  if (!doc.mockupTemplates?.[templateId]) return false;
  const key = kind === 'clip' ? 'clipMaskAssetId' : 'occlusionMaskAssetId';
  const placementKey = kind === 'clip' ? 'clipMaskPlacement' : 'occlusionMaskPlacement';
  return updatePrivateInstanceTemplate(editor, frameId, (t) => ({
    ...t,
    surfaces: t.surfaces.map((surface) =>
      surface.id === surfaceId
        ? { ...surface, [key]: undefined, [placementKey]: undefined }
        : surface,
    ),
  }));
}
