/**
 * TransformEngine — scene-aware transform orchestration for the selection overlay.
 *
 * Applies a single delta matrix to all selected nodes, derived from a selection
 * box that is resized, rotated, or moved. The delta matrix is computed as
 * `M_new · M_old⁻¹` (Konva/pixi-transformer pattern) and applied to each node's
 * initial world transform. This unifies resize, rotate, and multi-select scale
 * into one matrix operation.
 *
 * Research basis:
 * - Konva Transformer: applies a single transform to all selected nodes.
 * - pixi-transformer: computes a delta matrix from old selection box to new.
 * - Figma: relativeTransform carries rotation/translation, geometry is separate.
 */

import type { PathPoint, Shape } from '@strata/engine';
import type { Document, NodeId, SceneNode, ShapeNode } from '@strata/scene';
import { applyConstraints, getParent } from '@strata/scene';
import type { Affine, Point, Rect } from '@strata/shared';
import {
  applyAffine,
  boxDeltaMatrix,
  computeSelectionBox,
  identity,
  multiplyAffine,
  type ResizeHandle,
  type ResizeOptions,
  resizeSelectionBox,
  rotateRad,
  rotateSelectionBox,
  type SelectionBox,
  translate,
  tryInvertAffine,
} from '@strata/shared';
import { resizeNodeGeometry } from '../scene/resizeGeometry';
import { nodeLocalBounds, nodeWorldBounds, nodeWorldTransform } from '../scene/world';

export interface TransformNodeState {
  id: NodeId;
  node: SceneNode;
  initialWorldTransform: Affine;
  parentWorldTransform: Affine;
  parentWorldInverse: Affine | null;
  initialLocalRect: Rect;
  isRaster: boolean;
}

export interface TransformOptions {
  /** Optional snap function applied to the new selection box before delta. */
  snapBox?: (box: SelectionBox) => SelectionBox;
  /** When true, commit() bakes vector geometry into shape/frame properties. */
  bakeOnCommit?: boolean;
}

export class TransformEngine {
  private readonly doc: Document;
  private readonly selectedIds: NodeId[];
  private readonly options: TransformOptions;
  private readonly initialStates: Map<NodeId, TransformNodeState>;
  private readonly initialBox: SelectionBox;
  private lastDelta: Affine = identity;

  constructor(doc: Document, selectedIds: NodeId[], options: TransformOptions = {}) {
    this.doc = doc;
    this.selectedIds = selectedIds;
    this.options = options;
    this.initialStates = this.buildInitialStates();
    this.initialBox = this.computeBoxFromDoc(doc);
  }

  getInitialBox(): SelectionBox {
    return this.initialBox;
  }

  /** True when every selected node is a raster (image/pattern fill) node. */
  isAllRaster(): boolean {
    if (this.selectedIds.length === 0) return false;
    for (const id of this.selectedIds) {
      const state = this.initialStates.get(id);
      if (!state?.isRaster) return false;
    }
    return true;
  }

  getBox(doc: Document = this.doc): SelectionBox {
    return this.computeBoxFromDoc(doc);
  }

  /** Resize by dragging one of the eight selection-box handles. */
  resize(
    pointerWorld: Point,
    handle: ResizeHandle,
    opts: ResizeOptions = {},
    doc: Document = this.doc,
  ): Document {
    const box = this.initialBox;
    const pointerDelta = this.pointerDeltaToBoxLocal(pointerWorld, box, handle);
    const newBox = this.snapBox(resizeSelectionBox(box, handle, pointerDelta, opts));
    const delta = boxDeltaMatrix(box, newBox);
    this.lastDelta = delta;
    return this.applyDelta(doc, delta);
  }

  /** Rotate the selection box around its center (or a custom pivot). */
  rotate(angleDelta: number, pivot?: Point, doc: Document = this.doc): Document {
    const newBox = this.snapBox(rotateSelectionBox(this.initialBox, angleDelta, pivot));
    const delta = boxDeltaMatrix(this.initialBox, newBox);
    this.lastDelta = delta;
    return this.applyDelta(doc, delta);
  }

