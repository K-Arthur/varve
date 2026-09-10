import { contrastRatio, managedColorToRgba, relativeLuminance } from '@varve/shared';
import type { ManagedColor } from '../colorManagement';
import type { Document } from '../document';
import { getParent } from '../document';
import type { Fill, NodeId, SceneNode } from '../types';
import {
  buildReport,
  type LinterIssue,
  type LinterOptions,
  type LinterReport,
} from './linterTypes';

let _scanCounter = 0;

export function runLinterScan(doc: Document, opts: LinterOptions = {}): LinterReport {
  const start = performance.now();
  _scanCounter++;

  const ids = opts.scopeIds;
  const pageId = opts.pageId;

  const issues: LinterIssue[] = [
    ...checkZeroSizeLayers(doc, ids, pageId),
    ...checkOffCanvasLayers(doc, opts),
    ...checkEmptyContainers(doc, ids, pageId),
    ...checkNonTextContrast(doc, opts),
    ...checkTouchTargets(doc, ids),
    ...checkFocusOrder(doc, ids),
  ];

  const duration = performance.now() - start;
  return buildReport(issues, _scanCounter, duration);
}

const INTENTIONAL_ZERO_SIZE_KINDS = new Set(['path', 'line', 'arrow']);
const INTENTIONAL_ZERO_SIZE_SHAPES = new Set(['path', 'line', 'arrow']);

function isEffectivelyVisible(node: SceneNode): boolean {
  return node.visible !== false && !node.locked;
}

function isContainer(node: SceneNode): boolean {
  return node.kind === 'frame' || node.kind === 'group';
}

function nodeWorldBounds(
  doc: Document,
  id: NodeId,
): { x: number; y: number; w: number; h: number } | null {
  const node = doc.nodes[id];
  if (!node) return null;
  if (node.kind === 'shape') {
    const s = node.shape as unknown as {
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      kind: string;
    };
    if (s.x != null && s.y != null && s.w != null && s.h != null) {
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    }
    return { x: 0, y: 0, w: 100, h: 100 };
  }
  if (node.kind === 'frame') {
    return { x: 0, y: 0, w: node.w, h: node.h };
  }
  if (node.kind === 'text') {
    return { x: 0, y: 0, w: node.w ?? 200, h: node.h ?? 40 };
  }
  return null;
}

function getInteractiveNodeIds(doc: Document): Set<NodeId> {
  const ids = new Set<NodeId>();
  const docAny = doc as unknown as Record<string, unknown>;
  const interactions = docAny.interactions;
  if (interactions && typeof interactions === 'object') {
    for (const key of Object.keys(interactions as Record<string, unknown>)) {
      ids.add(key);
    }
  }
  return ids;
}

const RULE_ZERO_SIZE = 'layer-hygiene/zero-size/v1';

export function checkZeroSizeLayers(
  doc: Document,
  scopeIds?: NodeId[],
  _pageId?: string,
): LinterIssue[] {
  const issues: LinterIssue[] = [];
  const nodeList = scopeIds
    ? scopeIds.map((id) => doc.nodes[id]).filter(Boolean)
    : Object.values(doc.nodes);

  for (const node of nodeList) {
    if (!node || !isEffectivelyVisible(node)) continue;
    if (INTENTIONAL_ZERO_SIZE_KINDS.has(node.kind)) continue;
    if (
      node.kind === 'shape' &&
      'shape' in node &&
      node.shape &&
      INTENTIONAL_ZERO_SIZE_SHAPES.has((node.shape as unknown as { kind: string }).kind)
    )
      continue;

    const bounds = nodeWorldBounds(doc, node.id);
    if (!bounds) continue;

    const zeroW = bounds.w <= 0 || Math.abs(bounds.w) < 0.01;
    const zeroH = bounds.h <= 0 || Math.abs(bounds.h) < 0.01;

    if (!zeroW && !zeroH) continue;

    issues.push({
      ruleId: RULE_ZERO_SIZE,
      severity: 'warning',
      category: 'layer-hygiene',
      nodeIds: [node.id],
      message: `"${node.name}" has ${zeroW ? 'zero width' : ''}${zeroW && zeroH ? ' and ' : ''}${zeroH ? 'zero height' : ''}.`,
      detail: `The node's bounding box has zero size (${bounds.w}\u00d7${bounds.h}). It will not be visible or interactive.`,
      evidence: { w: bounds.w, h: bounds.h },
      fixes: [],
      dismissable: true,
      version: '1',
      cost: 'cheap',
      scope: scopeIds ? 'selection' : 'document',
    });
  }

  return issues;
}

