import type { GradientFill, Document as SceneDocument, SceneNode } from '@varve/scene';
import { expandGradientStops, managedColorToRgba } from '@varve/shared';
import { affineToSvg, getChildren, rgba } from './shared';

/** Collect the SVG paint-server definitions used by a node subtree. */
export function collectGradientDefs(node: SceneNode, nodeId: string, doc: SceneDocument): string[] {
  const defs: string[] = [];
  for (const [index, fill] of (node.fills ?? []).entries()) {
    if (fill.type === 'gradient' && fill.gradient) {
      defs.push(...gradientDefElements(fill.gradient, `grad-${nodeId}-${index}`, doc));
    }
  }
  if (node.kind === 'shape') {
    for (const [index, stroke] of (node.strokes ?? []).entries()) {
      if (stroke.gradient) {
        defs.push(...gradientDefElements(stroke.gradient, `grad-${nodeId}-stroke-${index}`, doc));
      }
    }
  }
  if (node.kind === 'group' || node.kind === 'frame') {
    for (const child of getChildren(doc, node)) {
      defs.push(...collectGradientDefs(child, child.id, doc));
    }
  }
  return defs;
}

/** Collect one SVG gradient definition, baking unsupported interpolation spaces. */
function gradientDefElements(gradient: GradientFill, gradId: string, doc: SceneDocument): string[] {
  const defs: string[] = [];
  const rot = (gradient.rotation ?? 0) * (Math.PI / 180);
  const explicitTransform = gradient.transform;
  const cx = 50;
  const cy = 50;
  const gradType = gradient.type;
  const spreadAttr =
    gradient.tilingMode === 'repeat' || gradient.tilingMode === 'reflect'
      ? ` spreadMethod="${gradient.tilingMode}"`
      : '';
  const space =
    gradient.interpolationSource === 'document'
      ? (doc.colorConfig?.defaultGradientInterpolation ?? 'oklab')
      : (gradient.interpolationSpace ?? 'srgb');
  const hue = gradient.hueInterpolation ?? 'shorter';

  let stopElements: string;
  let colorInterpAttr = '';
  let fidelityComment: string | undefined;
  if (space === 'linear-srgb') {
    colorInterpAttr = ' color-interpolation="linearRGB"';
    stopElements = gradient.stops
      .map(
        (s) =>
          `      <stop offset="${(s.position * 100).toFixed(1)}%" stop-color="${rgba(s.color)}" />`,
      )
      .join('\n');
  } else if (space === 'srgb') {
    stopElements = gradient.stops
      .map(
        (s) =>
          `      <stop offset="${(s.position * 100).toFixed(1)}%" stop-color="${rgba(s.color)}" />`,
      )
      .join('\n');
  } else {
    const baked = expandGradientStops(
      gradient.stops.map((s) => {
        const [r, g, b, a] = managedColorToRgba(s.color);
        return {
          position: s.position,
          color: { space: 'rgb' as const, r, g, b, a },
          midpoint: s.midpoint,
        };
      }),
      space,
      16,
      { hueInterpolation: hue },
    );
    stopElements = baked
      .map(
        (s) =>
          `      <stop offset="${(s.position * 100).toFixed(1)}%" stop-color="${rgba(s.color)}" />`,
      )
      .join('\n');
    fidelityComment = `<!-- gradient interpolated in "${space}" — baked to sRGB stops (SVG has no native ${space} gradient) -->`;
  }

  if (gradType === 'linear') {
    const linearAttrs = explicitTransform
      ? ` gradientUnits="userSpaceOnUse" x1="0" y1="0.5" x2="1" y2="0.5" gradientTransform="${affineToSvg(explicitTransform)}"`
      : (() => {
          const x1 = cx - Math.cos(rot) * cx;
          const y1 = cy - Math.sin(rot) * cy;
          const x2 = cx + Math.cos(rot) * cx;
          const y2 = cy + Math.sin(rot) * cy;
          return ` x1="${x1.toFixed(1)}%" y1="${y1.toFixed(1)}%" x2="${x2.toFixed(1)}%" y2="${y2.toFixed(1)}%"`;
        })();
    defs.push(
      `    <linearGradient id="${gradId}"${linearAttrs}${spreadAttr}${colorInterpAttr}>\n${stopElements}\n    </linearGradient>`,
    );
  } else if (gradType === 'radial') {
    const halfDiag = Math.sqrt(cx * cx + cy * cy);
    const radialAttrs = explicitTransform
      ? ` gradientUnits="userSpaceOnUse" cx="0.5" cy="0.5" r="0.5" gradientTransform="${affineToSvg(explicitTransform)}"`
      : ` cx="${cx}%" cy="${cy}%" r="${halfDiag}%"${rot !== 0 ? ` gradientTransform="rotate(${((gradient.rotation ?? 0) * -1).toFixed(1)})"` : ''}`;
    defs.push(
      `    <radialGradient id="${gradId}"${radialAttrs}${spreadAttr}${colorInterpAttr}>\n${stopElements}\n    </radialGradient>`,
    );
  }
  if (fidelityComment) defs.push(fidelityComment);
  return defs;
}

type ShapeNode = Extract<SceneNode, { kind: 'shape' }>;

export function strokePaintToSvg(node: ShapeNode, nodeId: string): string {
  const index = node.strokes?.findIndex((stroke) => stroke.visible) ?? -1;
  if (index < 0) return '';
  const stroke = node.strokes![index]!;
  return stroke.gradient ? `url(#grad-${nodeId}-stroke-${index})` : rgba(stroke.color);
}

export function strokeAttrs(
  node: ShapeNode,
  nodeId: string,
  fallbackWidth?: number,
  fallbackPaint?: string,
): string {
  const index = node.strokes?.findIndex((stroke) => stroke.visible) ?? -1;
  if (index < 0) {
    return fallbackWidth === undefined
      ? ''
      : ` stroke="${fallbackPaint ?? 'none'}" stroke-width="${fallbackWidth}"`;
  }
  const stroke = node.strokes![index]!;
  const dash =
    stroke.dashPattern.length > 0
      ? ` stroke-dasharray="${stroke.dashPattern.join(' ')}" stroke-dashoffset="${stroke.dashOffset}"`
      : '';
  return ` stroke="${strokePaintToSvg(node, nodeId)}" stroke-width="${stroke.weight}" stroke-linecap="${stroke.cap}" stroke-linejoin="${stroke.join}"${dash}`;
}
