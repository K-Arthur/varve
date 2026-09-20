/**
 * Editable comic callouts built from ordinary scene nodes.
 *
 * A callout is deliberately a group recipe, rather than a renderer-specific
 * node. The body, tail(s), and text remain independently editable and are
 * therefore covered by the normal scene, selection, history, and export
 * systems.
 */

import type { Affine, PathPoint } from '@varve/engine';
import { resolveTextGeometry, type TextWrapShape } from '@varve/shared';
import { computeReparentTransform, nodeWorldBounds, worldRectToLocal } from './coordinateService';
import type { Document } from './document';
import { addChild, addNode, makePathNode, makeShapeNode, makeTextNode } from './document';
import { reparentPreservingWorldTransform } from './document-nodes';
import { getParent, makeGroupNode } from './document-utils';
import { nextNodeId } from './node-id';
import { textGeometryInput } from './textBounds';
import type {
  CalloutFitPolicy,
  CalloutRecipe,
  CalloutTail,
  CalloutTailStyle,
  GroupNode,
  NodeId,
  SceneNode,
  ShapeNode,
  TextNode,
} from './types';
import { defaultStroke } from './types';
import { plainTextToRichText } from './typography';

export type CalloutKind = CalloutRecipe['kind'];

export type CalloutFitStatus = 'fit' | 'near-overflow' | 'overflow';

export interface CalloutFitReport {
  status: CalloutFitStatus;
  policy: CalloutFitPolicy;
  /** Authored interior wrap shape for the bound text. */
  wrapShape: TextWrapShape;
  padding: number;
  availableWidth: number;
  availableHeight: number;
  layoutWidth: number;
  layoutHeight: number;
  excessWidth: number;
  excessHeight: number;
}

type RectCalloutBody = ShapeNode & {
  shape: Extract<ShapeNode['shape'], { kind: 'rect' }>;
};

export interface CreateCalloutOptions {
  kind?: CalloutKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  padding?: number;
  tailEndpoint?: { x: number; y: number };
  /** Base width of the pointed tail in px; derived from the body when omitted. */
  tailBaseWidth?: number;
  /** Signed bend as a fraction of the tail length (-1..1). */
  tailCurve?: number;
  parentId?: NodeId | null;
}

export interface CalloutResult {
  document: Document;
  groupId: NodeId;
  bodyId: NodeId;
  textId: NodeId;
  tailNodeIds: NodeId[];
}

const WHITE = { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 };

/**
 * Round balloons read as a stack that follows the outline (longest line near
 * the middle); captions and narration are rectangles. This is the authored
 * default — the Inspector can switch either way per balloon.
 */
export function defaultCalloutWrapShape(kind: CalloutKind): TextWrapShape {
  return kind === 'caption' ? 'rect' : 'ellipse';
}

function calloutStyle(kind: CalloutKind): {
  cornerRadius: number;
  strokeWeight: number;
  dashPattern: number[];
} {
  switch (kind) {
    case 'caption':
      return { cornerRadius: 4, strokeWeight: 1.5, dashPattern: [] };
    case 'whisper':
      return { cornerRadius: 20, strokeWeight: 1.5, dashPattern: [6, 4] };
    case 'shout':
      return { cornerRadius: 8, strokeWeight: 4, dashPattern: [] };
    case 'thought':
      return { cornerRadius: 48, strokeWeight: 2, dashPattern: [] };
    default:
      return { cornerRadius: 28, strokeWeight: 2, dashPattern: [] };
  }
}

function bubbleStroke(kind: CalloutKind) {
  return {
    ...defaultStroke(),
    weight: calloutStyle(kind).strokeWeight,
    dashPattern: calloutStyle(kind).dashPattern,
  };
}

function point(x: number, y: number): PathPoint {
  return { x, y, handleIn: null, handleOut: null };
}

function tailBaseWidth(w: number, override?: number): number {
  if (override !== undefined && Number.isFinite(override)) return Math.max(2, override);
  return Math.max(12, Math.min(32, w * 0.16));
}

/**
 * Control point for a bent tail: perpendicular to the base→endpoint axis at
 * its midpoint. `curve` is a fraction of the tail length so the bend survives
 * balloon resizing.
 */
