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

import { type PathPoint, type Shape, transformPathShape } from '@varve/engine';
import { reflowLayoutChildren, resizeNodeGeometry } from '@varve/layout';
import type { Document, Fill, NodeId, SceneNode, ShapeNode, Stroke } from '@varve/scene';
import { applyConstraints, getParent } from '@varve/scene';
import type { Affine, Point, Rect } from '@varve/shared';
import {
  applyAffine,
  boxDeltaMatrix,
  computeSelectionBox,
  decomposeAffineFull,
  identity,
  multiplyAffine,
  type ResizeHandle,
  type ResizeOptions,
  resizeSelectionBox,
  resolveTextGeometryMode,
  rotateRad,
  rotateSelectionBox,
  type SelectionBox,
  transformLinkedGradient,
  translate,
  tryInvertAffine,
} from '@varve/shared';
import { OBJECT_RESIZE_POLICIES } from '../context/selectionState';

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
  /** When true, frame children are scaled uniformly with the frame (like a group).
   *  When false (default), children without constraints stay in place, and children
   *  with constraints respond according to their constraint settings. */
  scaleContents?: boolean;
}

export type SkewAxis = 'e' | 'w' | 'n' | 's';

type TransformResizeOptions = ResizeOptions & {
  /** Skip the injected snap policy for this pointer sample (Ctrl/Cmd). */
  bypassSnap?: boolean;
  /** When true, frame children are scaled uniformly (Ctrl/Cmd on frame edge handle). */
  scaleContents?: boolean;
};

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

  /** The most recent delta matrix applied by resize/rotate/skew. */
  getLastDelta(): Affine {
    return this.lastDelta;
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

  /** Determine the dominant resize policy across the selection.
   *  For mixed selections, proportional=true wins if ANY node is
   *  an image or group (to avoid distortion). */
  getResizePolicy(opts?: TransformResizeOptions): ResizeOptions {
    const explicitProportional = opts?.proportional;
    const explicitCentered = opts?.centered;
    if (explicitProportional !== undefined && explicitCentered !== undefined) {
      return {
        proportional: explicitProportional,
        centered: explicitCentered,
        minSize: opts?.minSize,
      };
    }
    let defaultProportional = false;
    for (const id of this.selectedIds) {
      const node = this.doc.nodes[id];
      if (!node) continue;
      let kind: string = node.kind;
      if (kind === 'shape' && this.isRasterNode(node)) kind = 'image';
      const policy = OBJECT_RESIZE_POLICIES[kind] ?? OBJECT_RESIZE_POLICIES.shape!;
      if (policy.defaultProportional) defaultProportional = true;
    }
    return {
      proportional: explicitProportional ?? defaultProportional,
      centered: explicitCentered ?? false,
      minSize: opts?.minSize,
    };
  }

  /** Resize by dragging one of the eight selection-box handles. */
  resize(
    pointerWorld: Point,
    handle: ResizeHandle,
    opts: TransformResizeOptions = {},
    doc: Document = this.doc,
  ): Document {
    const box = this.initialBox;
    const pointerDelta = this.pointerDeltaToBoxLocal(pointerWorld, box, handle);
    const policy = this.getResizePolicy(opts);
    const resizedBox = resizeSelectionBox(box, handle, pointerDelta, { ...opts, ...policy });
    const newBox = opts.bypassSnap ? resizedBox : this.snapBox(resizedBox);
    const delta = boxDeltaMatrix(box, newBox);
    this.lastDelta = delta;
    // Propagate scaleContents from transient resize opts to the stored options
    // so commit() uses the right mode for frame children.
    if (opts.scaleContents !== undefined) {
      this.options.scaleContents = opts.scaleContents;
    }
    return this.applyDelta(doc, delta);
  }

  /** Rotate the selection box around its center (or a custom pivot). */
  rotate(angleDelta: number, pivot?: Point, doc: Document = this.doc): Document {
    const newBox = this.snapBox(rotateSelectionBox(this.initialBox, angleDelta, pivot));
    const delta = boxDeltaMatrix(this.initialBox, newBox);
    this.lastDelta = delta;
    return this.applyDelta(doc, delta);
  }

  /** Skew by dragging a side handle. Composes a shear matrix onto the delta. */
  skew(pointerWorld: Point, axis: SkewAxis, doc: Document = this.doc): Document {
    const box = this.initialBox;
    const local = this.pointerDeltaToBoxLocal(pointerWorld, box, 'e');
    const boxH = box.h || 1;
    const boxW = box.w || 1;
    // E/W vertical edges: vertical drag skews Y axis (shearY → b component)
    // N/S horizontal edges: horizontal drag skews X axis (shearX → c component)
    let shearFactor = 0;
    if (axis === 'e' || axis === 'w') {
      shearFactor = local[1] / boxH;
    } else {
      shearFactor = local[0] / boxW;
    }
    if (axis === 'w' || axis === 'n') shearFactor = -shearFactor;
    const shear: Affine =
      axis === 'e' || axis === 'w'
        ? ([1, shearFactor, 0, 1, 0, 0] as Affine) // skewY (b component)
        : ([1, 0, shearFactor, 1, 0, 0] as Affine); // skewX (c component)
    const delta = multiplyAffine(shear, this.lastDelta);
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
        const { translateX, translateY, rotation, scaleX, scaleY, skewX, skewY } = decomposed;
        const boundsBeforeBake = nodeLocalBounds(node, currentDoc);
        // When skew is present, preserve the full affine transform instead of baking.
        if (Math.abs(skewX) > 1e-9 || Math.abs(skewY) > 1e-9) {
          updates[node.id] = { ...node, transform: localTransform } as SceneNode;
          return { nodeUpdates: updates };
        }
        // Which dimension a text node owns decides what a resize means.
        //
        // Auto-width text has no container: its box *is* its content, so the
        // only thing a handle can change is the type size. Area text does have
        // a container, and dragging its handle is a request to change that
        // container — scaling the font instead left the box at its old size
        // with larger text spilling out of it, and no way to widen a text
        // frame at all.
        const mode = resolveTextGeometryMode(node);
        if (mode === 'fixed' || mode === 'autoHeight') {
          const baseWidth = node.w ?? nodeLocalBounds(node, currentDoc)?.w ?? 0;
          const width = Math.max(1, baseWidth * Math.abs(scaleX));
          updates[node.id] = this.transformGradientPaintsForBake(
            {
              ...node,
              transform: [1, 0, 0, 1, translateX, translateY] as Affine,
              rotation,
              w: width,
              // Auto-height derives its height from the wrap, so a vertical drag
              // has nothing to write; only a fixed container stores one.
              ...(mode === 'fixed' ? { h: Math.max(1, (node.h ?? 0) * Math.abs(scaleY)) } : {}),
            } as SceneNode,
            boundsBeforeBake,
            [scaleX, 0, 0, scaleY, 0, 0],
          );
          return { nodeUpdates: updates };
        }
        const avgScale = Math.max((scaleX + scaleY) / 2, 0.01);
        updates[node.id] = this.transformGradientPaintsForBake(
          {
            ...node,
            transform: [1, 0, 0, 1, translateX, translateY] as Affine,
            rotation,
            fontSize: Math.max((node.fontSize ?? 16) * avgScale, 1),
          } as SceneNode,
          boundsBeforeBake,
          [avgScale, 0, 0, avgScale, 0, 0],
        );
        return { nodeUpdates: updates };
      }
    }

    if (node.kind === 'shape') {
      const shapeNode = node as ShapeNode;
      const decomposed = this.extractTRS(localTransform);
      if (decomposed) {
        const { translateX, translateY, rotation, scaleX, scaleY, skewX, skewY } = decomposed;
        const boundsBeforeBake = nodeLocalBounds(shapeNode, currentDoc);
        // When skew is present, preserve the full affine transform instead of baking.
        if (Math.abs(skewX) > 1e-9 || Math.abs(skewY) > 1e-9) {
          updates[node.id] = { ...shapeNode, transform: localTransform } as SceneNode;
          return { nodeUpdates: updates };
        }
        const baked = this.scaleShape(shapeNode.shape, scaleX, scaleY);
        if (baked) {
          updates[node.id] = this.transformGradientPaintsForBake(
            {
              ...shapeNode,
              transform: [1, 0, 0, 1, translateX, translateY] as Affine,
              rotation,
              shape: baked,
            } as SceneNode,
            boundsBeforeBake,
            [scaleX, 0, 0, scaleY, 0, 0],
          );
          return { nodeUpdates: updates };
        }
      }
    }

    if (node.kind === 'frame') {
      const decomposed = this.extractTRS(localTransform);
      if (decomposed) {
        const { translateX, translateY, scaleX, scaleY, skewX, skewY } = decomposed;
        const boundsBeforeBake = nodeLocalBounds(node, currentDoc);
        // When skew is present, preserve the full affine transform instead of baking.
        if (Math.abs(skewX) > 1e-9 || Math.abs(skewY) > 1e-9) {
          updates[node.id] = { ...node, transform: localTransform } as SceneNode;
          if (node.children) {
            for (const childId of node.children) {
              const child = currentDoc.nodes[childId];
              if (!child) continue;
              updates[childId] = { ...child, transform: child.transform } as SceneNode;
            }
          }
          return { nodeUpdates: updates };
        }
        const oldW = node.w ?? 0;
        const oldH = node.h ?? 0;
        const newW = oldW * scaleX;
        const newH = oldH * scaleY;

        updates[node.id] = this.transformGradientPaintsForBake(
          {
            ...node,
            transform: [1, 0, 0, 1, translateX, translateY] as Affine,
            rotation: decomposed.rotation,
            w: newW,
            h: newH,
          } as SceneNode,
          boundsBeforeBake,
          [scaleX, 0, 0, scaleY, 0, 0],
        );

        // When scaleContents is true, frame children are scaled uniformly
        // (like a group). When false, only children with explicit constraints
        // respond to the parent resize; children without constraints stay put.
        if (oldW > 0 && oldH > 0 && node.children && node.children.length > 0) {
          if (this.options.scaleContents) {
            // Scale all children uniformly with the frame.
            for (const childId of node.children) {
              const child = currentDoc.nodes[childId];
              if (!child) continue;
              const childTransform = child.transform as Affine;
              const childWorld = multiplyAffine(localTransform, childTransform);
              const parentInv = tryInvertAffine(localTransform);
              if (!parentInv) continue;
              const newChildLocal = multiplyAffine(parentInv, childWorld);
              updates[childId] = {
                ...child,
                transform: newChildLocal,
              } as SceneNode;
            }
          } else if (node.layoutStyle) {
            // Layout frames reflow: layout owns child positions (and
            // fill/grow sizes), so a canvas resize must re-run the layout
            // against the frame's new box — constraint propagation alone
            // leaves flex/grid children exactly where they were.
            const reflowed = reflowLayoutChildren(
              { ...currentDoc, nodes: { ...currentDoc.nodes, ...updates } },
              node.id,
            );
            for (const childId of node.children) {
              const child = reflowed.nodes[childId];
              if (!child) continue;
              updates[childId] = child;
            }
          } else {
            // Apply child constraints when the frame has changed dimensions
            // and has children with constraint settings.
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

              let updatedChild: SceneNode = child;
              const dimChanged =
                Math.abs(result.w - childBounds.w) > 0.001 ||
                Math.abs(result.h - childBounds.h) > 0.001;
              if (dimChanged) {
                updatedChild = resizeNodeGeometry(child, result.w, result.h);
                const scaleChildX = childBounds.w === 0 ? 1 : result.w / childBounds.w;
                const scaleChildY = childBounds.h === 0 ? 1 : result.h / childBounds.h;
                updatedChild = this.transformGradientPaintsForBake(updatedChild, childBounds, [
                  scaleChildX,
                  0,
                  0,
                  scaleChildY,
                  0,
                  0,
                ]);
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
        }

        return { nodeUpdates: updates };
      }
    }

    // No geometry was baked in this fallback. The live node transform already
    // carries linked gradients, so modifying them here would apply scale twice.
    updates[node.id] = { ...node, transform: localTransform, rotation: 0 } as SceneNode;
    return { nodeUpdates: updates };
  }

  private extractTRS(m: Affine): {
    translateX: number;
    translateY: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    skewX: number;
    skewY: number;
  } | null {
    const decomposed = decomposeAffineFull(m);
    if (!decomposed) return null;
    return {
      translateX: decomposed.translateX,
      translateY: decomposed.translateY,
      rotation: (decomposed.rotation * 180) / Math.PI,
      scaleX: decomposed.scaleX,
      scaleY: decomposed.scaleY,
      skewX: decomposed.skewX,
      skewY: decomposed.skewY,
    };
  }

  /** Update every linked fill and stroke with the exact local geometry bake. */
  private transformGradientPaintsForBake(
    node: SceneNode,
    boundsBeforeBake: Rect | null,
    geometryTransform: Affine,
  ): SceneNode {
    if (!boundsBeforeBake) return node;
    const nodeAny = node as Record<string, unknown>;
    const fills = nodeAny.fills;
    let changed = false;
    const updatedFills = Array.isArray(fills)
      ? fills.map((fill: Fill) => {
          if (fill.type !== 'gradient' || !fill.gradient) return fill;
          changed = true;
          return {
            ...fill,
            gradient: transformLinkedGradient(fill.gradient, boundsBeforeBake, geometryTransform),
          } as Fill;
        })
      : fills;
    const strokes = nodeAny.strokes;
    const updatedStrokes = Array.isArray(strokes)
      ? strokes.map((stroke: Stroke) => {
          if (!stroke.gradient) return stroke;
          changed = true;
          return {
            ...stroke,
            gradient: transformLinkedGradient(stroke.gradient, boundsBeforeBake, geometryTransform),
          } as Stroke;
        })
      : strokes;

    if (!changed) return node;
    return {
      ...node,
      ...(Array.isArray(updatedFills) ? { fills: updatedFills } : {}),
      ...(Array.isArray(updatedStrokes) ? { strokes: updatedStrokes } : {}),
    } as SceneNode;
  }

  private scaleShape(shape: Shape, sx: number, sy: number): Shape | null {
    // A circle, polygon, or star has only one radius in its persisted model.
    // Applying an anisotropic scale by picking the larger factor (the old
    // behaviour) makes the committed model disagree with the preview affine.
    // Convert those cases to their exact cubic path representation instead.
    // The same conversion safely represents reflections without storing
    // negative primitive dimensions/radii, which Canvas2D and bounds code do
    // not consistently support.
    const requiresPathGeometry =
      sx <= 0 ||
      sy <= 0 ||
      ((shape.kind === 'circle' || shape.kind === 'polygon' || shape.kind === 'star') &&
        Math.abs(sx - sy) > 1e-9);
    if (requiresPathGeometry) {
      return transformPathShape(shape, [sx, 0, 0, sy, 0, 0] as Affine);
    }

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
          r: shape.r * sx,
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
          radius: shape.radius * sx,
        };
      case 'star':
        return {
          ...shape,
          cx: shape.cx * sx,
          cy: shape.cy * sy,
          outerRadius: shape.outerRadius * sx,
          innerRadius: shape.innerRadius * sx,
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