const RULE_OFF_CANVAS = 'layer-hygiene/off-canvas/v1';

export function checkOffCanvasLayers(doc: Document, _opts: LinterOptions = {}): LinterIssue[] {
  const issues: LinterIssue[] = [];

  const docAny = doc as unknown as Record<string, unknown>;
  const canvasW = (docAny.canvasWidth as number) ?? 1920;
  const canvasH = (docAny.canvasHeight as number) ?? 1080;
  const margin = 5000;

  for (const node of Object.values(doc.nodes)) {
    if (!node || !isEffectivelyVisible(node)) continue;

    const bounds = nodeWorldBounds(doc, node.id);
    if (!bounds) continue;

    const outsideCanvas =
      bounds.x + bounds.w < -margin ||
      bounds.x > canvasW + margin ||
      bounds.y + bounds.h < -margin ||
      bounds.y > canvasH + margin;

    if (!outsideCanvas) continue;

    issues.push({
      ruleId: RULE_OFF_CANVAS,
      severity: 'warning',
      category: 'layer-hygiene',
      nodeIds: [node.id],
      message: `"${node.name}" is far outside the canvas (${Math.round(bounds.x)}, ${Math.round(bounds.y)}).`,
      detail: `The node's bounding box at (${Math.round(bounds.x)}, ${Math.round(bounds.y)}) ${Math.round(bounds.w)}\u00d7${Math.round(bounds.h)} is more than ${margin}px outside the canvas (0, 0, ${canvasW}\u00d7${canvasH}). Consider deleting or moving it back on canvas.`,
      evidence: { worldX: bounds.x, worldY: bounds.y, canvasW, canvasH },
      fixes: [],
      dismissable: true,
      version: '1',
      cost: 'cheap',
      scope: 'document',
    });
  }

  return issues;
}

const RULE_EMPTY_CONTAINER = 'layer-hygiene/empty-container/v1';

export function checkEmptyContainers(
  doc: Document,
  scopeIds?: NodeId[],
  _pageId?: string,
): LinterIssue[] {
  const issues: LinterIssue[] = [];
  const nodeList = scopeIds
    ? scopeIds.map((id) => doc.nodes[id]).filter(Boolean)
    : Object.values(doc.nodes);

  for (const node of nodeList) {
    if (!node || !isEffectivelyVisible(node)) continue;
    if (!isContainer(node)) continue;

    const children = 'children' in node ? node.children : [];
    if (!children || children.length === 0) continue;

    const hasVisibleChild = children.some((childId: NodeId) => {
      const child = doc.nodes[childId];
      return child && isEffectivelyVisible(child);
    });

    if (hasVisibleChild) continue;

    const hasOwnFill =
      node.fills && node.fills.length > 0 && node.fills.some((f) => f.visible !== false);

    if (hasOwnFill) continue;

    const visibleChildCount = children.length;
    issues.push({
      ruleId: RULE_EMPTY_CONTAINER,
      severity: 'info',
      category: 'layer-hygiene',
      nodeIds: [node.id],
      message: `"${node.name}" contains ${visibleChildCount} non-visible ${visibleChildCount === 1 ? 'child' : 'children'} only.`,
      detail: `This ${node.kind} contains ${visibleChildCount} child node${visibleChildCount === 1 ? '' : 's'} that ${visibleChildCount === 1 ? 'is' : 'are'} all invisible or locked. Consider cleaning it up.`,
      evidence: { kind: node.kind, childCount: children.length, visibleChildCount: 0 },
      fixes: [],
      dismissable: true,
      version: '1',
      cost: 'cheap',
      scope: scopeIds ? 'selection' : 'document',
    });
  }

  return issues;
}