function tailControlPoint(
  baseCenter: { x: number; y: number },
  endpoint: { x: number; y: number },
  curve: number,
): { x: number; y: number } {
  const dx = endpoint.x - baseCenter.x;
  const dy = endpoint.y - baseCenter.y;
  const length = Math.hypot(dx, dy) || 1;
  // Perpendicular (left normal) scaled by the signed bend amount.
  const bend = curve * length;
  return {
    x: (baseCenter.x + endpoint.x) / 2 + (-dy / length) * bend,
    y: (baseCenter.y + endpoint.y) / 2 + (dx / length) * bend,
  };
}

function pointedTailPoints(
  w: number,
  h: number,
  endpoint: { x: number; y: number },
  options?: { baseWidth?: number; curve?: number },
): PathPoint[] {
  const base = tailBaseWidth(w, options?.baseWidth);
  const cx = w / 2;
  const baseY = Math.min(h, h - 1);
  const left = point(cx - base / 2, baseY);
  const right = point(cx + base / 2, baseY);
  const tip = point(endpoint.x, endpoint.y);
  const curve = Math.max(-1, Math.min(1, options?.curve ?? 0));
  if (curve !== 0) {
    const control = tailControlPoint({ x: cx, y: baseY }, endpoint, curve);
    // Both tail sides bow toward the shared control point, so the outline
    // bends as one stroke instead of kinking at the tip.
    const k = 0.65;
    right.handleOut = [(control.x - right.x) * k, (control.y - right.y) * k];
    tip.handleIn = [(control.x - tip.x) * k, (control.y - tip.y) * k];
    tip.handleOut = [(control.x - tip.x) * k, (control.y - tip.y) * k];
    left.handleIn = [(control.x - left.x) * k, (control.y - left.y) * k];
  }
  return [left, right, tip];
}

/**
 * A thought tail is a chain of decreasing circles from the balloon edge to
 * the target, matching the convention that it points at a character's head
 * rather than a mouth. The last circle's center is the authored endpoint.
 */
function thoughtBubbleGeometry(
  w: number,
  h: number,
  endpoint: { x: number; y: number },
  bubbleCount = 3,
): Array<{ cx: number; cy: number; r: number }> {
  const count = Math.max(2, Math.min(6, Math.round(bubbleCount)));
  const anchor = { x: w / 2, y: Math.min(h, h - 1) };
  const maxRadius = Math.max(4, Math.min(18, w * 0.06));
  const bubbles: Array<{ cx: number; cy: number; r: number }> = [];
  for (let index = 0; index < count; index++) {
    const t = count === 1 ? 1 : (index + 1) / count;
    const radius = maxRadius * (1 - (index / (count - 1)) * 0.55);
    bubbles.push({
      cx: anchor.x + (endpoint.x - anchor.x) * t,
      cy: anchor.y + (endpoint.y - anchor.y) * t,
      r: Math.max(1.5, radius),
    });
  }
  return bubbles;
}

function bubbleNode(
  id: NodeId,
  bubble: { cx: number; cy: number; r: number },
  kind: CalloutKind,
): SceneNode {
  return makeShapeNode(
    id,
    { kind: 'circle', cx: bubble.cx, cy: bubble.cy, r: bubble.r },
    {
      name: 'Thought bubble',
      fill: WHITE,
      strokes: [bubbleStroke(kind)],
    },
  );
}

function bodyNode(id: NodeId, w: number, h: number, kind: CalloutKind): ShapeNode {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w, h },
    {
      name: `${kind[0]!.toUpperCase()}${kind.slice(1)} balloon`,
      fill: WHITE,
      strokes: [bubbleStroke(kind)],
      cornerRadius: calloutStyle(kind).cornerRadius,
    },
  );
}

function recipe(
  kind: CalloutKind,
  bodyId: NodeId,
  textId: NodeId,
  tails: CalloutTail[],
  padding: number,
): CalloutRecipe {
  return {
    version: 1,
    kind,
    bodyNodeId: bodyId,
    textNodeId: textId,
    tailNodeIds: tails.flatMap((tail) => tail.nodeIds),
    tails,
    padding,
    fitToText: false,
    fitPolicy: 'reflow',
    parametric: true,
  };
}

function tailStyleForKind(kind: CalloutKind): CalloutTailStyle {
  return kind === 'thought' ? 'thought' : 'pointed';
}

/**
 * Build the nodes for one logical tail and advance the id counter. The caller
 * owns insertion order; this only allocates ids and geometry.
 */
