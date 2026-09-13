/**
 * Mockup capture operations: freeze a live surface into an embedded snapshot,
 * and flatten a whole mockup into a single editable image node.
 *
 * Captures render through the same canonical pipeline as export
 * (`flattenSceneToEngine` → `Engine.buildIr` → `replayStructuredScene` +
 * `decorateMockupSubtree`), so the frozen pixels match what the canvas shows
 * at the document revision that was captured. Both operations are single
 * undoable transactions and never mutate the source artwork.
 */

import { createEngine, type Engine } from '@varve/engine';
import {
  addChild,
  addNode,
  type ContainerNode,
  type Document,
  type FrameNode,
  findOrCreateEmbeddedAsset,
  getMockupTemplate,
  imageFill,
  isMockupFrame,
  type MockupSourceBinding,
  makeImageShapeNode,
  moveChild,
  moveNode,
  type NodeId,
  nextNodeId,
  nodeWorldBounds,
  nodeWorldTransform,
  removeNode,
  setMockupBinding,
} from '@varve/scene';
import { tryInvertAffine } from '@varve/shared';
import type { EditorContextValue } from '../context';
import { settleEngineImageResources } from '../export/resourceReadiness';
import {
  collectMockupLiveSourceIds,
  decorateMockupSubtree,
  settleMockupSurfaces,
} from '../render/mockup/mockupExport';
import { replayStructuredScene } from '../render/replayScene';
import { flattenSceneToEngine } from '../render/sceneToEngine';

const MAX_CAPTURE_PX = 4096;

export interface MockupRasterCapture {
  dataUrl: string;
  width: number;
  height: number;
}

async function engineForCapture(): Promise<Engine> {
  return createEngine('auto');
}

/** Render one live source subtree at its world bounds into a PNG data URL. */
export async function captureMockupSourceSnapshot(
  doc: Document,
  sourceId: NodeId,
): Promise<MockupRasterCapture | null> {
  const bounds = nodeWorldBounds(doc, sourceId);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;
  const scale = Math.min(1, MAX_CAPTURE_PX / Math.max(bounds.w, bounds.h));
  const width = Math.max(1, Math.round(bounds.w * scale));
  const height = Math.max(1, Math.round(bounds.h * scale));

  const flattened = flattenSceneToEngine(doc, [sourceId]);
  await settleEngineImageResources(flattened.nodes, { signal: undefined });
  const engine = await engineForCapture();
  const ir = await engine.buildIr({ nodes: flattened.nodes });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  replayStructuredScene(ctx, {
    document: doc,
    rootIds: [sourceId],
    flattenedIds: flattened.ids,
    items: ir,
    quality: 'export',
  });
  try {
    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  } catch {
    return null;
  }
}

/**
 * Freeze a surface's current live source into an embedded snapshot asset.
 * The snapshot keeps the surface's fit/alignment, so later fit changes still
 * apply to the frozen image instead of double-fitting baked pixels.
 */
export async function snapshotMockupSurface(
  editor: EditorContextValue,
  frameId: NodeId,
  surfaceId: string,
): Promise<boolean> {
  const doc = editor.state.document;
  const frame = doc.nodes[frameId];
  if (!isMockupFrame(frame)) return false;
  const binding = frame.mockup.surfaceBindings[surfaceId];
  if (binding?.mode !== 'live' || !binding.nodeId) return false;
  const capture = await captureMockupSourceSnapshot(doc, binding.nodeId);
  if (!capture) return false;

  editor.beginTransaction();
  try {
    editor.updateDoc((current) => {
      const { document: withAsset, assetId } = findOrCreateEmbeddedAsset(current, {
        dataUrl: capture.dataUrl,
        mimeType: 'image/png',
        naturalWidth: capture.width,
        naturalHeight: capture.height,
      });
      return setMockupBinding(withAsset, frameId, surfaceId, {
        mode: 'snapshot',
        assetId,
        capturedWidth: capture.width,
        capturedHeight: capture.height,
      });
    });
  } finally {
    editor.commitTransaction();
  }
  return true;
}

