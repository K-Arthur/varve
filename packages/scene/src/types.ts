/**
 * Scene document types (Strata plan §3.1, §9 — slots-ready model).
 *
 * Layering note: the primitive geometry types (Affine, Color, Point, Shape) are
 * imported from @strata/engine for now. A later refactor moves them to
 * @strata/shared so scene does not depend on the renderer package.
 *
 * The model is SLOTS-READY: a Frame may declare typed slots (task 1.1) and
 * instances fill them with arbitrary local content while staying synced to the
 * master. `children` on a Frame today is an ordered NodeId list; slot binding
 * arrives in 1.1 without changing this shape.
 */
import type { Affine, Color, Shape } from '@strata/engine';

export type NodeId = string;

export interface NodeBase {
  id: NodeId;
  name: string;
  /** Paint order among siblings (0 = bottom). Reorder via Document.move. */
  index: number;
  visible: boolean;
  locked: boolean;
}

export interface ShapeNode extends NodeBase {
  kind: 'shape';
  shape: Shape;
  transform: Affine;
  fill: Color;
}

export interface TextNode extends NodeBase {
  kind: 'text';
  text: string;
  transform: Affine;
  fill: Color;
  /** Font size in px at 1x; variable-bindable across breakpoints (task 1.3). */
  fontSize: number;
}

export interface FrameNode extends NodeBase {
  kind: 'frame';
  transform: Affine;
  /** Child node ids in paint order. Slot bindings (task 1.1) extend this. */
  children: NodeId[];
  /** If this frame is a component instance, the component it instantiates. */
  componentId?: NodeId;
  /** Slot fills: slotId -> child NodeId (filled in task 1.1). */
  slots?: Record<string, NodeId>;
}

export type SceneNode = ShapeNode | TextNode | FrameNode;
