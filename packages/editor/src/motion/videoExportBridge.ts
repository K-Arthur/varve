/**
 * Video export bridge — document + timeline → per-frame IR replay on OffscreenCanvas.
 *
 * Keeps @strata/engine free of editor deps; wires sampleTimelineAt → buildIr → replayIr.
 *
 * Research basis: ADR-0001 IR-replay, CanvasArea.drawContent motion path.
 */

import { computeDocumentBounds } from '@strata/codegen';
import {
  applyStyleOverrides,
  createEngine,
  type SceneNode as EngineNode,
  type ReplayTarget,
  replayIr,
} from '@strata/engine';
import type { Document, NodeId, Timeline } from '@strata/scene';
import {
  applyBindingsToNode,
  buildAllVariantCaches,
  createVariableStore,
  getEffectiveNode,
  resolveAllStyles,
  walkNodes,
} from '@strata/scene';
import { fitBoundsCamera, type Rect } from '@strata/shared';
import { applyPropertyPath, toEngineNode } from '../CanvasArea';
import { nodeWorldTransform } from '../scene/world';
import { sampleTimelineAt } from '../timeline/TimelineSampler';

export type VideoExportBoundsMode = 'page' | 'selection' | 'canvas';

export interface VideoExportBridgeOptions {
  width: number;
  height: number;
  boundsMode?: VideoExportBoundsMode;
  /** Used when boundsMode is `selection`. */
  selectionIds?: NodeId[];
  /** Active page content root when boundsMode is `page`. */
  pageContentRoot?: NodeId;
  backgroundColor?: string;
}

export interface VideoExportBridgeConfig {
  doc: Document;
  timeline: Timeline;
  options: VideoExportBridgeOptions;
}

/** Resolve world-space export bounds from document + mode. */
export function resolveVideoExportBounds(
  doc: Document,
  mode: VideoExportBoundsMode,
  selectionIds: NodeId[] = [],
  pageContentRoot?: NodeId,
): Rect {
  if (mode === 'canvas') {
    return {
      x: 0,
      y: 0,
      w: doc.canvasWidth ?? 1920,
      h: doc.canvasHeight ?? 1080,
    };
  }

  if (mode === 'page' && pageContentRoot) {
    const pageNode = doc.nodes[pageContentRoot];
    if (pageNode?.kind === 'group' || pageNode?.kind === 'frame') {
      const world = nodeWorldTransform(doc, pageContentRoot);
      const w = pageNode.kind === 'frame' ? pageNode.w : 1920;
      const h = pageNode.kind === 'frame' ? pageNode.h : 1080;
      return { x: world[4], y: world[5], w, h };
    }
  }

  if (mode === 'selection' && selectionIds.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of selectionIds) {
      const world = nodeWorldTransform(doc, id);
      minX = Math.min(minX, world[4]);
      minY = Math.min(minY, world[5]);
      maxX = Math.max(maxX, world[4] + 100);
      maxY = Math.max(maxY, world[5] + 80);
    }
    if (Number.isFinite(minX)) {
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }

  const bounds = computeDocumentBounds(doc);
  return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
}

function flattenVisibleNodes(doc: Document): { ids: string[]; nodes: EngineNode[] } {
  const variantCaches = buildAllVariantCaches(doc);
  const variableStore = doc.variableStore ?? createVariableStore();
  const entries = walkNodes(doc);
  const ids: string[] = [];
  const nodes: EngineNode[] = [];

  for (const [id] of entries) {
    const raw = doc.nodes[id];
    if (!raw?.visible) continue;
    if (raw.kind === 'group') continue;
    let n = getEffectiveNode(doc, id, variantCaches) ?? raw;
    n = applyBindingsToNode(n, variableStore);
    const world = nodeWorldTransform(doc, id);
    ids.push(id);
    nodes.push({ ...toEngineNode(n), transform: world });
  }

  const resolvedStyles = resolveAllStyles(doc);
  if (resolvedStyles.size > 0) {
    for (let i = 0; i < nodes.length; i++) {
      const nodeId = ids[i];
      if (!nodeId) continue;
      const overrides = resolvedStyles.get(nodeId);
      if (!overrides) continue;
      const fn = nodes[i];
      if (!fn) continue;
      nodes[i] = applyStyleOverrides(fn, overrides);
    }
  }

  return { ids, nodes };
}

function applyTimelineOverrides(
  doc: Document,
  timelineId: string,
  timeMs: number,
  nodeIds: string[],
  flatNodes: EngineNode[],
): void {
  const sample = sampleTimelineAt(doc, timelineId, timeMs);
  if (sample.overrides.size === 0) return;
  for (let i = 0; i < flatNodes.length; i++) {
    const nodeId = nodeIds[i];
    if (!nodeId) continue;
    const props = sample.overrides.get(nodeId);
    if (!props) continue;
    const fn = flatNodes[i];
    if (!fn) continue;
    for (const [prop, val] of props) {
      applyPropertyPath(fn as unknown as Record<string, unknown>, prop, val);
    }
  }
}

/**
 * Create a frame renderer callback for {@link exportTimelineToVideo}.
 */
export async function createVideoFrameRenderer(config: VideoExportBridgeConfig) {
  const { doc, timeline, options } = config;
  const bounds = resolveVideoExportBounds(
    doc,
    options.boundsMode ?? 'canvas',
    options.selectionIds ?? [],
    options.pageContentRoot,
  );
  const viewport = { width: options.width, height: options.height };
  const camera = fitBoundsCamera(bounds, viewport, 0);
  const engine = await createEngine('stub');
  const bg = options.backgroundColor ?? '#ffffff';

  function createExportCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
    if (typeof OffscreenCanvas !== 'undefined') {
      const oc = new OffscreenCanvas(w, h);
      if (oc.getContext('2d')) return oc;
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  const canvas = createExportCanvas(options.width, options.height);

  const sampledTimes: number[] = [];

  const renderFrame = async (timeMs: number, _frameIndex: number): Promise<Uint8Array> => {
    sampledTimes.push(timeMs);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');

    const { ids, nodes } = flattenVisibleNodes(doc);
    applyTimelineOverrides(doc, timeline.id, timeMs, ids, nodes);

    const ir = await engine.buildIr({ nodes });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, options.width, options.height);
    ctx.setTransform(camera.zoom, 0, 0, camera.zoom, camera.pan.x, camera.pan.y);
    replayIr(ctx as unknown as ReplayTarget, ir);

    const imageData = ctx.getImageData(0, 0, options.width, options.height);
    return new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.length);
  };

  return { renderFrame, sampledTimes, bounds, camera };
}

/** Export helper returning sampled times (for tests). */
export async function renderVideoFrameAtTime(
  config: VideoExportBridgeConfig,
  timeMs: number,
): Promise<{ rgba: Uint8Array; sampledAt: number }> {
  const { renderFrame } = await createVideoFrameRenderer(config);
  const rgba = await renderFrame(timeMs, 0);
  return { rgba, sampledAt: timeMs };
}