  /** Commit a transform gesture, optionally baking vector geometry into node state. */
  commit(doc: Document = this.doc): Document {
    if (!this.options.bakeOnCommit) return doc;
    return this.applyDelta(doc, this.lastDelta, true);
  }

  /** Build per-node state from the initial document. */
  private buildInitialStates(): Map<NodeId, TransformNodeState> {
    const states = new Map<NodeId, TransformNodeState>();
    for (const id of this.selectedIds) {
      const node = this.doc.nodes[id];
      if (!node) continue;
      const worldMat = nodeWorldTransform(this.doc, id);
      const parentId = getParent(this.doc, id);
      const parentWorld = parentId ? nodeWorldTransform(this.doc, parentId) : identity;
      const parentWorldInverse = tryInvertAffine(parentWorld);
      let localRect = nodeLocalBounds(node, this.doc);
      if (!localRect) {
        const worldBounds = nodeWorldBounds(this.doc, id);
        if (!worldBounds) continue;
        const inv = tryInvertAffine(worldMat);
        if (!inv) continue;
        localRect = this.transformRect(inv, worldBounds);
      }
      if (!localRect) continue;
      states.set(id, {
        id,
        node,
        initialWorldTransform: worldMat,
        parentWorldTransform: parentWorld,
        parentWorldInverse,
        initialLocalRect: localRect,
        isRaster: this.isRasterNode(node),
      });
    }
    return states;
  }

  private computeBoxFromDoc(doc: Document): SelectionBox {
    const candidates = this.selectedIds
      .map((id) => {
        const node = doc.nodes[id];
        if (!node) return null;
        const worldMat = nodeWorldTransform(doc, id);
        let localRect = nodeLocalBounds(node, doc);
        if (!localRect) {
          const worldBounds = nodeWorldBounds(doc, id);
          if (!worldBounds) return null;
          const inv = tryInvertAffine(worldMat);
          if (!inv) return null;
          localRect = this.transformRect(inv, worldBounds);
        }
        if (!localRect) return null;
        return { localRect, worldTransform: worldMat };
      })
      .filter((c): c is { localRect: Rect; worldTransform: Affine } => c !== null);
    const box = computeSelectionBox(candidates);
    if (!box) return { cx: 0, cy: 0, w: 0, h: 0, rotation: 0 };
    return box;
  }

  private pointerDeltaToBoxLocal(
    pointerWorld: Point,
    box: SelectionBox,
    handle: ResizeHandle,
  ): Point {
    if (handle === 'rotation') return [0, 0];
    const m = multiplyAffine(translate(box.cx, box.cy), rotateRad(box.rotation));
    const inv = tryInvertAffine(m);
    if (!inv) return [0, 0];
    const localWorld = applyAffine(inv, pointerWorld);
    const sign = HANDLE_SIGNS[handle];
    const handleLocal: Point = [sign.x * (box.w / 2), sign.y * (box.h / 2)];
    return [localWorld[0] - handleLocal[0], localWorld[1] - handleLocal[1]];
  }

  private snapBox(box: SelectionBox): SelectionBox {
    return this.options.snapBox ? this.options.snapBox(box) : box;
  }

  private applyDelta(doc: Document, delta: Affine, bake: boolean = false): Document {
    let newDoc = doc;
    for (const id of this.selectedIds) {
      const state = this.initialStates.get(id);
      if (!state) continue;
      const newWorld = multiplyAffine(delta, state.initialWorldTransform);
      const newLocal = state.parentWorldInverse
        ? multiplyAffine(state.parentWorldInverse, newWorld)
        : newWorld;
      const node = newDoc.nodes[id];
      if (!node) continue;
      if (bake) {
        const baked = this.bakeNode(node, newLocal, newDoc);
        newDoc = { ...newDoc, nodes: { ...newDoc.nodes, ...baked.nodeUpdates } };
      } else {
        newDoc = {
          ...newDoc,
          nodes: {
            ...newDoc.nodes,
            [id]: { ...node, transform: newLocal, rotation: 0 } as SceneNode,
          },
        };
      }
    }
    return newDoc;
  }

