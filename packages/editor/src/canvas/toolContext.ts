import type { Engine } from '@varve/engine';
import {
  addNode,
  buildParentIndexMap,
  getGuidesForPage,
  makeRasterLayerNode,
  type NodeId,
  nextNodeId,
  type SceneNode,
} from '@varve/scene';
import type { Camera } from '@varve/shared';
import type { EditorContextValue, EditorState } from '../context';
import { HitTestEngine } from '../hitTest/HitTestEngine';
import {
  type FrameSpatialIndex,
  getOrCreateSpatialIndex,
  queryRect,
  type SpatialIndex,
} from '../scene/spatialIndex';
import {
  getWorldBounds as getCachedWorldBounds,
  type TransformCache,
} from '../scene/transformCache';
import { nodeWorldBounds } from '../scene/world';
import type { DraftShape, ToolContext } from '../tools';
import type { collectSourceEvents } from '../tools/inputNormalizer';
import {
  createSnapSession,
  filterSnapTargets,
  pageSnapTargets,
  type SnapGuide,
  type SnapSession,
  snapPosition,
  snapTargetSearchRect,
} from '../tools/snapping';
import { applyWarpToSelection } from '../warp/warpActions';
import { parseGridTemplate } from './gridTemplate';
import { beginInteractionSpan, isSnapMetricsEnabled, recordSnapMetrics } from './perfRuntime';

/** Stable empty-guides identity: most drag samples snap to nothing, and a
 *  fresh array per sample would re-render the guides overlay pointlessly. */
const EMPTY_SNAP_GUIDES: readonly SnapGuide[] = Object.freeze([]);

export interface DeepSelectionCandidateSet {
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
  candidates: Array<{ nodeId: NodeId; node: SceneNode; depth: number }>;
}

interface SnapIndexEntry {
  index: SpatialIndex;
  parentIndex: Map<string, string>;
  documentId: string;
  indexedNodeCount: number;
}

export interface CanvasRect {
  left: number;
  top: number;
}

export interface ToolContextDeps {
  stateRef: React.MutableRefObject<EditorState>;
  editorRef: React.MutableRefObject<EditorContextValue>;
  engineRef: React.MutableRefObject<Engine | null>;
  contentCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  canvasRectRef: React.MutableRefObject<CanvasRect>;
  frameIndexRef: React.MutableRefObject<FrameSpatialIndex | null>;
  transformCacheRef: React.MutableRefObject<TransformCache>;
  snapSessionRef: React.MutableRefObject<SnapSession>;
  snapIndexRef: React.MutableRefObject<SnapIndexEntry | null>;
  pendingAutoTextEditRef: React.MutableRefObject<boolean>;
  nodeEditTargetId: string | null;
  setDraft: (draft: DraftShape | null) => void;
  setDropTargetFrameId: (id: NodeId | null) => void;
  setSnapGuides: (guides: SnapGuide[]) => void;
  setDeepSelectionCandidates: (candidates: DeepSelectionCandidateSet | null) => void;
  setNodeEditTargetId: (id: string | null) => void;
  setNodeEditSelectedAnchors: (anchors: ReadonlySet<number>) => void;
  setTextEditTargetId: (id: string | null) => void;
  commitCamera: (camera: Camera) => void;
  rootNodes: () => SceneNode[];
}

/**
 * Builds a ToolContext for a pointer event. Pure function of the deps and the
 * event — the CanvasArea closure that used to capture all of the above is
 * replaced by the explicit `deps` object, so tool-input wiring is testable
 * without mounting the canvas shell.
 */
