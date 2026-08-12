/**
 * Shared helpers for codegen targets — geometry-to-string, color formatting,
 * and shape vertex computations.
 */

import type { Affine } from '@varve/engine';
import type {
  BlendMode,
  ManagedColor,
  NodeId,
  Document as SceneDocument,
  SceneNode,
} from '@varve/scene';
import { managedColorToRgba, multiplyAffine, rotateDeg } from '@varve/shared';
import type { TargetGap } from './types';

/**
 * Effective local transform of a node: its affine with the separate
 * `rotation` field folded in as `transform · rotate(rotation)` — the exact
 * composition order the canvas renderer uses (rotation about the node
 * origin, applied after the transform). Every codegen emitter MUST use this
 * instead of reading `node.transform` directly, or rotated nodes export
 * unrotated.
 */
export function nodeEffectiveTransform(node: SceneNode): Affine {
  const rot = node.rotation ?? 0;
  if (rot === 0) return node.transform as Affine;
  return multiplyAffine(node.transform as Affine, rotateDeg(rot));
}

/**
 * Report a nondestructive adjustment stack (curves, levels, halftone, etc.)
 * on an adjustment-layer node.
 *
 * When `flattened` is true (caller supplies a pre-rasterized asset for this
 * node), the gap is reported with `severity: 'info'` — the export will be
 * correct via raster embedding.  When false (the default), the gap is a
 * `'warning'` because the node would be silently dropped.
 */
export function adjustmentStackTargetGaps(
  node: SceneNode,
  _doc?: import('@varve/scene').Document,
  flattened?: boolean,
): TargetGap[] {
  if (node.kind !== 'adjustment') return [];
  const visible = (node.adjustments ?? []).filter((a) => a.visible && a.opacity > 0);
  if (visible.length === 0) return [];
  const kinds = [...new Set(visible.map((a) => a.kind))].join(', ');
  if (flattened) {
    return [
      {
        nodeId: node.id,
        nodeName: node.name,
        feature: `nondestructive adjustment stack (${kinds})`,
        severity: 'info',
        fallback: 'Rasterized at export resolution — output is pixel-accurate',
      },
    ];
  }
  return [
    {
      nodeId: node.id,
      nodeName: node.name,
      feature: `nondestructive adjustment stack (${kinds})`,
      severity: 'warning',
      fallback:
        'Flatten the adjustment layer and export a rasterized bitmap, or reimplement the equivalent color/halftone processing natively for this target',
    },
  ];
}

export function rgba(c: ManagedColor | readonly [number, number, number, number]): string {
  if ('space' in c) {
    const [r, g, b, a] = managedColorToRgba(c);
    return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  }
  return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
}

/** Result of converting a ManagedColor to an SVG color reference. */
export interface SvgColorResult {
  value: string;
  warning?: string;
}

/**
 * Convert a ManagedColor to an SVG-compatible color reference.
 *
 * When `preserveColorSpace` is false (default), collapses everything to
 * CSS rgba() for maximum compatibility. When true:
 * - CMYK → `icc-color(profileName, c, m, y, k)` (no RGB conversion)
 * - float16/float32 + profile → `icc-color(profile, r, g, b)`
 * - float16/float32 without profile → rgba() + warning comment
 *
 * Color space is detected by the `space` discriminant and `bitDepth` field
 * — no dependency on @varve/scene type guards (avoids module-loading
 * edge cases in the codegen package's vitest environment).
 */
export function colorToSvgValue(
  color: ManagedColor,
  doc: SceneDocument | null,
  preserveColorSpace: boolean,
): SvgColorResult {
  if (!preserveColorSpace) {
    return { value: rgba(color) };
  }

  // CMYK: preserve as icc-color, never convert to RGB
  if (color.space === 'cmyk') {
    const profile = doc?.colorConfig?.cmykProfile?.id ?? 'unknown';
    const c = color as Extract<ManagedColor, { space: 'cmyk' }>;
    return {
      value: `icc-color(${profile}, ${c.c}, ${c.m}, ${c.y}, ${c.k})`,
    };
  }

  // High-bit-depth RGB with profile → icc-color
  const isHighPrecision =
    'bitDepth' in color && (color.bitDepth === 'float32' || color.bitDepth === 'float16');
  if (isHighPrecision && color.space === 'rgb' && color.profile) {
    const rgb = color as Extract<ManagedColor, { space: 'rgb' }>;
    return {
      value: `icc-color(${rgb.profile}, ${rgb.r}, ${rgb.g}, ${rgb.b})`,
    };
  }

  // High-bit-depth without profile → fall back to rgba with a warning
  if (isHighPrecision && color.space === 'rgb') {
    const bitDepth = color.bitDepth;
    return {
      value: rgba(color),
      warning: `Warning: color uses ${bitDepth} precision but no ICC profile is assigned — fell back to sRGB rgb()`,
    };
  }

  // Default: uint8 / sRGB → rgba()
  return { value: rgba(color) };
}