function buildTailNodes(
  doc: Document,
  kind: CalloutKind,
  style: CalloutTailStyle,
  w: number,
  h: number,
  endpoint: { x: number; y: number },
  options: { curve?: number; baseWidth?: number; bubbleCount?: number } = {},
): { doc: Document; nodes: SceneNode[]; tail: CalloutTail } {
  let next = doc;
  if (style === 'thought') {
    const geometry = thoughtBubbleGeometry(w, h, endpoint, options.bubbleCount ?? 3);
    const nodes: SceneNode[] = [];
    for (const bubble of geometry) {
      const idResult = nextNodeId(next);
      next = idResult.doc;
      nodes.push(bubbleNode(idResult.id, bubble, kind));
    }
    return {
      doc: next,
      nodes,
      tail: {
        nodeIds: nodes.map((node) => node.id),
        style: 'thought',
        bubbleCount: options.bubbleCount ?? 3,
      },
    };
  }
  const idResult = nextNodeId(next);
  next = idResult.doc;
  const node = makePathNode(idResult.id, {
    name: 'Balloon tail',
    points: pointedTailPoints(w, h, endpoint, options),
    closed: true,
    fill: WHITE,
    strokes: [bubbleStroke(kind)],
  });
  return {
    doc: next,
    nodes: [node],
    tail: {
      nodeIds: [node.id],
      style: 'pointed',
      curve: options.curve,
      baseWidth: options.baseWidth,
    },
  };
}

/** Create a new callout whose text is an ordinary editable TextNode. */
export function createCallout(doc: Document, options: CreateCalloutOptions): CalloutResult {
  const kind = options.kind ?? 'speech';
  const padding = Math.max(0, options.padding ?? 18);
  const w = Math.max(24, options.w);
  const h = Math.max(24, options.h);
  const endpoint = options.tailEndpoint ?? { x: w / 2, y: h + Math.max(32, h * 0.35) };
  let next = doc;
  const groupResult = nextNodeId(next);
  next = groupResult.doc;
  const bodyResult = nextNodeId(next);
  next = bodyResult.doc;
  const textResult = nextNodeId(next);
  next = textResult.doc;
  const groupId = groupResult.id;
  const bodyId = bodyResult.id;
  const textId = textResult.id;

  const group = makeGroupNode(groupId, {
    name: `${kind[0]!.toUpperCase()}${kind.slice(1)} balloon`,
    transform: [1, 0, 0, 1, options.x, options.y] as Affine,
    children: [],
  });
  const body = bodyNode(bodyId, w, h, kind);
  const built = buildTailNodes(next, kind, tailStyleForKind(kind), w, h, endpoint, {
    baseWidth: options.tailBaseWidth,
    curve: options.tailCurve,
  });
  next = built.doc;
  const text = makeTextNode(textId, options.text ?? '', {
    name: 'Balloon text',
    transform: [1, 0, 0, 1, padding, padding] as Affine,
    w: Math.max(1, w - padding * 2),
    h: Math.max(1, h - padding * 2),
    textAlign: 'center',
    textAlignVertical: 'middle',
    textResizing: 'fixed',
    textOverflow: 'visible',
    textWrapShape: defaultCalloutWrapShape(kind),
    richText: plainTextToRichText(options.text ?? ''),
  });

  next = options.parentId ? addChild(next, options.parentId, group) : addNode(next, group);
  next = addChild(next, groupId, body);
  for (const tail of built.nodes) next = addChild(next, groupId, tail);
  next = addChild(next, groupId, text);
  const insertedGroup = next.nodes[groupId] as GroupNode;
  next = {
    ...next,
    nodes: {
      ...next.nodes,
      [groupId]: {
        ...insertedGroup,
        callout: recipe(kind, bodyId, textId, [built.tail], padding),
      },
    },
  };
  return { document: next, groupId, bodyId, textId, tailNodeIds: built.tail.nodeIds };
}