const RULE_NON_TEXT_CONTRAST = 'accessibility/non-text-contrast/v1';

const INTERACTIVE_NAME_PATTERNS = [
  /^btn/i,
  /^button/i,
  /^icon/i,
  /^toggle/i,
  /^switch/i,
  /^checkbox/i,
  /^radio/i,
  /^menu/i,
  /^tab/i,
  /^close/i,
  /^dismiss/i,
  /^search/i,
  /^input/i,
  /^slider/i,
  /^arrow/i,
];

const DECORATIVE_NAME_PATTERNS = [
  /^divider/i,
  /^separator/i,
  /^spacer/i,
  /^background$/i,
  /^decoration/i,
  /^ornament/i,
];

const ESSENTIAL_NAME_PATTERNS = [/^logo/i, /^brand/i, /^watermark/i];

function resolveAdjacentBackground(doc: Document, nodeId: NodeId): ManagedColor | null {
  const parent = getParent(doc, nodeId);
  if (!parent) return null;
  const parentNode = doc.nodes[parent];
  if (!parentNode) return null;
  const fills = (parentNode as unknown as Record<string, unknown>).fills as Fill[] | undefined;
  if (!fills || fills.length === 0) return null;
  const solidFill = fills.find((f) => f.visible !== false && f.type === 'solid');
  return solidFill?.color ?? null;
}

function getEffectiveColor(node: SceneNode): ManagedColor | null {
  const nodeAny = node as unknown as Record<string, unknown>;
  const fills = nodeAny.fills as Fill[] | undefined;
  if (!fills || fills.length === 0) {
    if (node.kind === 'text') {
      return (nodeAny.fill as ManagedColor) ?? null;
    }
    return null;
  }
  const solidFill = fills.find((f) => f.visible !== false && f.type === 'solid');
  if (solidFill?.color) return solidFill.color;
  const gradientFill = fills.find((f) => f.visible !== false && f.type === 'gradient');
  if (gradientFill?.gradient?.stops?.length) {
    return gradientFill.gradient.stops[0]!.color;
  }
  return null;
}

