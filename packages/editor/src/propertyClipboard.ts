/**
 * propertyClipboard — copy/paste paint properties (style painter).
 *
 * Copies the visual properties of one node (fills, strokes, effects,
 * opacity, blend mode, corner radius; typography for text) and applies them
 * to any number of target nodes. Application is per-kind: text targets also
 * receive typography, shape/frame targets receive geometry-affecting
 * appearance (corner radius), and unsupported properties are skipped.
 *
 * The clipboard is in-memory per session (like most design tools). It never
 * touches the OS clipboard, so it cannot collide with asset copy/paste.
 */
import type { SceneNode } from '@varve/scene';

/** The in-memory style clipboard. Session-scoped, never serialized. */
let propertyClipboard: PaintProperties | null = null;

export function setPropertyClipboard(props: PaintProperties): void {
  propertyClipboard = props;
}

export function getPropertyClipboard(): PaintProperties {
  return propertyClipboard ?? {};
}

export interface PaintProperties {
  /** Stacked fills (deep-cloned so later mutation cannot alias the source). */
  fills?: SceneNode['fills'];
  /** Legacy single fill. */
  fill?: SceneNode['fill'];
  strokes?: SceneNode['strokes'];
  effects?: SceneNode['effects'];
  opacity?: number;
  blendMode?: SceneNode['blendMode'];
  /** Shape/frame corner radius (uniform or per-corner). */
  cornerRadius?: number | [number, number, number, number];
  cornerSmoothing?: number;
  // Typography — text targets only.
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number;
  letterSpacing?: number;
  tracking?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Pull the copyable visual properties off a node. */
export function extractPaintProperties(node: SceneNode): PaintProperties {
  const props: PaintProperties = {};
  if (node.fills !== undefined) props.fills = clone(node.fills);
  if (node.fill !== undefined) props.fill = clone(node.fill);
  if ('strokes' in node && node.strokes !== undefined) props.strokes = clone(node.strokes);
  if ('effects' in node && node.effects !== undefined) props.effects = clone(node.effects);
  if (node.opacity !== undefined) props.opacity = node.opacity;
  if (node.blendMode !== undefined) props.blendMode = node.blendMode;
  if ('cornerRadius' in node && node.cornerRadius !== undefined) {
    props.cornerRadius = clone(node.cornerRadius);
  }
  if ('cornerSmoothing' in node && node.cornerSmoothing !== undefined) {
    props.cornerSmoothing = node.cornerSmoothing;
  }
  if (node.kind === 'text') {
    const t = node;
    if (t.fontFamily !== undefined) props.fontFamily = t.fontFamily;
    if (t.fontSize !== undefined) props.fontSize = t.fontSize;
    if (t.fontWeight !== undefined) props.fontWeight = t.fontWeight;
    if (t.fontStyle !== undefined) props.fontStyle = t.fontStyle;
    if (t.lineHeight !== undefined) props.lineHeight = t.lineHeight;
    if (t.letterSpacing !== undefined) props.letterSpacing = t.letterSpacing;
    if (t.tracking !== undefined) props.tracking = t.tracking;
    if (t.textAlign !== undefined) props.textAlign = t.textAlign;
    if (t.textAlignVertical !== undefined) props.textAlignVertical = t.textAlignVertical;
  }
  return props;
}

/** Whether the clipboard holds anything copyable. */
export function hasPaintProperties(props: PaintProperties): boolean {
  return Object.keys(props).length > 0;
}

/** Apply copied properties to a node; returns a new node or the same node. */
export function applyPaintProperties(
  node: SceneNode,
  props: PaintProperties,
  options: { includeTypography?: boolean } = {},
): SceneNode {
  const next: SceneNode = node;
  const includeTypography = options.includeTypography ?? node.kind === 'text';

  const patch: Record<string, unknown> = {};
  if (props.fills !== undefined) patch.fills = clone(props.fills);
  if (props.fill !== undefined) patch.fill = clone(props.fill);
  if (props.strokes !== undefined && 'strokes' in node) patch.strokes = clone(props.strokes);
  if (props.effects !== undefined && 'effects' in node) patch.effects = clone(props.effects);
  if (props.opacity !== undefined) patch.opacity = props.opacity;
  if (props.blendMode !== undefined) patch.blendMode = props.blendMode;
  // Corner radius applies to any geometry-carrying node (shape/frame), not
  // only to nodes that already have a radius set — pasting a style must be
  // able to introduce the property.
  if (props.cornerRadius !== undefined && (node.kind === 'shape' || node.kind === 'frame')) {
    patch.cornerRadius = clone(props.cornerRadius);
  }
  if (props.cornerSmoothing !== undefined && (node.kind === 'shape' || node.kind === 'frame')) {
    patch.cornerSmoothing = props.cornerSmoothing;
  }
  if (includeTypography && node.kind === 'text') {
    for (const key of [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'lineHeight',
      'letterSpacing',
      'tracking',
      'textAlign',
      'textAlignVertical',
    ] as const) {
      if (props[key] !== undefined) patch[key] = props[key];
    }
  }

  if (Object.keys(patch).length === 0) return node;
  return { ...next, ...patch } as SceneNode;
}