/** Wrap an existing text node without duplicating its editable source text. */
export function wrapTextInCallout(
  doc: Document,
  textId: NodeId,
  options: {
    kind?: CalloutKind;
    padding?: number;
    tailLength?: number;
    wrapShape?: TextWrapShape;
  } = {},
): CalloutResult | null {
  const text = doc.nodes[textId];
  if (text?.kind !== 'text') return null;
  const bounds = nodeWorldBounds(doc, textId) ?? {
    x: text.transform[4],
    y: text.transform[5],
    w: text.w ?? 240,
    h: text.h ?? 96,
  };
  const padding = Math.max(0, options.padding ?? 18);
  const w = Math.max(48, bounds.w + padding * 2);
  const h = Math.max(32, bounds.h + padding * 2);
  const parentId = getParent(doc, textId);
  const localBounds = parentId ? (worldRectToLocal(doc, parentId, bounds) ?? bounds) : bounds;
  const created = createCallout(doc, {
    kind: options.kind,
    x: localBounds.x - padding,
    y: localBounds.y - padding,
    w,
    h,
    padding,
    tailEndpoint: { x: w / 2, y: h + Math.max(24, options.tailLength ?? 32) },
    parentId,
  });
  let next = created.document;
  const localTransform = computeReparentTransform(next, textId, created.groupId);
  const groupBeforeReparent = next.nodes[created.groupId] as GroupNode;
  next = reparentPreservingWorldTransform(
    next,
    textId,
    created.groupId,
    groupBeforeReparent.children.length,
    localTransform ?? undefined,
  );
  const groupAfterReparent = next.nodes[created.groupId] as GroupNode;
  const wrapShape = options.wrapShape ?? defaultCalloutWrapShape(options.kind ?? 'speech');
  next = {
    ...next,
    nodes: {
      ...next.nodes,
      [created.groupId]: {
        ...groupAfterReparent,
        callout: {
          ...groupAfterReparent.callout!,
          textNodeId: textId,
        },
      },
      // The balloon owns the interior wrap shape by default; switching it is
      // an explicit, reversible Inspector choice.
      [textId]: { ...(next.nodes[textId] as TextNode), textWrapShape: wrapShape },
    },
  };
  // `createCallout` made a temporary text node before the existing one was
  // reparented. Remove only that temporary child from the group and map. The
  // source text node remains authoritative and editable.
  const temporaryTextId = created.textId;
  const group = next.nodes[created.groupId];
  if (group?.kind === 'group') {
    const children = group.children.filter((id) => id !== temporaryTextId);
    const nodes = { ...next.nodes };
    delete nodes[temporaryTextId];
    next = { ...next, nodes: { ...nodes, [created.groupId]: { ...group, children } } };
  }
  return { ...created, document: next, textId };
}

function calloutGroup(
  doc: Document,
  groupId: NodeId,
): (GroupNode & { callout: CalloutRecipe }) | null {
  const node = doc.nodes[groupId];
  return node?.kind === 'group' && node.callout
    ? (node as GroupNode & { callout: CalloutRecipe })
    : null;
}

function calloutBodyAndText(
  doc: Document,
  group: GroupNode & { callout: CalloutRecipe },
): { body: RectCalloutBody; text: TextNode } | null {
  const body = doc.nodes[group.callout.bodyNodeId];
  const text = doc.nodes[group.callout.textNodeId];
  if (body?.kind !== 'shape' || body.shape.kind !== 'rect' || text?.kind !== 'text') return null;
  return { body: body as RectCalloutBody, text };
}

function textLocalSize(text: TextNode): { w: number; h: number } {
  const geometry = resolveTextGeometry(text);
  return {
    w: Math.max(1, text.w ?? geometry.layout.w),
    h: Math.max(1, text.h ?? geometry.layout.h),
  };
}

/**
 * Derive fit state from the shared text geometry used by scene bounds and
 * rendering. Font readiness can change this result without dirtying a file.
 */
export function getCalloutFitReport(doc: Document, groupId: NodeId): CalloutFitReport | null {
  const group = calloutGroup(doc, groupId);
  if (!group) return null;
  const members = calloutBodyAndText(doc, group);
  if (!members) return null;
  const { body, text } = members;
  const geometry = resolveTextGeometry(text);
  const padding = Math.max(0, group.callout.padding);
  const availableWidth = Math.max(0, body.shape.w - padding * 2);
  const availableHeight = Math.max(0, body.shape.h - padding * 2);
  const excessWidth = Math.max(0, geometry.layout.w - availableWidth);
  const excessHeight = Math.max(0, geometry.layout.h - availableHeight);
  const widthRatio = availableWidth > 0 ? geometry.layout.w / availableWidth : Infinity;
  const heightRatio = availableHeight > 0 ? geometry.layout.h / availableHeight : Infinity;
  const status: CalloutFitStatus =
    excessWidth > 0.01 || excessHeight > 0.01
      ? 'overflow'
      : Math.max(widthRatio, heightRatio) >= 0.88
        ? 'near-overflow'
        : 'fit';
  return {
    status,
    policy: group.callout.fitPolicy ?? (group.callout.fitToText ? 'fit-balloon' : 'reflow'),
    wrapShape: text.textWrapShape ?? 'rect',
    padding,
    availableWidth,
    availableHeight,
    layoutWidth: geometry.layout.w,
    layoutHeight: geometry.layout.h,
    excessWidth,
    excessHeight,
  };
}