export function checkNonTextContrast(doc: Document, opts: LinterOptions = {}): LinterIssue[] {
  const issues: LinterIssue[] = [];
  const threshold = opts.nonTextContrastThreshold ?? 3;
  const interactiveIds = getInteractiveNodeIds(doc);

  for (const node of Object.values(doc.nodes)) {
    if (!node || node.visible === false || node.locked) continue;
    const nodeId = node.id;
    if (DECORATIVE_NAME_PATTERNS.some((p) => p.test(node.name))) continue;
    if (ESSENTIAL_NAME_PATTERNS.some((p) => p.test(node.name))) continue;

    if (node.kind === 'text') {
      const nodeAny = node as unknown as Record<string, unknown>;
      const fill = nodeAny.fill as ManagedColor | undefined;
      if (!fill || (fill.space === 'rgb' && fill.r === 0 && fill.g === 0 && fill.b === 0)) continue;
    }

    const isInteractive = interactiveIds.has(nodeId);
    const isControlLike = INTERACTIVE_NAME_PATTERNS.some((p) => p.test(node.name));
    const isIcon = node.kind === 'shape' && isIconSized(node, doc);

    if (!isInteractive && !isControlLike && !isIcon) continue;

    const fgColor = getEffectiveColor(node);
    if (fgColor?.space !== 'rgb') continue;

    const [, , , fgA] = managedColorToRgba(fgColor);
    if (fgA === 0) continue;

    const bgColor = resolveAdjacentBackground(doc, nodeId);

    if (!bgColor) {
      issues.push({
        ruleId: RULE_NON_TEXT_CONTRAST,
        severity: 'suggestion',
        category: 'color',
        nodeIds: [nodeId],
        message: `"${node.name}" may have insufficient contrast \u2014 background context is unclear.`,
        detail: `WCAG 2.1 SC 1.4.11 requires UI components and meaningful graphics to have at least ${threshold}:1 contrast against adjacent colors. The effective background could not be determined from the document model (blend modes, masks, or alpha compositing may be in use).`,
        evidence: { reason: 'undetermined-background', threshold },
        fixes: [],
        dismissable: true,
        version: '1',
        cost: 'moderate',
        scope: 'document',
        confidence: 0.3,
      });
      continue;
    }

    const [fr, fg, fb] = managedColorToRgba(fgColor);
    const [br, bg, bb] = managedColorToRgba(bgColor);
    const fgLum = relativeLuminance(fr, fg, fb);
    const bgLum = relativeLuminance(br, bg, bb);
    const ratio = contrastRatio(fgLum, bgLum);

    if (ratio >= threshold) continue;

    const severity = isInteractive ? 'warning' : 'info';
    const confidence = isInteractive ? 0.85 : 0.6;

    issues.push({
      ruleId: RULE_NON_TEXT_CONTRAST,
      severity,
      category: 'color',
      nodeIds: [nodeId],
      message: `"${node.name}" has ${ratio.toFixed(1)}:1 non-text contrast (minimum ${threshold}:1).`,
      detail: isInteractive
        ? `This interactive element's visible boundary or content has ${ratio.toFixed(1)}:1 contrast against the background. WCAG 2.1 SC 1.4.11 requires at least ${threshold}:1 for user interface components.`
        : `This graphical element has ${ratio.toFixed(1)}:1 contrast against the background. WCAG 2.1 SC 1.4.11 requires at least ${threshold}:1 for meaningful graphics.`,
      evidence: {
        ratio: Math.round(ratio * 100) / 100,
        threshold,
        fgColor: managedColorToRgba(fgColor),
        bgColor: managedColorToRgba(bgColor),
        isInteractive,
      },
      fixes: [],
      dismissable: true,
      version: '1',
      cost: 'moderate',
      scope: 'document',
      confidence,
    });
  }

  return issues;
}

function isIconSized(node: SceneNode, _doc: Document): boolean {
  const bounds = nodeWorldBounds(_doc, node.id);
  if (!bounds) return false;
  return bounds.w <= 64 && bounds.h <= 64;
}

const RULE_TOUCH_TARGET = 'accessibility/touch-target/v1';

export function checkTouchTargets(
  doc: Document,
  scopeIds?: NodeId[],
  options: { minSize?: number } = {},
): LinterIssue[] {
  const issues: LinterIssue[] = [];
  const minSize = options.minSize ?? 44;

  const interactiveIds = getInteractiveNodeIds(doc);
  if (interactiveIds.size === 0) return issues;

  const nodeList = scopeIds
    ? scopeIds.map((id) => doc.nodes[id]).filter(Boolean)
    : Object.values(doc.nodes);

  for (const node of nodeList) {
    if (!node) continue;
    if (!interactiveIds.has(node.id)) continue;

    const bounds = nodeWorldBounds(doc, node.id);
    if (!bounds) continue;

    const minDimension = Math.min(bounds.w, bounds.h);
    if (minDimension >= minSize) continue;

    const isHidden = node.visible === false;

    issues.push({
      ruleId: RULE_TOUCH_TARGET,
      severity: isHidden ? 'info' : 'warning',
      category: 'touch-target',
      nodeIds: [node.id],
      message: `Interactive node "${node.name}" has a ${Math.round(minDimension)}px touch target (minimum ${minSize}px).`,
      detail: `The node has prototype interactions but its smallest visual dimension is ${Math.round(minDimension)}px, below the recommended ${minSize}px minimum touch target (WCAG 2.5.8). Consider increasing its size or adding invisible padding.${isHidden ? ' The node is also hidden \u2014 it may be a hotspot layer.' : ''}`,
      evidence: {
        actualSize: Math.round(minDimension * 10) / 10,
        minSize,
        isHidden: !!isHidden,
        w: Math.round(bounds.w * 10) / 10,
        h: Math.round(bounds.h * 10) / 10,
      },
      fixes: [],
      dismissable: true,
      version: '1',
      cost: 'cheap',
      scope: 'document',
      confidence: 0.9,
    });
  }

  return issues;
}

