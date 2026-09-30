import type { Shape } from '@varve/engine';
import type { Document } from '../document';
import type { NodeId, SceneNode } from '../types';
import { findPresentationDeck } from './model';
import type { PresentationLayoutSource, PresentationSlideLayoutBinding } from './types';

export type PresentationLayoutReflowMode = 'reflow' | 'fit' | 'crop';

export interface PresentationLayoutGeometryChange {
  role: string;
  nodeId: NodeId;
  /** The properties that the layout manages on this object. */
  properties: Record<string, unknown>;
  /** Managed values after this reapplication; local overrides are retained. */
  baseline: Record<string, unknown>;
  preservedOverrides: string[];
}

export interface PresentationLayoutPreview {
  deckId: string;
  entryId: string;
  sourceId: string;
  sourceFrameId: NodeId;
  sourceRevision: number;
  mode: PresentationLayoutReflowMode;
  roleNodes: Record<string, NodeId>;
  changes: PresentationLayoutGeometryChange[];
  unmatchedSourceRoles: string[];
  unmatchedSlideNodeIds: NodeId[];
  warnings: string[];
}

function shapeGeometry(shape: Shape): Record<string, unknown> | null {
  switch (shape.kind) {
    case 'rect':
      return { kind: shape.kind, x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'ellipse':
      return { kind: shape.kind, cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry };
    case 'circle':
      return { kind: shape.kind, cx: shape.cx, cy: shape.cy, r: shape.r };
    case 'polygon':
      return {
        kind: shape.kind,
        cx: shape.cx,
        cy: shape.cy,
        radius: shape.radius,
        rotation: shape.rotation,
      };
    case 'star':
      return {
        kind: shape.kind,
        cx: shape.cx,
        cy: shape.cy,
        innerRadius: shape.innerRadius,
        outerRadius: shape.outerRadius,
        rotation: shape.rotation,
      };
    default:
      return null;
  }
}

/**
 * Snapshot of the geometry a layout manages on a shape. Exported because the
 * override report compares live values against the stored baseline with
 * exactly this projection — a second implementation would drift.
 */
export function presentationShapeGeometry(shape: Shape): Record<string, unknown> | null {
  return shapeGeometry(shape);
}

function managedGeometry(node: SceneNode): Record<string, unknown> | null {
  if (node.kind === 'shape') {
    const shape = shapeGeometry(node.shape);
    return {
      transform: node.transform,
      rotation: node.rotation,
      ...(shape ? { shape } : {}),
    };
  }
  if (node.kind === 'text') {
    return {
      transform: node.transform,
      rotation: node.rotation,
      ...(node.w !== undefined ? { w: node.w } : {}),
      ...(node.h !== undefined ? { h: node.h } : {}),
    };
  }
  return null;
}

function captureGeometrySnapshot(
  nodes: Record<string, SceneNode>,
  roleNodes: Record<string, NodeId>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(roleNodes).flatMap(([role, nodeId]) => {
      const node = nodes[nodeId];
      const geometry = node ? managedGeometry(node) : null;
      return geometry ? [[role, clone(geometry)]] : [];
    }),
  );
}