/** Logical tails of a recipe; recipes predating `tails` read as pointed tails. */
export function calloutTails(group: GroupNode & { callout: CalloutRecipe }): CalloutTail[] {
  const stored = group.callout.tails;
  if (stored && stored.length > 0) return stored;
  return group.callout.tailNodeIds.map((nodeId) => ({ nodeIds: [nodeId], style: 'pointed' }));
}

function replaceTails(
  doc: Document,
  group: GroupNode & { callout: CalloutRecipe },
  tails: CalloutTail[],
): Document {
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [group.id]: {
        ...group,
        callout: {
          ...group.callout,
          tails,
          tailNodeIds: tails.flatMap((tail) => tail.nodeIds),
        },
      },
    },
  };
}

/** Remove a logical tail's nodes from the group children and the node map. */
function removeTailNodes(
  doc: Document,
  groupId: NodeId,
  tail: CalloutTail,
): { nodes: Record<NodeId, SceneNode>; children: NodeId[] } {
  const nodes = { ...doc.nodes };
  for (const nodeId of tail.nodeIds) delete nodes[nodeId];
  const group = doc.nodes[groupId];
  const children =
    group?.kind === 'group' ? group.children.filter((id) => !tail.nodeIds.includes(id)) : [];
  return { nodes, children };
}

/** Geometry refresh for every tail after the body changed size. */
function updateTailGeometry(
  nodes: Record<NodeId, SceneNode>,
  tails: readonly CalloutTail[],
  width: number,
  height: number,
): Record<NodeId, SceneNode> {
  const next = { ...nodes };
  for (const tail of tails) {
    if (tail.style === 'thought') {
      const last = tail.nodeIds[tail.nodeIds.length - 1];
      const lastNode = last ? next[last] : undefined;
      const endpoint =
        lastNode?.kind === 'shape' && lastNode.shape.kind === 'circle'
          ? { x: lastNode.shape.cx, y: lastNode.shape.cy }
          : { x: width / 2, y: height + 24 };
      const geometry = thoughtBubbleGeometry(width, height, endpoint, tail.bubbleCount ?? 3);
      tail.nodeIds.forEach((nodeId, index) => {
        const node = next[nodeId];
        const bubble = geometry[index];
        if (node?.kind === 'shape' && node.shape.kind === 'circle' && bubble) {
          next[nodeId] = { ...node, shape: { ...node.shape, ...bubble } };
        }
      });
      continue;
    }
    const nodeId = tail.nodeIds[0];
    const tailNode = nodeId ? next[nodeId] : undefined;
    if (tailNode?.kind !== 'path' || tailNode.points.length < 3) continue;
    const endpoint = tailNode.points[tailNode.points.length - 1]!;
    next[nodeId!] = {
      ...tailNode,
      points: pointedTailPoints(width, height, { x: endpoint.x, y: endpoint.y }, tail),
    };
  }
  return next;
}

function setTextContainer(
  text: TextNode,
  width: number,
  height: number,
  padding: number,
): TextNode {
  const transform = [
    text.transform[0],
    text.transform[1],
    text.transform[2],
    text.transform[3],
    padding,
    padding,
  ] as Affine;
  return {
    ...text,
    transform,
    ...(text.w !== undefined ? { w: Math.max(1, width) } : {}),
    ...(text.h !== undefined ? { h: Math.max(1, height) } : {}),
  };
}

/**
 * Update the semantic style while retaining the body and text identities.
 *
 * Tails are rebuilt when the style changes between pointed and thought,
 * because the two draw with different node kinds. The authored endpoint of
 * each logical tail is preserved, and the body/text node ids never change.
 */