const RULE_FOCUS_ORDER = 'accessibility/focus-order/v1';

export interface FocusOrderAnalysis {
  entries: Array<{
    nodeId: NodeId;
    name: string;
    index: number;
    screenX: number;
    screenY: number;
    w: number;
    h: number;
    kind: string;
  }>;
  issues: LinterIssue[];
}

export function analyzeFocusOrder(doc: Document, scopeIds?: NodeId[]): FocusOrderAnalysis {
  const entries: FocusOrderAnalysis['entries'] = [];
  const interactiveIds = getInteractiveNodeIds(doc);
  const visited = new Set<string>();

  function walk(ids: NodeId[], depth: number) {
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i]!;
      const node = doc.nodes[id];
      if (!node || visited.has(id)) continue;
      visited.add(id);

      const isInteractive = interactiveIds.has(id);
      const isText = node.kind === 'text';
      const isLinkLike = isText && /button|link|cta|nav/i.test(node.name);
      if (!isInteractive && !isText && !isLinkLike) {
        if (isContainer(node) && 'children' in node && node.children) {
          walk(node.children, depth + 1);
        }
        continue;
      }

      const bounds = nodeWorldBounds(doc, id);
      const idx = entries.length + 1;
      entries.push({
        nodeId: id,
        name: node.name,
        index: idx,
        screenX: bounds?.x ?? 0,
        screenY: bounds?.y ?? 0,
        w: bounds?.w ?? 0,
        h: bounds?.h ?? 0,
        kind: node.kind,
      });

      if (isContainer(node) && 'children' in node && node.children) {
        walk(node.children, depth + 1);
      }
    }
  }

  walk((scopeIds ?? doc.rootChildren) as NodeId[], 0);

  const issues: LinterIssue[] = [];

  for (const id of interactiveIds) {
    if (!visited.has(id)) {
      const node = doc.nodes[id];
      if (node && isEffectivelyVisible(node)) {
        issues.push({
          ruleId: RULE_FOCUS_ORDER,
          severity: 'warning',
          category: 'focus-order',
          nodeIds: [id],
          message: `Interactive node "${node.name}" is not reachable in the focus order.`,
          detail:
            'This node has prototype interactions but is not in the layer tree paint order. It may be invisible or inside a non-rendering container.',
          evidence: { totalEntries: entries.length },
          fixes: [],
          dismissable: true,
          version: '1',
          cost: 'moderate',
          scope: 'prototype',
        });
      }
    }
  }

  const seenIndices = new Map<number, NodeId[]>();
  for (const e of entries) {
    const existing = seenIndices.get(e.index) ?? [];
    existing.push(e.nodeId);
    seenIndices.set(e.index, existing);
  }
  for (const [index, ids] of seenIndices) {
    if (ids.length > 1) {
      issues.push({
        ruleId: RULE_FOCUS_ORDER,
        severity: 'warning',
        category: 'focus-order',
        nodeIds: ids,
        message: `${ids.length} nodes share focus index ${index}.`,
        detail:
          'Multiple interactive nodes have the same focus index, which may cause ambiguous tab order.',
        evidence: { index, count: ids.length },
        fixes: [],
        dismissable: true,
        version: '1',
        cost: 'cheap',
        scope: 'prototype',
      });
    }
  }

  return { entries, issues };
}

export function checkFocusOrder(doc: Document, scopeIds?: NodeId[]): LinterIssue[] {
  return analyzeFocusOrder(doc, scopeIds).issues;
}