  private bakeNode(
    node: SceneNode,
    localTransform: Affine,
    currentDoc: Document,
  ): { nodeUpdates: Record<NodeId, SceneNode> } {
    const updates: Record<NodeId, SceneNode> = {};

    if (node.kind === 'text') {
      const decomposed = this.extractTRS(localTransform);
      if (decomposed) {
        const { translateX, translateY, rotation, scaleX, scaleY } = decomposed;
        const avgScale = Math.max((scaleX + scaleY) / 2, 0.01);
        updates[node.id] = {
          ...node,
          transform: [1, 0, 0, 1, translateX, translateY] as Affine,
          rotation,
          fontSize: Math.max((node.fontSize ?? 16) * avgScale, 1),
        } as SceneNode;
        return { nodeUpdates: updates };
      }
    }

    if (node.kind === 'shape') {
      const shapeNode = node as ShapeNode;
      const decomposed = this.extractTRS(localTransform);
      if (decomposed) {
        const { translateX, translateY, rotation, scaleX, scaleY } = decomposed;
        const baked = this.scaleShape(shapeNode.shape, scaleX, scaleY);
        if (baked) {
          updates[node.id] = {
            ...shapeNode,
            transform: [1, 0, 0, 1, translateX, translateY] as Affine,
            rotation,
            shape: baked,
          } as SceneNode;
          return { nodeUpdates: updates };
        }
      }
    }

    if (node.kind === 'frame') {
      const decomposed = this.extractTRS(localTransform);
      if (decomposed) {
        const { translateX, translateY, scaleX, scaleY } = decomposed;
        const oldW = node.w ?? 0;
        const oldH = node.h ?? 0;
        const newW = oldW * scaleX;
        const newH = oldH * scaleY;

        updates[node.id] = {
          ...node,
          transform: [1, 0, 0, 1, translateX, translateY] as Affine,
          rotation: decomposed.rotation,
          w: newW,
          h: newH,
        } as SceneNode;

        // Apply child constraints when the frame has changed dimensions
        // and has children with constraint settings.
        if (oldW > 0 && oldH > 0 && node.children && node.children.length > 0) {
          for (const childId of node.children) {
            const child = currentDoc.nodes[childId];
            if (!child) continue;
            const cs = child.constraints;
            if (!cs) continue; // No constraints → child stays in place
            const childBounds = nodeLocalBounds(child, currentDoc);
            if (!childBounds) continue;
            const childTransform = child.transform as Affine;
            const childX = childTransform[4] + childBounds.x;
            const childY = childTransform[5] + childBounds.y;

            const result = applyConstraints(
              cs,
              { x: childX, y: childY, w: childBounds.w, h: childBounds.h },
              oldW,
              oldH,
              newW,
              newH,
            );

            // Apply both position AND dimension changes from constraints.
            // For 'stretch' and 'scale' the size differs from the original;
            // the type-aware resize adapter handles each node kind correctly
            // (shape w/h, text w/h, frame w/h, path points, etc.).
            let updatedChild: SceneNode = child;
            const dimChanged =
              Math.abs(result.w - childBounds.w) > 0.001 ||
              Math.abs(result.h - childBounds.h) > 0.001;
            if (dimChanged) {
              updatedChild = resizeNodeGeometry(child, result.w, result.h);
            }

            updates[childId] = {
              ...updatedChild,
              transform: [
                child.transform[0],
                child.transform[1],
                child.transform[2],
                child.transform[3],
                result.x,
                result.y,
              ] as Affine,
            } as SceneNode;
          }
        }

        return { nodeUpdates: updates };
      }
    }

    updates[node.id] = { ...node, transform: localTransform, rotation: 0 } as SceneNode;
    return { nodeUpdates: updates };
  }

