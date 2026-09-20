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

function tailPoints(w: number, h: number, endpoint: { x: number; y: number }): PathPoint[] {
  const base = Math.max(12, Math.min(32, w * 0.16));
  const cx = w / 2;
  return [point(cx - base / 2, h - 1), point(cx + base / 2, h - 1), point(endpoint.x, endpoint.y)];
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

function tailNode(id: NodeId, w: number, h: number, endpoint: { x: number; y: number }): SceneNode {
  return makePathNode(id, {
    name: 'Balloon tail',
    points: tailPoints(w, h, endpoint),
    closed: true,
    fill: WHITE,
    strokes: [bubbleStroke('speech')],
  });
}

function recipe(
  kind: CalloutKind,
  bodyId: NodeId,
  textId: NodeId,
  tailNodeIds: NodeId[],
  padding: number,
): CalloutRecipe {
  return {
    version: 1,
    kind,
    bodyNodeId: bodyId,
    textNodeId: textId,
    tailNodeIds,
    padding,
    fitToText: false,
    fitPolicy: 'reflow',
    parametric: true,
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
  const tailResult = nextNodeId(next);
  next = tailResult.doc;
  const groupId = groupResult.id;
  const bodyId = bodyResult.id;
  const textId = textResult.id;
  const tailId = tailResult.id;

  const group = makeGroupNode(groupId, {
    name: `${kind[0]!.toUpperCase()}${kind.slice(1)} balloon`,
    transform: [1, 0, 0, 1, options.x, options.y] as Affine,
    children: [],
  });
  const body = bodyNode(bodyId, w, h, kind);
  const tail = tailNode(tailId, w, h, endpoint);
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
  next = addChild(next, groupId, tail);
  next = addChild(next, groupId, text);
  const insertedGroup = next.nodes[groupId] as GroupNode;
  next = {
    ...next,
    nodes: {
      ...next.nodes,
      [groupId]: {
        ...insertedGroup,
        callout: recipe(kind, bodyId, textId, [tailId], padding),
      },
    },
  };
  return { document: next, groupId, bodyId, textId, tailNodeIds: [tailId] };
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

function updateTailBases(
  nodes: Record<NodeId, SceneNode>,
  tailIds: readonly NodeId[],
  width: number,
  height: number,
): Record<NodeId, SceneNode> {
  const next = { ...nodes };
  for (const tailId of tailIds) {
    const tail = next[tailId];
    if (tail?.kind !== 'path' || tail.points.length < 3) continue;
    const endpoint = tail.points[tail.points.length - 1]!;
    next[tailId] = {
      ...tail,
      points: tailPoints(width, height, { x: endpoint.x, y: endpoint.y }),
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

/** Update the semantic style while retaining body/text/tail node identities. */
export function updateCalloutKind(doc: Document, groupId: NodeId, kind: CalloutKind): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const body = doc.nodes[group.callout.bodyNodeId];
  if (body?.kind !== 'shape') return doc;
  const nodes = {
    ...doc.nodes,
    [groupId]: { ...group, callout: { ...group.callout, kind } },
    [body.id]: {
      ...body,
      cornerRadius: calloutStyle(kind).cornerRadius,
      strokes: [bubbleStroke(kind)],
    },
  };
  for (const tailId of group.callout.tailNodeIds) {
    const tail = nodes[tailId];
    if (tail?.kind === 'path' || tail?.kind === 'shape') {
      nodes[tailId] = { ...tail, strokes: [bubbleStroke(kind)] };
    }
  }
  return { ...doc, nodes };
}

/** Move one tail endpoint in callout-local coordinates. */
export function updateCalloutTailEndpoint(
  doc: Document,
  groupId: NodeId,
  tailId: NodeId,
  endpoint: { x: number; y: number },
): Document {
  const group = calloutGroup(doc, groupId);
  const tail = doc.nodes[tailId];
  if (!group?.callout.tailNodeIds.includes(tailId) || tail?.kind !== 'path') return doc;
  if (tail.points.length === 0) return doc;
  const points = [...tail.points];
  points[points.length - 1] = { ...points[points.length - 1]!, x: endpoint.x, y: endpoint.y };
  return { ...doc, nodes: { ...doc.nodes, [tailId]: { ...tail, points } } };
}

/** Add a second or subsequent ordinary tail to an existing callout group. */
export function addCalloutTail(
  doc: Document,
  groupId: NodeId,
  endpoint?: { x: number; y: number },
): Document {
  const group = calloutGroup(doc, groupId);
  if (!group) return doc;
  const body = doc.nodes[group.callout.bodyNodeId];
  if (body?.kind !== 'shape' || body.shape.kind !== 'rect') return doc;
  const idResult = nextNodeId(doc);
  const w = body.shape.w;
  const h = body.shape.h;
  const nextTail = tailNode(
    idResult.id,
    w,
    h,
    endpoint ?? { x: w * 0.7, y: h + Math.max(24, h * 0.3) },
  );
  const withTail = addChild(idResult.doc, groupId, nextTail);
  const updatedGroup = withTail.nodes[groupId] as GroupNode;
  return {
    ...withTail,
    nodes: {
      ...withTail.nodes,
      [groupId]: {
        ...updatedGroup,
        callout: { ...group.callout, tailNodeIds: [...group.callout.tailNodeIds, idResult.id] },
      },
    },
  };
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
  nodes = updateTailBases(nodes, group.callout.tailNodeIds, localW, localH);
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