export function buildToolContext(
  deps: ToolContextDeps,
  ev: PointerEvent,
  sourceEvents: ReturnType<typeof collectSourceEvents> = [],
): ToolContext {
  const s = deps.stateRef.current;
  const e = deps.editorRef.current;
  const eng = deps.engineRef.current;
  return {
    document: s.document,
    selection: s.selection,
    zoom: s.zoom,
    pan: s.pan,
    shiftKey: ev.shiftKey,
    altKey: ev.altKey,
    ctrlKey: ev.ctrlKey,
    metaKey: ev.metaKey,
    pointerType: (ev.pointerType as 'mouse' | 'pen' | 'touch') ?? 'mouse',
    pointerPressure: ev.pressure ?? 0,
    tiltX: ev.tiltX ?? 0,
    tiltY: ev.tiltY ?? 0,
    twist: ev.twist ?? 0,
    tangentialPressure:
      (ev as PointerEvent & { tangentialPressure?: number }).tangentialPressure ?? 0,
    pointerWidth: Math.max(0, (ev as PointerEvent & { width?: number }).width ?? 1),
    pointerHeight: Math.max(0, (ev as PointerEvent & { height?: number }).height ?? 1),
    altitudeAngle: (ev as PointerEvent & { altitudeAngle?: number }).altitudeAngle ?? Math.PI / 2,
    azimuthAngle: (ev as PointerEvent & { azimuthAngle?: number }).azimuthAngle ?? 0,
    hasCoalescedEvents: typeof ev.getCoalescedEvents === 'function',
    hasPredictedEvents: typeof ev.getPredictedEvents === 'function',
    sourceEvents,
    foregroundColor: s.foregroundColor,
    maskPreviewMode: s.maskPreviewMode,
    setMaskPreviewMode: (mode) => e.setMaskPreviewMode(mode),
    snapEnabled: s.snapEnabled,
    snapGrid: s.snapGrid,
    isolatedNodeId: s.isolatedNodeId,
    enterIsolation: (nodeId) => e.enterIsolation(nodeId),
    exitIsolation: () => e.exitIsolation(),

    createShapeAt: (world, size, parentId, pathPoints, pathClosed) =>
      e.createShapeAt(world, size, parentId, pathPoints, pathClosed),
    createTextNodeAt: (world, size, parentId, text) => {
      deps.pendingAutoTextEditRef.current = true;
      e.createTextNodeAt(world, size, parentId, text);
    },
    setSelection: (id) => e.setSelection(id),
    toggleSelection: (id, additive) => e.toggleSelection(id, additive),
    isSelected: (id) => e.isSelected(id),
    setNodePosition: (id, x, y) => e.setNodePosition(id, x, y),
    setNodePositions: (positions) => e.setNodePositions(positions),
    setNodeSize: (id, w, h) => e.setNodeSize(id, w, h),
    updateNode: (id, updater) => e.updateNode(id, updater),
    updateNodes: (updaters) => e.updateNodes(updaters),
    setActivePage: (pageId) => e.setActivePage(pageId),
    movePageOnPasteboard: (pageId, x, y) => e.movePageOnPasteboard(pageId, x, y),
    resizePage: (pageId, w, h) => e.resizePage(pageId, w, h),
    removeSelected: () => e.removeSelected(),
    duplicateSelected: () => e.duplicateSelected(),
    reparentNode: (id, newParentId, toIndex) => e.reparentNode(id, newParentId, toIndex),
    setCamera: (camera) => deps.commitCamera(camera),
    setPan: (p) => e.setPan(p),
    setZoom: (z) => e.setZoom(z),
    announce: (msg) => e.announce(msg),
    announceSelection: (selected) => e.announceSelection(selected),
    announceOperation: (op, result) => e.announceOperation(op, result),
    setDraft: deps.setDraft,
    rootNodes: () => deps.rootNodes(),
    getNode: (id) => s.document.nodes[id],

    // FIX: `canvasToWorld` now accepts viewport-relative clientX/Y and
    // subtracts the canvas bounding rect internally. This fixes the
    // placement bug where all drawing tools passed raw clientX/Y without
    // accounting for the canvas element's screen offset below the menubar.
    // See BaseTool.ts:66-67.
    canvasToWorld: (cx, cy) => {
      const rect = deps.canvasRectRef.current;
      return e.canvasToWorld(cx - rect.left, cy - rect.top);
    },
    worldToCanvas: (wx, wy) => e.worldToCanvas(wx, wy),
    canvasDeltaToWorld: (dx, dy) => e.canvasDeltaToWorld(dx, dy),

    setPointerCapture: (pointerId) => {
      try {
        const el = deps.contentCanvasRef.current;
        if (el) el.setPointerCapture(pointerId);
      } catch (err) {
        // If this throws, BaseTool.onPointerDown aborts before setting
        // drag.kind = 'dragging', silently breaking every drag-to-create
        // tool (pointermove is a no-op while drag.kind stays 'idle').
        // Surface it instead of failing silently.
        if (typeof console !== 'undefined') {
          console.warn('[Strata] setPointerCapture failed:', err);
        }
      }
    },
    releasePointerCapture: (pointerId) => {
      try {
        const el = deps.contentCanvasRef.current;
        if (el) el.releasePointerCapture(pointerId);
      } catch {
        // Pointer may have been released by the browser already (e.g. blur
        // during paste). Silently ignore — no functional impact.
      }
    },

    findContainingFrame: (world) => e.findContainingFrame(world, deps.frameIndexRef.current),
    setDropTargetFrame: deps.setDropTargetFrameId,
    nodeWorldBounds: (n) =>
      getCachedWorldBounds(deps.transformCacheRef.current, s.document, n.id) ??
      nodeWorldBounds(s.document, n.id),

    engine: eng,
    canvasElement: deps.contentCanvasRef.current,
    hitTest: (world) => e.hitTestNode(world),
    hitTestWithPolicy: (world, policyName) => e.hitTestNodeWithPolicy(world, policyName),

    beginTransaction: () => e.beginTransaction(),
    commitTransaction: () => e.commitTransaction(),
    abortTransaction: () => e.abortTransaction(),

    setTool: (id) => e.setTool(id),
    setWarpEdit: (target) => e.setWarpEdit(target),
    applyWarpToSelection: (presetKind) => applyWarpToSelection(e, presetKind),
    setFocusedNode: (id) => e.setFocusedNode(id),
    clearFocusedNode: () => e.clearFocusedNode(),
    focusNextSelectedNode: () => e.focusNextSelectedNode(),
    focusPreviousSelectedNode: () => e.focusPreviousSelectedNode(),
    nodeEditTargetId: deps.nodeEditTargetId,
    setNodeEditTargetId: deps.setNodeEditTargetId,
    setNodeEditSelectedAnchors: deps.setNodeEditSelectedAnchors,
    setTextEditTargetId: deps.setTextEditTargetId,
    setTableEdit: (state) => e.setTableEdit(state),

    snapPosition: (bounds, _targets) => {
      if (!s.snapEnabled) {
        deps.snapSessionRef.current = createSnapSession();
        return { x: bounds.x, y: bounds.y, guides: [] };
      }
      const snapMetricsOn = isSnapMetricsEnabled();
      const snapStart = snapMetricsOn ? performance.now() : 0;
      const finishSnapPrefilter = beginInteractionSpan('snap.prefilter');

      // D-02: Spatial + hierarchical filtering of snap targets
      const doc = deps.stateRef.current.document;
      let snapIndex = deps.snapIndexRef.current;
      if (!snapIndex || snapIndex.documentId !== doc.id) {
        snapIndex = {
          index: getOrCreateSpatialIndex(doc, null),
          parentIndex: buildParentIndexMap(doc),
          documentId: doc.id,
          indexedNodeCount: Object.keys(doc.nodes).length,
        };
        deps.snapIndexRef.current = snapIndex;
      }
      const queryStart = snapMetricsOn ? performance.now() : 0;
      const nearbyIds = queryRect(snapIndex.index, snapTargetSearchRect(bounds, s.zoom));
      const queryDurationMs = snapMetricsOn ? performance.now() - queryStart : 0;
      const nearbyBoundsWithIds: Array<{
        nodeId: string;
        bounds: { x: number; y: number; w: number; h: number };
      }> = [];
      for (const nodeId of nearbyIds) {
        const node = doc.nodes[nodeId];
        if (!node) continue;
        // Semantic filter: hidden nodes are not visible, so snapping to their
        // edges would produce invisible feedback — exclude them as candidates.
        if (node.visible === false) continue;
        // Read through the transform cache rather than recomputing. This runs
        // on every pointer move of a drag, and the uncached nodeWorldBounds
        // re-derives a group's bounds by unioning all of its children every
        // time — a 932-node drag profile attributed 7.6% of CPU to
        // groupWorldBounds reached from here. The cache invalidates exactly
        // the nodes an edit touched, so during a drag only the dragged node
        // recomputes and the surrounding snap targets stay cached.
        const b =
          getCachedWorldBounds(deps.transformCacheRef.current, doc, node.id) ??
          nodeWorldBounds(doc, node.id);
        if (b) nearbyBoundsWithIds.push({ nodeId: node.id, bounds: b });
      }
      const parentIdx = snapIndex.parentIndex;
      const selection = deps.stateRef.current.selection;
      const draggedId = selection[0] ?? '';
      const filtered = filterSnapTargets(
        bounds,
        { zoom: s.zoom },
        nearbyBoundsWithIds,
        parentIdx,
        draggedId,
        // Semantic filter: every object moving in the same selection is an
        // invalid target — snapping a multi-selection against its own members
        // both wastes evaluation and produces incorrect guides.
        selection.length > 1 ? new Set(selection) : undefined,
      );
      finishSnapPrefilter({
        indexedCandidates: snapIndex.indexedNodeCount,
        broadPhaseCandidates: nearbyIds.size,
        semanticCandidates: filtered.length,
      });

      // Page trim snap targets (M6): every placed page's trim bounds, so
      // nodes snap to page edges on any page of the pasteboard — not only
      // the active page's trim at the origin.
      const pageBoundsTargets = pageSnapTargets(doc);
      if (draggedId) {
        const parentId = parentIdx.get(draggedId);
        if (parentId) {
          const parentNode = doc.nodes[parentId];
          if (parentNode && 'w' in parentNode) {
            // The parent frame's edges are only a valid snap reference in
            // world space. Its stored rect is frame-local ({0,0,w,h}), which
            // coincides with world only for identity frames — a translated/
            // rotated/scaled parent would emit wrong guides. World bounds
            // compose the full ancestor chain.
            const parentWorldBounds = nodeWorldBounds(doc, parentId);
            if (parentWorldBounds) {
              pageBoundsTargets.push({
                x: parentWorldBounds.x,
                y: parentWorldBounds.y,
                w: parentWorldBounds.w,
                h: parentWorldBounds.h,
              });
            }
          }
        }
      }

      let layoutGridStep: number | undefined;
      if (draggedId) {
        const parentId = parentIdx.get(draggedId);
        if (parentId) {
          const parentNode = doc.nodes[parentId];
          if (parentNode?.kind === 'frame' && parentNode.layoutStyle) {
            const cols = parseGridTemplate(
              parentNode.layoutStyle.gridTemplateColumns ?? '',
              parentNode.w,
            );
            if (cols.length > 0) {
              layoutGridStep =
                cols[0]! + (parentNode.layoutStyle.columnGap ?? parentNode.layoutStyle.gap ?? 0);
            }
          }
        }
      }

      const allTargets = [...filtered, ...pageBoundsTargets];
      const guideTargets =
        getGuidesForPage(doc, doc.activePageId).map((guide) => ({
          axis: guide.axis,
          position: guide.position,
        })) ?? [];
      const gridConfig = s.snapEnabled && s.documentGrid?.snapEnabled ? s.documentGrid : undefined;
      const finishSnapEvaluate = beginInteractionSpan('snap.evaluate');
      const result = snapPosition(
        bounds.x,
        bounds.y,
        bounds.w,
        bounds.h,
        allTargets,
        gridConfig,
        undefined,
        {
          zoom: s.zoom,
          session: deps.snapSessionRef.current,
          guideTargets,
          layoutGridStep,
          pixelGridSnap: s.snapEnabled && s.pixelGridSnapEnabled,
        },
      );
      deps.snapSessionRef.current = result.session;
      // A fresh array identity on every sample forces the SnapGuidesOverlay
      // re-render even when nothing snapped. Most drag samples produce no
      // guides; reuse the stable empty array so those renders are skipped.
      deps.setSnapGuides(
        result.guides.length === 0 ? (EMPTY_SNAP_GUIDES as SnapGuide[]) : result.guides,
      );
      finishSnapEvaluate({
        finePhaseCandidates: allTargets.length,
        winningX: result.x !== bounds.x,
        winningY: result.y !== bounds.y,
      });
      if (snapMetricsOn) {
        recordSnapMetrics({
          ts: performance.now(),
          sceneObjectCount: snapIndex.indexedNodeCount,
          indexedCandidateCount: snapIndex.indexedNodeCount,
          broadPhaseResultCount: nearbyIds.size,
          semanticFilteredCount: filtered.length,
          finePhaseEvalCount: allTargets.length,
          queryDurationMs,
          evalDurationMs: performance.now() - snapStart,
          winningX: result.x !== bounds.x,
          winningY: result.y !== bounds.y,
        });
      }
      return { x: result.x, y: result.y, guides: result.guides };
    },
    isSnapExcluded: (id: string) => {
      const n = deps.stateRef.current.document.nodes[id];
      return n?.snapExcluded === true;
    },

    getTrimapData: (nodeId) => e.getTrimapData(nodeId),
    setTrimapPreview: (trimap, width, height) => {
      const nodeId = s.selection[0];
      if (nodeId) e.setTrimapData(nodeId, trimap, width, height);
    },
    commitTrimapEdit: (trimap) => {
      const nodeId = s.selection[0];
      if (!nodeId) return;
      const entry = e.getTrimapData(nodeId);
      if (entry) e.setTrimapData(nodeId, trimap, entry.width, entry.height);
    },
    applySam2Segmentation: (params) => e.applySam2Segmentation(params),
    cancelSam2Segmentation: () => e.cancelSam2Segmentation(),
    commitRasterMask: (nodeId, dataUrl, width, height, coordinateSpace) => {
      import('../backgroundRemoval/commitRasterMask').then(({ commitRasterMask }) => {
        e.updateDoc((doc) =>
          commitRasterMask(doc, nodeId, { dataUrl, width, height, coordinateSpace }),
        );
      });
    },
    createRasterLayer: (width, height) => {
      const s2 = deps.stateRef.current;
      const { id, doc: d2 } = nextNodeId(s2.document);
      const layer = makeRasterLayerNode(id, { width, height }, { name: 'Brush Layer' });
      const newDoc = addNode(d2, layer);
      e.updateDoc(() => newDoc);
      return id;
    },
    lastPointerEvent: ev,
    touchMultiSelect: s.touchMultiSelect,
    showDeepSelectionMenu: (world, screenX, screenY) => {
      // Gather all nodes beneath the touch point using touch policy
      const hitEngine = HitTestEngine.withPolicy(
        deps.stateRef.current.document,
        'touchDeepSelect',
        {
          zoom: deps.stateRef.current.zoom,
          isolatedNodeId: deps.stateRef.current.isolatedNodeId,
        },
      );
      const candidates = hitEngine.findNodesAtPoint(world);
      if (candidates.length > 1) {
        deps.setDeepSelectionCandidates({
          worldX: world.x,
          worldY: world.y,
          screenX,
          screenY,
          candidates: candidates.map((c) => ({
            nodeId: c.nodeId,
            node: c.node,
            depth: 0,
          })),
        });
      }
    },
  };
}