/** Reconnect a surface to a live node (default: the current selection). */
export function reconnectMockupSurface(
  editor: EditorContextValue,
  frameId: NodeId,
  surfaceId: string,
  sourceId?: NodeId,
): boolean {
  const selection = sourceId ? [sourceId] : editor.state.selection.filter((id) => id !== frameId);
  const nodeId = selection[0];
  if (!nodeId) return false;
  editor.beginTransaction();
  try {
    editor.updateDoc((doc) => setMockupBinding(doc, frameId, surfaceId, { mode: 'live', nodeId }));
  } finally {
    editor.commitTransaction();
  }
  return true;
}

/**
 * Flatten a mockup instance into a single image shape node at the template's
 * output resolution. Explicit and undoable: the result is raster content, not
 * editable vector art, and the mockup payload is gone.
 */
export async function flattenMockupToImage(
  editor: EditorContextValue,
  frameId: NodeId,
): Promise<boolean> {
  const doc = editor.state.document;
  const frame = doc.nodes[frameId];
  if (!isMockupFrame(frame)) return false;
  const template = getMockupTemplate(doc, frame.mockup.templateId);
  if (!template) return false;

  const sourceIds = collectMockupLiveSourceIds(doc, [frameId]);
  const flattened = flattenSceneToEngine(doc, [frameId, ...sourceIds]);
  const settlement = await settleEngineImageResources(flattened.nodes, { signal: undefined });
  if (settlement.status === 'cancelled') return false;
  const engine = await engineForCapture();
  const ir = await engine.buildIr({ nodes: flattened.nodes });
  const decoration = decorateMockupSubtree({
    doc,
    rootIds: [frameId, ...sourceIds],
    flattenedIds: flattened.ids,
    items: ir,
    qualityScale: 1,
    insertIntoList: false,
  });
  await settleMockupSurfaces(decoration.extrasByNodeId);

  const scale = Math.min(1, MAX_CAPTURE_PX / Math.max(1, frame.w, frame.h));
  const width = Math.max(1, Math.round(frame.w * scale));
  const height = Math.max(1, Math.round(frame.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  // World -> frame-local (inverse of the frame's world transform), then
  // template units -> canvas pixels.
  const world = nodeWorldTransform(doc, frameId);
  const inverse = tryInvertAffine(world);
  if (!inverse) return false;
  const [ia, ib, ic, id, ie, if_] = inverse;
  ctx.setTransform(ia * scale, ib * scale, ic * scale, id * scale, ie * scale, if_ * scale);
  replayStructuredScene(ctx, {
    document: doc,
    rootIds: [frameId],
    flattenedIds: flattened.ids,
    items: ir,
    extrasByNodeId: decoration.extrasByNodeId,
    quality: 'export',
  });

  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    return false;
  }

  const parent = findParentId(doc, frameId);
  editor.beginTransaction();
  try {
    editor.updateDoc((current) => {
      const { document: withAsset, assetId } = findOrCreateEmbeddedAsset(current, {
        dataUrl,
        mimeType: 'image/png',
        naturalWidth: width,
        naturalHeight: height,
      });
      const asset = withAsset.assets?.[assetId];
      if (!asset) return withAsset;
      const withId = nextNodeId(withAsset);
      const image = makeImageShapeNode(withId.id, {
        name: `${template.name} (flattened)`,
        transform: frame.transform,
        fill: frame.fill,
        w: frame.w,
        h: frame.h,
        rotation: frame.rotation,
        opacity: frame.opacity,
        blendMode: frame.blendMode,
        shapeless: false,
        imageWidth: width,
        imageHeight: height,
      });
      const withFill = {
        ...image,
        fills: [
          imageFill(asset.dataUrl, {
            assetId,
            fit: 'fill',
            imageWidth: width,
            imageHeight: height,
          }),
        ],
      };
      const inserted = parent
        ? addChild(withId.doc, parent, withFill)
        : addNode(withId.doc, withFill);
      const frameIndex = parent
        ? (inserted.nodes[parent] as ContainerNode).children.indexOf(frameId)
        : inserted.rootChildren.indexOf(frameId);
      const moved =
        frameIndex >= 0
          ? parent
            ? moveChild(inserted, parent, withId.id, frameIndex)
            : moveNode(inserted, withId.id, frameIndex)
          : inserted;
      return removeNode(moved, frameId);
    });
  } finally {
    editor.commitTransaction();
  }
  return true;
}

function findParentId(doc: Document, nodeId: NodeId): NodeId | null {
  for (const node of Object.values(doc.nodes)) {
    if (node && 'children' in node && node.children.includes(nodeId)) return node.id;
  }
  return null;
}

/**
 * Duplicate a mockup instance.
 *
 * - `linked`: the copy shares the original live source nodes.
 * - `independent`: the copy captures each currently bound source into an
 *   embedded snapshot so later source edits no longer reach it. Explicit and
 *   undoable — the original instance is untouched.
 */
export async function duplicateMockupInstance(
  editor: EditorContextValue,
  frameId: NodeId,
  mode: 'linked' | 'independent',
): Promise<NodeId | null> {
  const doc = editor.state.document;
  const frame = doc.nodes[frameId];
  if (!isMockupFrame(frame)) return null;

  const snapshots = new Map<NodeId, MockupRasterCapture>();
  if (mode === 'independent') {
    const sourceIds = [
      ...new Set(
        Object.values(frame.mockup.surfaceBindings)
          .filter((binding) => binding.mode === 'live' && binding.nodeId)
          .map((binding) => binding.nodeId as NodeId),
      ),
    ];
    for (const sourceId of sourceIds) {
      const capture = await captureMockupSourceSnapshot(doc, sourceId);
      if (capture) snapshots.set(sourceId, capture);
    }
  }

  const parent = findParentId(doc, frameId);
  const { id: newId } = nextNodeId(doc);
  editor.beginTransaction();
  try {
    editor.updateDoc((current) => {
      const currentFrame = current.nodes[frameId];
      if (!isMockupFrame(currentFrame)) return current;
      let next = current;
      const bindings: Record<string, MockupSourceBinding> = {};
      for (const [surfaceId, binding] of Object.entries(currentFrame.mockup.surfaceBindings)) {
        const capture = binding.nodeId ? snapshots.get(binding.nodeId) : undefined;
        if (capture) {
          const { document: withAsset, assetId } = findOrCreateEmbeddedAsset(next, {
            dataUrl: capture.dataUrl,
            mimeType: 'image/png',
            naturalWidth: capture.width,
            naturalHeight: capture.height,
          });
          next = withAsset;
          bindings[surfaceId] = {
            mode: 'snapshot',
            assetId,
            capturedWidth: capture.width,
            capturedHeight: capture.height,
          };
        } else {
          bindings[surfaceId] = binding;
        }
      }
      const transform = currentFrame.transform;
      const clone: FrameNode = {
        ...currentFrame,
        id: newId,
        name: `${currentFrame.name} copy`,
        transform: [
          transform[0],
          transform[1],
          transform[2],
          transform[3],
          transform[4] + 24,
          transform[5] + 24,
        ],
        mockup: {
          ...currentFrame.mockup,
          surfaceBindings: bindings,
          overrides: currentFrame.mockup.overrides
            ? { ...currentFrame.mockup.overrides }
            : undefined,
          createdAt: Date.now(),
        },
      };
      const inserted = parent ? addChild(next, parent, clone) : addNode(next, clone);
      const index = parent
        ? (inserted.nodes[parent] as ContainerNode).children.indexOf(frameId)
        : inserted.rootChildren.indexOf(frameId);
      if (index < 0) return inserted;
      return parent
        ? moveChild(inserted, parent, newId, index + 1)
        : moveNode(inserted, newId, index + 1);
    });
  } finally {
    editor.commitTransaction();
  }
  editor.setSelection(newId);
  return newId;
}