export function updateCalloutKind(doc: Document, groupId: NodeId, kind: CalloutKind): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const body = doc.nodes[group.callout.bodyNodeId];
  if (body?.kind !== 'shape' || body.shape.kind !== 'rect') return doc;
  const tails = calloutTails(group);
  const nextStyle = tailStyleForKind(kind);
  let nodes: Record<NodeId, SceneNode> = {
    ...doc.nodes,
    [body.id]: {
      ...body,
      cornerRadius: calloutStyle(kind).cornerRadius,
      strokes: [bubbleStroke(kind)],
    },
  };
  const nextTails: CalloutTail[] = [];
  for (const tail of tails) {
    if (tail.style === nextStyle) {
      // Same node kind: keep identities and restyle strokes in place.
      for (const nodeId of tail.nodeIds) {
        const node = nodes[nodeId];
        if (node?.kind === 'path' || node?.kind === 'shape') {
          nodes[nodeId] = { ...node, strokes: [bubbleStroke(kind)] };
        }
      }
      nextTails.push(tail);
      continue;
    }
    const endpoint = tailEndpointFor(tail, nodes, body.shape);
    for (const nodeId of tail.nodeIds) delete nodes[nodeId];
    const rebuilt = buildTailNodes(
      { ...doc, nodes },
      kind,
      nextStyle,
      body.shape.w,
      body.shape.h,
      endpoint,
      {
        curve: tail.curve,
        baseWidth: tail.baseWidth,
        bubbleCount: tail.bubbleCount,
      },
    );
    let builtDoc = rebuilt.doc;
    for (const node of rebuilt.nodes) builtDoc = addChild(builtDoc, groupId, node);
    nodes = { ...builtDoc.nodes };
    nextTails.push(rebuilt.tail);
  }
  const children = [
    body.id,
    ...nextTails.flatMap((tail) => tail.nodeIds),
    group.callout.textNodeId,
  ];
  const withChildren = {
    ...doc,
    nodes: {
      ...nodes,
      [groupId]: { ...group, children, callout: { ...group.callout, kind } },
    },
  };
  return replaceTails(
    withChildren,
    withChildren.nodes[groupId] as GroupNode & { callout: CalloutRecipe },
    nextTails,
  );
}

/** Authored endpoint of a logical tail (pointed tip or last thought bubble). */
function tailEndpointFor(
  tail: CalloutTail,
  nodes: Record<NodeId, SceneNode>,
  body: Extract<ShapeNode['shape'], { kind: 'rect' }>,
): { x: number; y: number } {
  if (tail.style === 'thought') {
    const last = tail.nodeIds[tail.nodeIds.length - 1];
    const node = last ? nodes[last] : undefined;
    if (node?.kind === 'shape' && node.shape.kind === 'circle') {
      return { x: node.shape.cx, y: node.shape.cy };
    }
    return { x: body.w / 2, y: body.h + 24 };
  }
  const nodeId = tail.nodeIds[0];
  const node = nodeId ? nodes[nodeId] : undefined;
  if (node?.kind === 'path' && node.points.length > 0) {
    const tip = node.points[node.points.length - 1]!;
    return { x: tip.x, y: tip.y };
  }
  return { x: body.w / 2, y: body.h + 24 };
}

/** Move one tail endpoint in callout-local coordinates. */
export function updateCalloutTailEndpoint(
  doc: Document,
  groupId: NodeId,
  tailId: NodeId,
  endpoint: { x: number; y: number },
): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const tails = calloutTails(group);
  const tail = tails.find((candidate) => candidate.nodeIds.includes(tailId));
  if (!tail) return doc;
  const body = doc.nodes[group.callout.bodyNodeId];
  if (body?.kind !== 'shape' || body.shape.kind !== 'rect') return doc;
  const w = body.shape.w;
  const h = body.shape.h;
  const nodes = { ...doc.nodes };
  if (tail.style === 'thought') {
    const geometry = thoughtBubbleGeometry(w, h, endpoint, tail.bubbleCount ?? 3);
    tail.nodeIds.forEach((nodeId, index) => {
      const node = nodes[nodeId];
      const bubble = geometry[index];
      if (node?.kind === 'shape' && node.shape.kind === 'circle' && bubble) {
        nodes[nodeId] = { ...node, shape: { ...node.shape, ...bubble } };
      }
    });
  } else {
    const nodeId = tail.nodeIds[0];
    const node = nodeId ? nodes[nodeId] : undefined;
    if (node?.kind !== 'path' || node.points.length < 3) return doc;
    nodes[nodeId!] = {
      ...node,
      points: pointedTailPoints(w, h, endpoint, tail),
    };
  }
  return { ...doc, nodes };
}

