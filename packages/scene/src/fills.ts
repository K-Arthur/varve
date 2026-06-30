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
import type { Color } from '@strata/engine';
import type {
  BlendMode,
  Fill,
  GradientFill,
  GradientStop,
  GradientType,
  ImageFillData,
  ImageFit,
  PatternFillData,
} from './types';

/** Create a solid fill from a Color. */
export function solidFill(
  color: Color,
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
    fit?: ImageFit;
    x?: number;
    y?: number;
    scale?: number;
    opacity?: number;
    blendMode?: BlendMode;
    visible?: boolean;
  } = {},
): Fill {
  const image: ImageFillData = {
    src,
    fit: opts.fit ?? 'fill',
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    scale: opts.scale ?? 1,
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
    opacity?: number;
    blendMode?: BlendMode;
    visible?: boolean;
  } = {},
): Fill {
  const pattern: PatternFillData = {
    tileSrc,
    spacing: opts.spacing ?? 0,
    rotation: opts.rotation ?? 0,
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
  return [solidFill([57, 208, 198, 255] as Color)];
}

/** Default fill stack for a text node (single solid dark). */
export function defaultTextFills(): Fill[] {
  return [solidFill([16, 21, 31, 255] as Color)];
}

/** Default fill stack for a frame node (single solid light gray). */
export function defaultFrameFills(): Fill[] {
  return [solidFill([200, 200, 200, 255] as Color)];
}

/** Default fill stack for a group node (transparent). */
export function defaultGroupFills(): Fill[] {
  return [solidFill([0, 0, 0, 0] as Color)];
}

/**
 * Resolve a node's effective fill stack.
 * Falls back to a single solid fill from the legacy `fill` field.
 */
export function resolveNodeFills(node: { fill: Color; fills?: Fill[] }): Fill[] {
  if (node.fills && node.fills.length > 0) return node.fills;
  return [solidFill(node.fill)];
}

/** Convert a Fill to a flat Color (for legacy code that expects a single Color). */
export function fillToColor(fill: Fill): Color {
  if (fill.type === 'solid' && fill.color) {
    const [r, g, b, a] = fill.color;
    return [r, g, b, Math.round(a * fill.opacity)] as Color;
  }
  // For gradients/images, return the first stop color or a fallback
  if (fill.type === 'gradient' && fill.gradient && fill.gradient.stops.length > 0) {
    const first = fill.gradient.stops[0];
    if (first) return first.color;
  }
  return [0, 0, 0, 0] as Color;
}

/** Get the "primary" color of a fill stack (topmost visible solid fill). */
export function primaryColor(fills: Fill[]): Color | null {
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
