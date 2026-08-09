/**
 * Fill helpers — solid/gradient/image fill constructors and resolution.
 *
 * P2: Multi-fill stacks. Nodes carry an optional `fills: Fill[]` alongside
 * the legacy `fill: Color`. When `fills` is present it takes precedence.
 * Helpers here bridge the two so engine/codegen/inspector code can treat
 * every node uniformly.
 *
 * Research basis: Figma/Sketch fill stacks (paint order bottom→top).
 */
import type { ManagedColor } from './colorManagement';
import type {
  BlendMode,
  Fill,
  GradientFill,
  GradientStop,
  GradientType,
  ImageFillData,
  ImageFit,
  PatternFillData,
  SceneNode,
  ShapeNode,
} from './types';
import { shapeHeight, shapeWidth } from './types';

/** Create a solid fill from a ManagedColor. */
export function solidFill(
  color: ManagedColor,
  opts: { opacity?: number; blendMode?: BlendMode; visible?: boolean } = {},
): Fill {
  return {
    type: 'solid',
    color,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    visible: opts.visible ?? true,
  };
}

/** Create a linear gradient fill from stops. */
export function gradientFill(
  type: GradientType,
  stops: GradientStop[],
  opts: { rotation?: number; opacity?: number; blendMode?: BlendMode; visible?: boolean } = {},
): Fill {
  const gradient: GradientFill = {
    type,
    stops,
    ...(opts.rotation !== undefined ? { rotation: opts.rotation } : {}),
  };
  return {
    type: 'gradient',
    gradient,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    visible: opts.visible ?? true,
  };
}

/** Create an image fill. */
export function imageFill(
  src: string,
  opts: {
    assetId?: string;
    fit?: ImageFit;
    x?: number;
    y?: number;
    scale?: number;
    imageWidth?: number;
    imageHeight?: number;
    opacity?: number;
    blendMode?: BlendMode;
    visible?: boolean;
  } = {},
): Fill {
  const image: ImageFillData = {
    src,
    ...(opts.assetId !== undefined ? { assetId: opts.assetId } : {}),
    fit: opts.fit ?? 'fill',
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    scale: opts.scale ?? 1,
    ...(opts.imageWidth !== undefined ? { imageWidth: opts.imageWidth } : {}),
    ...(opts.imageHeight !== undefined ? { imageHeight: opts.imageHeight } : {}),
  };
  return {
    type: 'image',
    image,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    visible: opts.visible ?? true,
  };
}

/** Create a pattern (tiled) fill. */
export function patternFill(
  tileSrc: string,
  opts: {
    spacing?: number;
    rotation?: number;
    imageWidth?: number;
    imageHeight?: number;
    opacity?: number;
    blendMode?: BlendMode;
    visible?: boolean;
  } = {},
): Fill {
  const pattern: PatternFillData = {
    tileSrc,
    spacing: opts.spacing ?? 0,
    rotation: opts.rotation ?? 0,
    ...(opts.imageWidth !== undefined ? { imageWidth: opts.imageWidth } : {}),
    ...(opts.imageHeight !== undefined ? { imageHeight: opts.imageHeight } : {}),
  };
  return {
    type: 'pattern',
    pattern,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    visible: opts.visible ?? true,
  };
}

/** Default fill stack for a shape node (single solid teal). */
export function defaultShapeFills(): Fill[] {
  return [solidFill({ space: 'rgb', r: 57, g: 208, b: 198, a: 255 })];
}

/** Default fill stack for a text node (single solid dark). */
export function defaultTextFills(): Fill[] {
  return [solidFill({ space: 'rgb', r: 16, g: 21, b: 31, a: 255 })];
}

/** Default fill stack for a frame node (single solid light gray). */
export function defaultFrameFills(): Fill[] {
  return [solidFill({ space: 'rgb', r: 200, g: 200, b: 200, a: 255 })];
}

/** Default fill stack for a group node (transparent). */
export function defaultGroupFills(): Fill[] {
  return [solidFill({ space: 'rgb', r: 0, g: 0, b: 0, a: 0 })];
}

/**
 * Resolve a node's effective fill stack.
 * Falls back to a single solid fill from the legacy `fill` field.
 */
export function resolveNodeFills(node: { fill: ManagedColor; fills?: Fill[] }): Fill[] {
  if (node.fills && node.fills.length > 0) return node.fills;
  return [solidFill(node.fill)];
}

/**
 * Convert a Fill to a flat ManagedColor.
 * For gradient fills, returns the first stop color.
 * For image/pattern fills, returns transparent black.
 */
export function fillToColor(fill: Fill): ManagedColor {
  if (fill.type === 'solid' && fill.color) {
    const c = fill.color;
    return { ...c, a: Math.round(c.a * fill.opacity) } as ManagedColor;
  }
  // For gradients, return the first stop color
  if (fill.type === 'gradient' && fill.gradient && fill.gradient.stops.length > 0) {
    const first = fill.gradient.stops[0];
    if (first) return first.color;
  }
  return { space: 'rgb', r: 0, g: 0, b: 0, a: 0 } as ManagedColor;
}

/** Get the "primary" color of a fill stack (topmost visible solid fill). */
export function primaryColor(fills: Fill[]): ManagedColor | null {
  for (let i = fills.length - 1; i >= 0; i--) {
    const f = fills[i];
    if (!f) continue;
    if (!f.visible) continue;
    if (f.type === 'solid' && f.color) return f.color;
    if (f.type === 'gradient' && f.gradient && f.gradient.stops.length > 0) {
      const first = f.gradient.stops[0];
      if (first) return first.color;
    }
  }
  return null;
}

// ── Image shape utilities (replacement for the removed ImageNode) ─────────

/** True if this shape node has at least one visible image fill with a src. */
export function isImageShape(n: SceneNode): boolean {
  return n.kind === 'shape' && !!n.fills?.some((f) => f.type === 'image' && !!f.image?.src);
}

/** Returns the first image fill on a shape node, or undefined. */
export function getImageFill(n: ShapeNode): Fill | undefined {
  return n.fills?.find((f) => f.type === 'image');
}

/** Returns the image src from the first image fill, or '' if none. */
export function imageShapeSrc(n: ShapeNode): string {
  return getImageFill(n)?.image?.src ?? '';
}

/** True when a node carries an animated-media image fill (v2.20+). */
export function isAnimatedMediaNode(n: SceneNode, doc?: import('./document').Document): boolean {
  if (n.kind !== 'shape') return false;
  const fills = n.fills;
  if (!fills) return false;
  for (const fill of fills) {
    if (fill.type !== 'image' || !fill.image) continue;
    const assetId = fill.image.assetId;
    if (assetId && doc?.assets?.[assetId]?.animated) return true;
  }
  return false;
}

/** The first animated-media fill on a node, or undefined. */
export function getAnimatedMediaFill(
  n: SceneNode,
  doc?: import('./document').Document,
): Fill | undefined {
  if (n.kind !== 'shape') return undefined;
  const fills = n.fills;
  if (!fills) return undefined;
  for (const fill of fills) {
    if (fill.type !== 'image' || !fill.image) continue;
    const assetId = fill.image.assetId;
    if (assetId && doc?.assets?.[assetId]?.animated) return fill;
  }
  return undefined;
}

/** Returns the rendered width of an image shape (via shapeWidth). */
export function imageShapeW(n: ShapeNode): number {
  return shapeWidth(n.shape);
}

/** Returns the rendered height of an image shape (via shapeHeight). */
export function imageShapeH(n: ShapeNode): number {
  return shapeHeight(n.shape);
}