/** Add a second or subsequent tail to an existing callout group. */
export function addCalloutTail(
  doc: Document,
  groupId: NodeId,
  endpoint?: { x: number; y: number },
): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const body = doc.nodes[group.callout.bodyNodeId];
  if (body?.kind !== 'shape' || body.shape.kind !== 'rect') return doc;
  const w = body.shape.w;
  const h = body.shape.h;
  const tails = calloutTails(group);
  const built = buildTailNodes(
    doc,
    group.callout.kind,
    calloutTails(group)[0]?.style ?? 'pointed',
    w,
    h,
    endpoint ?? { x: w * 0.7, y: h + Math.max(24, h * 0.3) },
    {
      curve: tails[0]?.curve,
      baseWidth: tails[0]?.baseWidth,
      bubbleCount: tails[0]?.bubbleCount,
    },
  );
  let next = built.doc;
  for (const node of built.nodes) next = addChild(next, groupId, node);
  const updatedGroup = next.nodes[groupId] as GroupNode & { callout: CalloutRecipe };
  return replaceTails(next, updatedGroup, [...tails, built.tail]);
}

/** Remove a tail by any of its node ids; the node map is cleaned too. */
export function removeCalloutTail(doc: Document, groupId: NodeId, tailId: NodeId): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const tails = calloutTails(group);
  const tail = tails.find((candidate) => candidate.nodeIds.includes(tailId));
  if (!tail) return doc;
  const { nodes, children } = removeTailNodes(doc, groupId, tail);
  const withChildren = { ...doc, nodes: { ...nodes, [groupId]: { ...group, children } } };
  return replaceTails(
    withChildren,
    withChildren.nodes[groupId] as GroupNode & { callout: CalloutRecipe },
    tails.filter((candidate) => candidate !== tail),
  );
}

/** Mirror a tail's endpoint across the balloon's vertical centerline. */
export function flipCalloutTail(doc: Document, groupId: NodeId, tailId: NodeId): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const body = doc.nodes[group.callout.bodyNodeId];
  const tail = calloutTails(group).find((candidate) => candidate.nodeIds.includes(tailId));
  if (body?.kind !== 'shape' || body.shape.kind !== 'rect' || !tail) return doc;
  const endpoint = tailEndpointFor(tail, doc.nodes, body.shape);
  return updateCalloutTailEndpoint(doc, groupId, tailId, {
    x: body.shape.w - endpoint.x,
    y: endpoint.y,
  });
}

function updateTailSetting(
  doc: Document,
  groupId: NodeId,
  tailId: NodeId,
  patch: Partial<Pick<CalloutTail, 'curve' | 'baseWidth'>>,
): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const tails = calloutTails(group);
  const tail = tails.find((candidate) => candidate.nodeIds.includes(tailId));
  if (!tail || tail.style !== 'pointed') return doc;
  const nextTail: CalloutTail = { ...tail, ...patch };
  const body = doc.nodes[group.callout.bodyNodeId];
  const nodeId = tail.nodeIds[0];
  const node = nodeId ? doc.nodes[nodeId] : undefined;
  if (body?.kind !== 'shape' || body.shape.kind !== 'rect' || node?.kind !== 'path') {
    return replaceTails(
      doc,
      group,
      tails.map((candidate) => (candidate === tail ? nextTail : candidate)),
    );
  }
  const endpoint = tailEndpointFor(tail, doc.nodes, body.shape);
  const updated = {
    ...node,
    points: pointedTailPoints(body.shape.w, body.shape.h, endpoint, nextTail),
  };
  const withNode = { ...doc, nodes: { ...doc.nodes, [nodeId!]: updated } };
  return replaceTails(
    withNode,
    withNode.nodes[groupId] as GroupNode & { callout: CalloutRecipe },
    tails.map((candidate) => (candidate === tail ? nextTail : candidate)),
  );
}

/** Signed bend of a pointed tail, -1..1, as a fraction of its length. */
export function setCalloutTailCurve(
  doc: Document,
  groupId: NodeId,
  tailId: NodeId,
  curve: number,
): Document {
  return updateTailSetting(doc, groupId, tailId, {
    curve: Math.max(-1, Math.min(1, Number.isFinite(curve) ? curve : 0)),
  });
}