  private extractTRS(m: Affine): {
    translateX: number;
    translateY: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  } | null {
    const [a, b, c, d, e, f] = m;
    const scaleX = Math.hypot(a, b);
    const scaleY = Math.hypot(c, d);
    if (scaleX === 0 || scaleY === 0) return null;
    // Reject shear: x-axis and y-axis must be perpendicular.
    if (Math.abs(a * c + b * d) > 1e-6 * scaleX * scaleY) return null;
    // node.rotation is stored and consumed in degrees (see scene/world.ts's
    // rotateDeg call) — atan2 returns radians, so convert before returning.
    const rotation = (Math.atan2(b, a) * 180) / Math.PI;
    return { translateX: e, translateY: f, rotation, scaleX, scaleY };
  }

  private scaleShape(shape: Shape, sx: number, sy: number): Shape | null {
    switch (shape.kind) {
      case 'rect':
        return {
          ...shape,
          x: shape.x * sx,
          y: shape.y * sy,
          w: shape.w * sx,
          h: shape.h * sy,
        };
      case 'ellipse':
        return {
          ...shape,
          cx: shape.cx * sx,
          cy: shape.cy * sy,
          rx: shape.rx * sx,
          ry: shape.ry * sy,
        };
      case 'circle':
        return {
          ...shape,
          cx: shape.cx * sx,
          cy: shape.cy * sy,
          r: shape.r * Math.max(sx, sy),
        };
      case 'line':
        return {
          ...shape,
          from: [shape.from[0] * sx, shape.from[1] * sy] as [number, number],
          to: [shape.to[0] * sx, shape.to[1] * sy] as [number, number],
        };
      case 'arrow':
        return {
          ...shape,
          from: [shape.from[0] * sx, shape.from[1] * sy] as [number, number],
          to: [shape.to[0] * sx, shape.to[1] * sy] as [number, number],
        };
      case 'polygon':
        return {
          ...shape,
          cx: shape.cx * sx,
          cy: shape.cy * sy,
          radius: shape.radius * Math.max(sx, sy),
        };
      case 'star':
        return {
          ...shape,
          cx: shape.cx * sx,
          cy: shape.cy * sy,
          outerRadius: shape.outerRadius * Math.max(sx, sy),
          innerRadius: shape.innerRadius * Math.max(sx, sy),
        };
      case 'path':
        return {
          ...shape,
          points: shape.points.map((p: PathPoint) => ({
            x: p.x * sx,
            y: p.y * sy,
            handleIn: p.handleIn
              ? ([p.handleIn[0] * sx, p.handleIn[1] * sy] as [number, number])
              : null,
            handleOut: p.handleOut
              ? ([p.handleOut[0] * sx, p.handleOut[1] * sy] as [number, number])
              : null,
          })),
        };
      default:
        return null;
    }
  }

  private isRasterNode(node: SceneNode): boolean {
    if (node.kind !== 'shape') return false;
    const shapeNode = node as ShapeNode;
    const fills = shapeNode.fills;
    if (fills?.some((f) => f.type === 'image' || f.type === 'pattern')) return true;
    return false;
  }

  private transformRect(m: Affine, r: Rect): Rect {
    const corners = [
      applyAffine(m, [r.x, r.y]),
      applyAffine(m, [r.x + r.w, r.y]),
      applyAffine(m, [r.x, r.y + r.h]),
      applyAffine(m, [r.x + r.w, r.y + r.h]),
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of corners) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
}

const HANDLE_SIGNS: Record<ResizeHandle, { x: number; y: number }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
  rotation: { x: 0, y: 0 },
};