export function colorToHex(c: ManagedColor | readonly [number, number, number, number]): string {
  if ('space' in c) {
    const [r, g, b] = managedColorToRgba(c);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return `#${c[0].toString(16).padStart(2, '0')}${c[1].toString(16).padStart(2, '0')}${c[2].toString(16).padStart(2, '0')}`;
}

export function affineToSvg(t: Affine): string {
  return `matrix(${t[0]},${t[1]},${t[2]},${t[3]},${t[4]},${t[5]})`;
}

const SVG_BLEND_MODE: Record<Exclude<BlendMode, 'normal' | 'passThrough'>, string> = {
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  colorDodge: 'color-dodge',
  colorBurn: 'color-burn',
  hardLight: 'hard-light',
  softLight: 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  plusDarker: 'plus-darker',
  plusLighter: 'plus-lighter',
};

/** SVG presentation attributes and CSS declarations for scene compositing. */
export function svgCompositing(
  node: SceneNode,
  container = false,
): { attributes: string[]; styles: string[] } {
  const attributes: string[] = [];
  const styles: string[] = [];
  const rawOpacity = node.opacity ?? 1;
  const opacity = Number.isFinite(rawOpacity) ? Math.max(0, Math.min(1, rawOpacity)) : 1;
  const blendMode = node.blendMode ?? 'normal';
  if (opacity !== 1) attributes.push(`opacity="${opacity}"`);

  if (blendMode !== 'normal' && blendMode !== 'passThrough') {
    styles.push(`mix-blend-mode: ${SVG_BLEND_MODE[blendMode]};`);
  }
  // Pass Through deliberately leaves descendants in the parent's backdrop.
  // Normal and creative container modes establish a compositing boundary.
  if (container && blendMode !== 'passThrough') {
    styles.push('isolation: isolate;');
  }
  return { attributes, styles };
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function computeNodePos(node: SceneNode): { x: number; y: number; w: number; h: number } {
  const tx = node.transform[4] ?? 0;
  const ty = node.transform[5] ?? 0;
  if (node.kind === 'adjustment') {
    return { x: tx, y: ty, w: 200, h: 160 };
  }
  if (node.kind === 'shape') {
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return { x: tx + s.x, y: ty + s.y, w: s.w, h: s.h };
      case 'ellipse':
        return { x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
      case 'circle':
        return { x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 };
      case 'line': {
        const minX = Math.min(s.from[0], s.to[0]);
        const minY = Math.min(s.from[1], s.to[1]);
        return {
          x: tx + minX,
          y: ty + minY,
          w: Math.abs(s.to[0] - s.from[0]) || 1,
          h: Math.abs(s.to[1] - s.from[1]) || 1,
        };
      }
      case 'polygon':
        return {
          x: tx + s.cx - s.radius,
          y: ty + s.cy - s.radius,
          w: s.radius * 2,
          h: s.radius * 2,
        };
      case 'star':
        return {
          x: tx + s.cx - s.outerRadius,
          y: ty + s.cy - s.outerRadius,
          w: s.outerRadius * 2,
          h: s.outerRadius * 2,
        };
    }
  }
  if (node.kind === 'text') {
    const fs = node.fontSize ?? 16;
    return { x: tx, y: ty, w: node.text.length * fs * 0.6, h: fs * 1.4 };
  }
  return { x: tx, y: ty, w: 200, h: 160 };
}

export function shapeVerticesToPoints(s: SceneNode): string {
  if (s.kind !== 'shape') return '';
  const shape = s.shape;
  if (shape.kind === 'polygon') {
    const pts: string[] = [];
    for (let i = 0; i < shape.sides; i++) {
      const a = (2 * Math.PI * i) / shape.sides - Math.PI / 2 + shape.rotation;
      pts.push(`${shape.cx + shape.radius * Math.cos(a)},${shape.cy + shape.radius * Math.sin(a)}`);
    }
    return pts.join(' ');
  }
  if (shape.kind === 'star') {
    const pts: string[] = [];
    for (let i = 0; i < shape.points * 2; i++) {
      const a = (Math.PI * i) / shape.points - Math.PI / 2 + shape.rotation;
      const r = i % 2 === 0 ? shape.outerRadius : shape.innerRadius;
      pts.push(`${shape.cx + r * Math.cos(a)},${shape.cy + r * Math.sin(a)}`);
    }
    return pts.join(' ');
  }
  return '';
}

export function getChildren(doc: SceneDocument, node: SceneNode): SceneNode[] {
  if (node.kind !== 'frame' && node.kind !== 'group') return [];
  return (node.children ?? []).map((cid: NodeId) => doc.nodes[cid]).filter(Boolean) as SceneNode[];
}