/** Base width of a pointed tail in px. */
export function setCalloutTailBaseWidth(
  doc: Document,
  groupId: NodeId,
  tailId: NodeId,
  baseWidth: number,
): Document {
  return updateTailSetting(doc, groupId, tailId, {
    baseWidth: Math.max(2, Number.isFinite(baseWidth) ? baseWidth : 2),
  });
}

/** Change the inset used by the fit operation; text geometry stays independent. */
export function updateCalloutPadding(doc: Document, groupId: NodeId, padding: number): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const next = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [groupId]: { ...group, callout: { ...group.callout, padding: Math.max(0, padding) } },
    },
  };
  const body = next.nodes[group.callout.bodyNodeId];
  const text = next.nodes[group.callout.textNodeId];
  if (body?.kind !== 'shape' || body.shape.kind !== 'rect' || text?.kind !== 'text') return next;
  const inset = Math.max(0, padding);
  const innerWidth = Math.max(1, body.shape.w - inset * 2);
  const innerHeight = Math.max(1, body.shape.h - inset * 2);
  return {
    ...next,
    nodes: { ...next.nodes, [text.id]: setTextContainer(text, innerWidth, innerHeight, inset) },
  };
}

/** Fit the body around the bound text without rewriting the text content. */
export function fitCalloutToText(doc: Document, groupId: NodeId): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const members = calloutBodyAndText(doc, group);
  if (!members) return doc;
  const { body, text } = members;
  const p = Math.max(0, group.callout.padding);
  const current = textLocalSize(text);

  // Contour wrapping depends on the inner box height, so a single pass can
  // change the line count. Iterate to a fixpoint (bounded, synchronous), then
  // take a final union pass so text can never clip.
  const layoutAt = (innerW: number, innerH: number): { w: number; h: number } =>
    resolveTextGeometry({
      ...textGeometryInput(text),
      w: Math.max(1, innerW),
      h: Math.max(1, innerH),
    }).layout;
  let innerW = current.w;
  let innerH = current.h;
  for (let pass = 0; pass < 4; pass++) {
    const layout = layoutAt(innerW, innerH);
    const nextW = Math.max(1, layout.w);
    const nextH = Math.max(1, layout.h);
    if (Math.abs(nextW - innerW) < 0.5 && Math.abs(nextH - innerH) < 0.5) break;
    innerW = nextW;
    innerH = nextH;
  }
  const settled = layoutAt(innerW, innerH);
  innerW = Math.max(innerW, settled.w);
  innerH = Math.max(innerH, settled.h);

  const localW = innerW + p * 2;
  const localH = innerH + p * 2;
  let nodes: Record<NodeId, SceneNode> = {
    ...doc.nodes,
    [body.id]: { ...body, shape: { ...body.shape, w: localW, h: localH } },
    [text.id]: setTextContainer(text, innerW, innerH, p),
  };
  nodes = updateTailGeometry(nodes, calloutTails(group), localW, localH);
  return {
    ...doc,
    nodes: {
      ...nodes,
      [groupId]: {
        ...group,
        callout: { ...group.callout, fitToText: true, fitPolicy: 'fit-balloon' },
      },
    },
  };
}

/**
 * Choose the interior wrap shape for the bound text. Authored, reversible, and
 * separate from fitting: switching a round balloon to a rectangular stack must
 * not resize the balloon behind the user's back.
 */
export function setCalloutWrapShape(
  doc: Document,
  groupId: NodeId,
  wrapShape: TextWrapShape,
): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const text = doc.nodes[group.callout.textNodeId];
  if (text?.kind !== 'text' || text.textWrapShape === wrapShape) return doc;
  return {
    ...doc,
    nodes: { ...doc.nodes, [text.id]: { ...text, textWrapShape: wrapShape } },
  };
}

/** Set the fitting policy without changing authored geometry. */
export function setCalloutFitPolicy(
  doc: Document,
  groupId: NodeId,
  fitPolicy: CalloutFitPolicy,
): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [groupId]: {
        ...group,
        callout: { ...group.callout, fitPolicy, fitToText: fitPolicy === 'fit-balloon' },
      },
    },
  };
}

/** Direct path editing can call this to make the recipe opt out of regeneration. */
export function detachCalloutRecipe(doc: Document, groupId: NodeId): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [groupId]: { ...group, callout: { ...group.callout, parametric: false } },
    },
  };
}

export function isCalloutGroup(
  node: SceneNode | undefined,
): node is GroupNode & { callout: CalloutRecipe } {
  return node?.kind === 'group' && node.callout !== undefined;
}