export function isPresentationLayoutSourceOutdated(
  document: Document,
  source: PresentationLayoutSource,
): boolean {
  if (!source.geometrySnapshot) return false;
  const current = captureGeometrySnapshot(document.nodes, source.roleNodes);
  return !sameValue(current, source.geometrySnapshot);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scaleShapeGeometry(shape: Shape, sx: number, sy: number): Record<string, unknown> | null {
  const uniform = Math.min(sx, sy);
  switch (shape.kind) {
    case 'rect':
      return {
        kind: shape.kind,
        x: shape.x * sx,
        y: shape.y * sy,
        w: shape.w * sx,
        h: shape.h * sy,
      };
    case 'ellipse':
      return {
        kind: shape.kind,
        cx: shape.cx * sx,
        cy: shape.cy * sy,
        rx: shape.rx * sx,
        ry: shape.ry * sy,
      };
    case 'circle':
      return {
        kind: shape.kind,
        cx: shape.cx * sx,
        cy: shape.cy * sy,
        r: shape.r * uniform,
      };
    case 'polygon':
      return {
        kind: shape.kind,
        cx: shape.cx * sx,
        cy: shape.cy * sy,
        radius: shape.radius * uniform,
        rotation: shape.rotation,
      };
    case 'star':
      return {
        kind: shape.kind,
        cx: shape.cx * sx,
        cy: shape.cy * sy,
        innerRadius: shape.innerRadius * uniform,
        outerRadius: shape.outerRadius * uniform,
        rotation: shape.rotation,
      };
    default:
      return null;
  }
}

export function supportsPresentationLayoutNode(source: SceneNode, target: SceneNode): boolean {
  if (source.kind !== target.kind) return false;
  if (source.kind === 'shape' && target.kind === 'shape') {
    return source.shape.kind === target.shape.kind && shapeGeometry(source.shape) !== null;
  }
  return source.kind === 'text' && target.kind === 'text';
}

function ratios(
  source: Extract<SceneNode, { kind: 'frame' }>,
  target: Extract<SceneNode, { kind: 'frame' }>,
  mode: PresentationLayoutReflowMode,
): { sx: number; sy: number; dx: number; dy: number } {
  const rawX = target.w / source.w;
  const rawY = target.h / source.h;
  if (mode === 'reflow') return { sx: rawX, sy: rawY, dx: 0, dy: 0 };
  const factor = mode === 'fit' ? Math.min(rawX, rawY) : Math.max(rawX, rawY);
  return {
    sx: factor,
    sy: factor,
    dx: (target.w - source.w * factor) / 2,
    dy: (target.h - source.h * factor) / 2,
  };
}

function layoutGeometry(
  source: SceneNode,
  target: SceneNode,
  scale: { sx: number; sy: number; dx: number; dy: number },
): { properties: Record<string, unknown>; baseline: Record<string, unknown> } | null {
  if (source.kind !== target.kind || (source.kind !== 'shape' && source.kind !== 'text'))
    return null;
  const [a, b, c, d, x, y] = source.transform;
  const transform: SceneNode['transform'] = [
    a,
    b,
    c,
    d,
    x * scale.sx + scale.dx,
    y * scale.sy + scale.dy,
  ];
  if (source.kind === 'shape' && target.kind === 'shape') {
    if (!supportsPresentationLayoutNode(source, target)) return null;
    const sourceShapeGeometry = scaleShapeGeometry(source.shape, scale.sx, scale.sy);
    if (!sourceShapeGeometry) return null;
    const nextShape = { ...target.shape, ...sourceShapeGeometry };
    return {
      properties: { transform, rotation: source.rotation, shape: nextShape },
      baseline: { transform, rotation: source.rotation, shape: sourceShapeGeometry },
    };
  }
  if (source.kind === 'text' && target.kind === 'text') {
    const properties = {
      transform,
      rotation: source.rotation,
      ...(source.w !== undefined ? { w: source.w * scale.sx } : {}),
      ...(source.h !== undefined ? { h: source.h * scale.sy } : {}),
    };
    return { properties, baseline: properties };
  }
  return null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Builds a side-effect-free geometry preview. The caller presents this result
 * before dispatching `presentation.layout.apply`; canceling it changes nothing.
 */
export function previewPresentationLayout(
  document: Document,
  deckId: string,
  entryId: string,
  sourceId: string,
  roleNodes: Record<string, NodeId>,
  mode: PresentationLayoutReflowMode = 'reflow',
): PresentationLayoutPreview {
  const deck = findPresentationDeck(document, deckId);
  const entry = deck?.slides.find((slide) => slide.id === entryId);
  const source = document.presentation?.layouts.find((layout) => layout.id === sourceId);
  const sourceFrame = source ? document.nodes[source.frameId] : undefined;
  const targetFrame = entry ? document.nodes[entry.frameId] : undefined;
  if (
    !deck ||
    !entry ||
    !source ||
    sourceFrame?.kind !== 'frame' ||
    targetFrame?.kind !== 'frame'
  ) {
    throw new Error(
      'The selected slide or layout source is unavailable. Repair it before applying a layout.',
    );
  }
  if (sourceFrame.id === targetFrame.id) {
    throw new Error('A layout source frame cannot be used as its own destination slide.');
  }
  if (isPresentationLayoutSourceOutdated(document, source)) {
    throw new Error(
      'The layout source has unreviewed edits. Refresh the source before previewing slides.',
    );
  }
  if (sourceFrame.w <= 0 || sourceFrame.h <= 0 || targetFrame.w <= 0 || targetFrame.h <= 0) {
    throw new Error('The layout source and target slide need positive dimensions before reflow.');
  }

  const scale = ratios(sourceFrame, targetFrame, mode);
  const previous = entry.layoutBinding?.sourceId === sourceId ? entry.layoutBinding : undefined;
  const changes: PresentationLayoutGeometryChange[] = [];
  const unmatchedSourceRoles: string[] = [];
  const usedTargets = new Set<NodeId>();
  const warnings: string[] = [];

  for (const [role, sourceNodeId] of Object.entries(source.roleNodes)) {
    const targetNodeId = roleNodes[role];
    const sourceNode = document.nodes[sourceNodeId];
    const targetNode = targetNodeId ? document.nodes[targetNodeId] : undefined;
    if (
      !targetNodeId ||
      !sourceNode ||
      !targetNode ||
      !sourceFrame.children.includes(sourceNodeId) ||
      !targetFrame.children.includes(targetNodeId)
    ) {
      unmatchedSourceRoles.push(role);
      continue;
    }
    if (usedTargets.has(targetNodeId)) {
      warnings.push(
        `More than one layout role points to ${targetNode.name}; only one role can manage an object.`,
      );
      unmatchedSourceRoles.push(role);
      continue;
    }
    usedTargets.add(targetNodeId);
    const desired = layoutGeometry(sourceNode, targetNode, scale);
    if (!desired) {
      unmatchedSourceRoles.push(role);
      warnings.push(`Role “${role}” has incompatible artwork and was left untouched.`);
      continue;
    }
    const baseline = previous?.managedBaseline?.[targetNodeId] ?? {};
    const properties: Record<string, unknown> = {};
    const preservedOverrides: string[] = [];
    for (const [key, value] of Object.entries(desired.properties)) {
      const current =
        key === 'shape' && targetNode.kind === 'shape'
          ? shapeGeometry(targetNode.shape)
          : (targetNode as unknown as Record<string, unknown>)[key];
      const hadBaseline = Object.hasOwn(baseline, key);
      if (hadBaseline && !sameValue(current, baseline[key])) {
        preservedOverrides.push(key);
      } else if (!sameValue(current, value)) {
        properties[key] = value;
      }
    }
    changes.push({
      role,
      nodeId: targetNodeId,
      properties,
      baseline: desired.baseline,
      preservedOverrides,
    });
  }

  if (unmatchedSourceRoles.length > 0) {
    warnings.push(`${unmatchedSourceRoles.length} layout role(s) have no compatible slide object.`);
  }
  const unmatchedSlideNodeIds = targetFrame.children.filter((nodeId) => !usedTargets.has(nodeId));
  if (unmatchedSlideNodeIds.length > 0) {
    warnings.push(
      `${unmatchedSlideNodeIds.length} extra slide object(s) remain unchanged and editable.`,
    );
  }
  if (Math.abs(sourceFrame.w / sourceFrame.h - targetFrame.w / targetFrame.h) > 0.01) {
    warnings.push(`Slide aspect ratio differs from the layout source; ${mode} is previewed.`);
  }

  return {
    deckId,
    entryId,
    sourceId,
    sourceFrameId: source.frameId,
    sourceRevision: source.revision,
    mode,
    roleNodes: Object.fromEntries(changes.map((change) => [change.role, change.nodeId])),
    changes,
    unmatchedSourceRoles,
    unmatchedSlideNodeIds,
    warnings,
  };
}

/** Applies only a previously generated preview and binds its inherited geometry baseline. */
export function applyPresentationLayoutPreview(
  document: Document,
  preview: PresentationLayoutPreview,
): Document {
  const source = document.presentation?.layouts.find((layout) => layout.id === preview.sourceId);
  const deck = findPresentationDeck(document, preview.deckId);
  const entry = deck?.slides.find((slide) => slide.id === preview.entryId);
  if (
    !source ||
    !entry ||
    source.revision !== preview.sourceRevision ||
    source.frameId !== preview.sourceFrameId
  ) {
    throw new Error(
      'The layout source changed after preview. Preview the latest revision before applying.',
    );
  }
  const nodes = { ...document.nodes };
  const managedBaseline: NonNullable<PresentationSlideLayoutBinding['managedBaseline']> = {};
  for (const change of preview.changes) {
    const node = nodes[change.nodeId];
    if (!node) continue;
    nodes[change.nodeId] = { ...node, ...clone(change.properties) } as SceneNode;
    managedBaseline[change.nodeId] = clone(change.baseline);
  }
  const binding: PresentationSlideLayoutBinding = {
    sourceId: source.id,
    sourceFrameId: source.frameId,
    appliedRevision: source.revision,
    roleNodes: { ...preview.roleNodes },
    managedBaseline,
  };
  const metadata = document.presentation!;
  return {
    ...document,
    nodes,
    presentation: {
      ...metadata,
      decks: metadata.decks.map((candidate) =>
        candidate.id !== preview.deckId
          ? candidate
          : {
              ...candidate,
              slides: candidate.slides.map((slide) =>
                slide.id === preview.entryId ? { ...slide, layoutBinding: binding } : slide,
              ),
            },
      ),
    },
  };
}

export function registerPresentationLayout(
  document: Document,
  source: PresentationLayoutSource,
): Document {
  const metadata = document.presentation;
  if (!metadata) throw new Error('A presentation deck is required before registering layouts.');
  if (metadata.layouts.some((layout) => layout.id === source.id)) {
    throw new Error(`presentation layout id already exists: ${source.id}`);
  }
  const prepared = {
    ...source,
    geometrySnapshot: captureGeometrySnapshot(document.nodes, source.roleNodes),
  };
  return { ...document, presentation: { ...metadata, layouts: [...metadata.layouts, prepared] } };
}

export function updatePresentationLayoutSource(
  document: Document,
  sourceId: string,
  update: Pick<PresentationLayoutSource, 'name' | 'frameId' | 'roleNodes'>,
): Document {
  const metadata = document.presentation;
  const source = metadata?.layouts.find((layout) => layout.id === sourceId);
  if (!metadata || !source)
    throw new Error(`presentation layout source does not exist: ${sourceId}`);
  return {
    ...document,
    presentation: {
      ...metadata,
      layouts: metadata.layouts.map((layout) =>
        layout.id === sourceId
          ? {
              ...update,
              id: source.id,
              revision: source.revision + 1,
              geometrySnapshot: captureGeometrySnapshot(document.nodes, update.roleNodes),
            }
          : layout,
      ),
    },
  };
}

export function removePresentationLayout(document: Document, sourceId: string): Document {
  const metadata = document.presentation;
  if (!metadata?.layouts.some((layout) => layout.id === sourceId)) {
    throw new Error(`presentation layout source does not exist: ${sourceId}`);
  }
  return {
    ...document,
    presentation: {
      ...metadata,
      layouts: metadata.layouts.filter((layout) => layout.id !== sourceId),
    },
  };
}
