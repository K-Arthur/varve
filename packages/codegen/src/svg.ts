// COMPLEXITY: 252 cyclo — see docs/plans/architecture-health-remediation-2026-07-26.md
/**
 * Per-node SVG export target.
 *
 * Research basis: SVG 1.1 (W3C Recommendation).
 */

import {
  type Affine,
  computeImagePlacement,
  type ImagePlacement,
  type ImagePlacementRect,
} from '@varve/engine';
import type {
  ImageFillData,
  Mask,
  Document as SceneDocument,
  SceneNode,
  TextNode,
  VectorMaskData,
} from '@varve/scene';
import { computeTableLayout, isImageShape, resolveMask } from '@varve/scene';
import {
  applyAffine,
  DEFAULT_ARTWORK_FONT_FAMILY,
  multiplyAffine,
  rotateDeg,
  textWrap,
} from '@varve/shared';
import {
  adjustmentStackTargetGaps,
  affineToSvg,
  colorToSvgValue,
  escapeXml,
  getChildren,
  nodeEffectiveTransform,
  rgba,
  shapeVerticesToPoints,
  svgCompositing,
} from './shared';
import type { TargetGap } from './types';
import { exportShapeOf, unbakeableWarpKind } from './warpBake';

/** Deterministic number formatting for SVG output. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return (Math.round(n * 100) / 100).toString();
}

function shapeBounds(shape: import('@varve/engine').Shape): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  switch (shape.kind) {
    case 'rect':
      return { x: shape.x, y: shape.y, width: shape.w, height: shape.h };
    case 'table':
      return { x: shape.x, y: shape.y, width: shape.w, height: shape.h };
    case 'ellipse':
      return {
        x: shape.cx - shape.rx,
        y: shape.cy - shape.ry,
        width: shape.rx * 2,
        height: shape.ry * 2,
      };
    case 'circle':
      return {
        x: shape.cx - shape.r,
        y: shape.cy - shape.r,
        width: shape.r * 2,
        height: shape.r * 2,
      };
    case 'polygon':
      return {
        x: shape.cx - shape.radius,
        y: shape.cy - shape.radius,
        width: shape.radius * 2,
        height: shape.radius * 2,
      };
    case 'star':
      return {
        x: shape.cx - shape.outerRadius,
        y: shape.cy - shape.outerRadius,
        width: shape.outerRadius * 2,
        height: shape.outerRadius * 2,
      };
    case 'line':
    case 'arrow': {
      const padding = shape.kind === 'arrow' ? shape.arrowheadSize : shape.tolerance;
      const x = Math.min(shape.from[0], shape.to[0]) - padding;
      const y = Math.min(shape.from[1], shape.to[1]) - padding;
      return {
        x,
        y,
        width: Math.max(Math.abs(shape.to[0] - shape.from[0]) + padding * 2, 1),
        height: Math.max(Math.abs(shape.to[1] - shape.from[1]) + padding * 2, 1),
      };
    }
    case 'path': {
      if (shape.points.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
      const xs = shape.points.map((point) => point.x);
      const ys = shape.points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return {
        x,
        y,
        width: Math.max(Math.max(...xs) - x, 1),
        height: Math.max(Math.max(...ys) - y, 1),
      };
    }
  }
}

function shapeClipPath(node: SceneNode): string {
  if (node.kind !== 'shape') return '';
  const s = node.shape;
  switch (s.kind) {
    case 'rect':
      return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" />`;
    case 'ellipse':
      return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" />`;
    case 'circle':
      return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" />`;
    case 'polygon':
    case 'star':
      return `<polygon points="${shapeVerticesToPoints(node)}" />`;
    case 'path': {
      const fillRule = s.fillRule ?? (s.holes && s.holes.length > 0 ? 'evenodd' : undefined);
      const fillRuleAttr = fillRule ? ` fill-rule="${fillRule}"` : '';
      return `<path d="${pathToData(s)}"${fillRuleAttr} />`;
    }
    case 'line':
    case 'arrow': {
      const stroke = node.strokes?.[0];
      const sw = stroke?.weight ?? s.tolerance * 2;
      return `<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}" stroke="black" stroke-width="${sw}" />`;
    }
    default:
      return '';
  }
}

export function imagePlacementForShape(
  node: Extract<SceneNode, { kind: 'shape' }>,
  image: ImageFillData,
  sourceFallback?: { width: number; height: number },
): ImagePlacement | null {
  const bounds = shapeBounds(node.shape);
  const sourceWidth = image.imageWidth ?? sourceFallback?.width ?? bounds.width;
  const sourceHeight = image.imageHeight ?? sourceFallback?.height ?? bounds.height;
  return computeImagePlacement({
    fit: image.fit,
    sourceWidth,
    sourceHeight,
    bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
    x: image.x,
    y: image.y,
    scale: image.scale,
    sourceCrop: image.crop,
    rotation: image.rotation,
    flipH: image.flipH,
    flipV: image.flipV,
  });
}

export function imageContentTransform(placement: ImagePlacement): string {
  if (placement.rotation === 0 && !placement.flipH && !placement.flipV) return '';
  const { drawRect } = placement;
  const cx = drawRect.x + drawRect.w / 2;
  const cy = drawRect.y + drawRect.h / 2;
  const scaleX = placement.flipH ? -1 : 1;
  const scaleY = placement.flipV ? -1 : 1;
  return [
    `translate(${cx.toFixed(4)} ${cy.toFixed(4)})`,
    `rotate(${placement.rotation.toFixed(4)})`,
    `scale(${scaleX} ${scaleY})`,
    `translate(${(-cx).toFixed(4)} ${(-cy).toFixed(4)})`,
  ].join(' ');
}

export function svgRect(rect: ImagePlacementRect): string {
  return `x="${rect.x.toFixed(4)}" y="${rect.y.toFixed(4)}" width="${rect.w.toFixed(4)}" height="${rect.h.toFixed(4)}"`;
}

function pathToData(shape: Extract<import('@varve/engine').Shape, { kind: 'path' }>): string {
  const ringToCommands = (
    points: import('@varve/engine').PathPoint[],
    closed: boolean,
  ): string[] => {
    const first = points[0];
    if (!first) return [];
    // Coordinates are rounded to 0.01px. Warp baking subdivides curves into
    // many points, and emitting each at full float precision both bloats the
    // file and leaks arithmetic noise (`4.6e-15` for an exact zero).
    const commands = [`M ${fmt(first.x)} ${fmt(first.y)}`];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1] as import('@varve/engine').PathPoint;
      const current = points[index] as import('@varve/engine').PathPoint;
      if (previous.handleOut || current.handleIn) {
        const c1x = previous.x + (previous.handleOut?.[0] ?? 0);
        const c1y = previous.y + (previous.handleOut?.[1] ?? 0);
        const c2x = current.x + (current.handleIn?.[0] ?? 0);
        const c2y = current.y + (current.handleIn?.[1] ?? 0);
        commands.push(
          `C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(current.x)} ${fmt(current.y)}`,
        );
      } else {
        commands.push(`L ${fmt(current.x)} ${fmt(current.y)}`);
      }
    }
    if (closed) commands.push('Z');
    return commands;
  };

  const commands = ringToCommands(shape.points, shape.closed);
  for (const hole of shape.holes ?? []) {
    commands.push(...ringToCommands(hole, true));
  }
  return commands.join(' ');
}

export interface SvgExportOptions {
  /** Width of the SVG viewBox. Defaults to node width. */
  viewBoxWidth?: number;
  /** Height of the SVG viewBox. Defaults to node height. */
  viewBoxHeight?: number;
  /**
   * When true, preserve the document's color space in the output:
   * CMYK → icc-color(), float16/32 → icc-color() with profile.
   * When false (default), collapse everything to sRGB rgba() for
   * maximum compatibility.
   */
  preserveColorSpace?: boolean;
  /**
   * Minify the output: strip newlines and indentation between tags so the
   * file is smaller at the cost of readability. Text content is preserved
   * (whitespace runs between tags are removed only when the gap contains no
   * other characters).
   */
  minify?: boolean;
  /**
   * Pre-rasterized image assets for nodes that use effects which
   * SVG 1.1 cannot represent natively (adjustment layers with
   * curves/levels/halftone/duotone/blackAndWhite/posterize/threshold
   * and similar CPU-only filters).  When present, the emitter embeds
   * an `<image>` element instead of silently dropping the node.
   */
  rasterAssets?: Record<string, import('./types').RasterAsset>;
  /**
   * Background handling for the exported SVG. 'white' (default) keeps the
   * historical opaque white backdrop; 'transparent' omits the backdrop
   * rect entirely — required for logo marks, favicons, and overlays.
   */
  background?: 'white' | 'transparent';
}

/**
 * Conservative SVG minifier: removes newlines and the pretty-printing
 * indentation between tags. It never touches text content — whitespace is only
 * collapsed when the gap between two tags contains nothing else.
 */
export function minifySvg(svg: string): string {
  return svg
    .split('\n')
    .map((line) => line.trim())
    .join('')
    .replace(/>\s+</g, '><');
}

interface SvgBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function transformedBounds(
  points: ReadonlyArray<readonly [number, number]>,
  transform: Affine,
): SvgBounds {
  const transformed = points.map((point) => applyAffine(transform, point));
  return {
    minX: Math.min(...transformed.map((point) => point[0])),
    minY: Math.min(...transformed.map((point) => point[1])),
    maxX: Math.max(...transformed.map((point) => point[0])),
    maxY: Math.max(...transformed.map((point) => point[1])),
  };
}

function mergeBounds(bounds: SvgBounds[]): SvgBounds | null {
  if (bounds.length === 0) return null;
  return {
    minX: Math.min(...bounds.map((item) => item.minX)),
    minY: Math.min(...bounds.map((item) => item.minY)),
    maxX: Math.max(...bounds.map((item) => item.maxX)),
    maxY: Math.max(...bounds.map((item) => item.maxY)),
  };
}

function nodeSvgBounds(
  node: SceneNode,
  doc: SceneDocument,
  parentTransform: Affine = [1, 0, 0, 1, 0, 0],
): SvgBounds | null {
  const worldTransform = multiplyAffine(parentTransform, nodeEffectiveTransform(node));
  if (node.kind === 'group' || node.kind === 'frame') {
    return mergeBounds(
      getChildren(doc, node)
        .map((child) => nodeSvgBounds(child, doc, worldTransform))
        .filter((bounds): bounds is SvgBounds => bounds !== null),
    );
  }
  if (node.kind === 'text') {
    const width = Math.max(1, node.text.length * (node.fontSize ?? 16) * 0.6);
    const height = Math.max(1, (node.fontSize ?? 16) * (node.lineHeight ?? 1.2));
    return transformedBounds(
      [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ],
      worldTransform,
    );
  }
  if (node.kind === 'adjustment') {
    return transformedBounds(
      [
        [0, 0],
        [200, 0],
        [200, 160],
        [0, 160],
      ],
      worldTransform,
    );
  }
  if (node.kind !== 'shape') return null;
  // Warped geometry routinely extends past the source box, so bounds must be
  // measured on the baked result or the viewBox would clip the export.
  const exported = exportShapeOf(node, doc);
  const bounds = shapeBounds(exported);
  const points: Array<readonly [number, number]> = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x + bounds.width, bounds.y + bounds.height],
    [bounds.x, bounds.y + bounds.height],
  ];
  if (exported.kind === 'path') {
    for (const point of exported.points) {
      if (point.handleIn) points.push([point.x + point.handleIn[0], point.y + point.handleIn[1]]);
      if (point.handleOut)
        points.push([point.x + point.handleOut[0], point.y + point.handleOut[1]]);
    }
  }
  return transformedBounds(points, worldTransform);
}

/**
 * Collect SVG gradient definition elements from a node's fills.
 * Returns an array of raw SVG element strings suitable for inclusion
 * in a <defs> block. Returns empty array when no gradient defs needed.
 */
function collectGradientDefs(
  node: SceneNode,
  nodeId: string,
  _preserveColorSpace: boolean,
): string[] {
  const defs: string[] = [];
  const fills = node.fills ?? [];
  fills.forEach((fill, i) => {
    if (fill.type !== 'gradient' || !fill.gradient) return;
    const gradId = `grad-${nodeId}-${i}`;
    const rot = (fill.gradient.rotation ?? 0) * (Math.PI / 180);
    const cx = 50;
    const cy = 50;
    const gradType = fill.gradient.type;
    const stops = fill.gradient.stops
      .map(
        (s) =>
          `      <stop offset="${(s.position * 100).toFixed(1)}%" stop-color="${rgba(s.color)}" />`,
      )
      .join('\n');

    if (gradType === 'linear') {
      const x1 = cx - Math.cos(rot) * cx;
      const y1 = cy - Math.sin(rot) * cy;
      const x2 = cx + Math.cos(rot) * cx;
      const y2 = cy + Math.sin(rot) * cy;
      defs.push(
        `    <linearGradient id="${gradId}" x1="${x1.toFixed(1)}%" y1="${y1.toFixed(1)}%" x2="${x2.toFixed(1)}%" y2="${y2.toFixed(1)}%">\n${stops}\n    </linearGradient>`,
      );
    } else if (gradType === 'radial') {
      const halfDiag = Math.sqrt(cx * cx + cy * cy);
      defs.push(
        `    <radialGradient id="${gradId}" cx="${cx}%" cy="${cy}%" r="${halfDiag}%"${rot !== 0 ? ` gradientTransform="rotate(${((fill.gradient.rotation ?? 0) * -1).toFixed(1)})"` : ''}>\n${stops}\n    </radialGradient>`,
      );
    }
    // Angular/conic and diamond gradients have no SVG equivalent;
    // they're handled by raster fallback from the compositor.
  });
  return defs;
}

/** P2: Generate SVG <defs> for gradient fills, returns {defs, fillRef}. */
function fillToSvg(
  node: SceneNode,
  nodeId: string,
  doc: SceneDocument,
  preserveColorSpace: boolean,
): { fillAttr: string; comment?: string; defs?: string; needsRasterFallback?: boolean } {
  if (!node.fills || node.fills.length === 0) {
    if (node.kind === 'adjustment') {
      return { fillAttr: 'none' };
    }
    const result = node.fill ? colorToSvgValue(node.fill, doc, preserveColorSpace) : undefined;
    return { fillAttr: result?.value ?? 'none', comment: result?.warning };
  }

  // For a single solid fill, use the color directly
  if (node.fills.length === 1 && node.fills[0]?.type === 'solid' && node.fills[0]?.color) {
    const result = colorToSvgValue(node.fills[0].color, doc, preserveColorSpace);
    return { fillAttr: result.value, comment: result.warning };
  }

  // For gradient fills, generate fill attribute references and detect
  // gradient types that need raster fallback (angular, diamond).
  const fillAttrs: string[] = [];
  let needsRasterFallback = false;

  node.fills.forEach((fill, i) => {
    if (fill.type === 'solid' && fill.color) {
      fillAttrs.push(colorToSvgValue(fill.color, doc, preserveColorSpace).value);
    } else if (fill.type === 'gradient' && fill.gradient) {
      const gradId = `grad-${nodeId}-${i}`;
      const gradType = fill.gradient.type;

      // Linear and radial gradients have native SVG elements.
      // Angular/conic and diamond have no SVG equivalent and require raster fallback.
      if (gradType === 'linear' || gradType === 'radial') {
        fillAttrs.push(`url(#${gradId})`);
      } else {
        needsRasterFallback = true;
        const fallbackColor = fill.gradient.stops[0]?.color ?? node.fill;
        fillAttrs.push(rgba(fallbackColor));
      }
    }
  });

  if (needsRasterFallback) {
    return {
      defs: '',
      fillAttr: fillAttrs[fillAttrs.length - 1] ?? rgba(node.fill),
      needsRasterFallback: true,
    };
  }

  return {
    defs: '',
    fillAttr: fillAttrs[fillAttrs.length - 1] ?? rgba(node.fill),
  };
}

// ── Mask def helpers ─────────────────────────────────────────────────────────

/** Convert VectorMaskData points to an SVG path data string. */
function vectorMaskToPathData(vm: VectorMaskData): string {
  const pts = vm.points;
  if (pts.length === 0) return '';
  const first = pts[0]!;
  const cmds: string[] = [`M ${first.x} ${first.y}`];
  for (let i = 1; i < pts.length; i += 1) {
    const prev = pts[i - 1]!;
    const curr = pts[i]!;
    if (prev.handleOut || curr.handleIn) {
      const c1x = prev.x + (prev.handleOut?.[0] ?? 0);
      const c1y = prev.y + (prev.handleOut?.[1] ?? 0);
      const c2x = curr.x + (curr.handleIn?.[0] ?? 0);
      const c2y = curr.y + (curr.handleIn?.[1] ?? 0);
      cmds.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${curr.x} ${curr.y}`);
    } else {
      cmds.push(`L ${curr.x} ${curr.y}`);
    }
  }
  if (vm.closed) cmds.push('Z');
  return cmds.join(' ');
}

/** Collect geometry clip elements (shape outlines) from a source node subtree. */
function collectClipElements(doc: SceneDocument, node: SceneNode): string[] {
  if (node.kind === 'shape') {
    const el = shapeClipPath(node);
    return el ? [el] : [];
  }
  if (node.kind === 'frame' || node.kind === 'group') {
    return getChildren(doc, node).flatMap((child) => collectClipElements(doc, child));
  }
  return [];
}

/**
 * Render a source child node as SVG content inside a mask element.
 * All fills/strokes are replaced with `fillColor` so the mask
 * luminance/alpha is uniform.
 */
function renderSourceNodeAsMaskContent(
  doc: SceneDocument,
  sourceNodeId: string,
  fillColor: string,
  localTransform: Affine,
  depth: number,
): string {
  const node = doc.nodes[sourceNodeId];
  if (!node) return '';
  const indent = '  '.repeat(depth + 2);
  // Fold the source node's rotation field, same order as the renderer.
  const rot = node.rotation ?? 0;
  const effTransform: Affine =
    rot !== 0 ? multiplyAffine(localTransform, rotateDeg(rot)) : localTransform;
  const t = affineToSvg(effTransform);
  const withTransform = ` transform="${t}"`;

  switch (node.kind) {
    case 'shape': {
      const s = node.shape;
      switch (s.kind) {
        case 'rect':
          return `${indent}<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fillColor}"${withTransform} />`;
        case 'ellipse':
          return `${indent}<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${fillColor}"${withTransform} />`;
        case 'circle':
          return `${indent}<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fillColor}"${withTransform} />`;
        case 'line':
        case 'arrow': {
          const stroke = node.strokes?.[0];
          const sw = stroke?.weight ?? s.tolerance * 2;
          const strokeColor = stroke?.color ? rgba(stroke.color) : fillColor;
          return `${indent}<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}" stroke="${strokeColor}" stroke-width="${sw}" stroke-linecap="round"${withTransform} />`;
        }
        case 'polygon':
        case 'star':
          return `${indent}<polygon points="${shapeVerticesToPoints(node)}" fill="${fillColor}"${withTransform} />`;
        case 'path':
          return `${indent}<path d="${pathToData(s)}" fill="${fillColor}"${withTransform} />`;
      }
      return '';
    }
    case 'text': {
      const tn = node as TextNode;
      const fontSize = tn.fontSize ?? 16;
      const lineHeight = (tn.lineHeight ?? 1.2) * fontSize;
      const lines = (tn.text ?? '').split('\n');
      const content = lines
        .map(
          (line, i) =>
            `${indent}  <tspan x="0" y="${(i * lineHeight).toFixed(2)}">${escapeXml(line)}</tspan>`,
        )
        .join('\n');
      return `${indent}<text x="0" y="0" fill="${fillColor}" font-size="${fontSize}"${withTransform}>\n${content}\n${indent}</text>`;
    }
    case 'frame':
    case 'group': {
      const children = getChildren(doc, node)
        .map((child) =>
          renderSourceNodeAsMaskContent(doc, child.id, fillColor, child.transform, depth + 1),
        )
        .join('\n');
      return `${indent}<g${withTransform}>\n${children}\n${indent}</g>`;
    }
    default:
      return '';
  }
}

/** Generate a single `<clipPath>` or `<mask>` def element for a masked container. */
function buildMaskDef(doc: SceneDocument, containerId: string, mask: Mask): string | null {
  if (mask.visible === false) return null;
  const maskId = `mask-${containerId}`;
  const lines: string[] = [];
  const indent = '      ';

  // Raster mask: embedded alpha image from rasterMaskAssets.
  if (mask.type === 'alpha' && 'rasterMask' in mask && mask.rasterMask) {
    const assetId = mask.rasterMask.assetId;
    const asset =
      doc.rasterMaskAssets && Object.hasOwn(doc.rasterMaskAssets, assetId)
        ? doc.rasterMaskAssets[assetId]
        : undefined;
    if (asset?.dataUrl) {
      const container = doc.nodes[containerId];
      const imageFill =
        container?.kind === 'shape'
          ? container.fills?.find((fill) => fill.type === 'image' && fill.image)?.image
          : undefined;
      const placement =
        container?.kind === 'shape' && imageFill
          ? imagePlacementForShape(container, imageFill, {
              width: asset.width,
              height: asset.height,
            })
          : null;
      if (container?.kind === 'shape' && placement) {
        const bounds = shapeBounds(container.shape);
        const transform = imageContentTransform(placement);
        const transformAttr = transform ? ` transform="${transform}"` : '';
        const cropClipId = `${maskId}-crop`;
        lines.push(
          `    <mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" style="mask-type: alpha">`,
        );
        if (imageFill?.crop) {
          lines.push(
            `      <clipPath id="${cropClipId}" clipPathUnits="userSpaceOnUse"><rect ${svgRect(placement.sampleDrawRect)} /></clipPath>`,
          );
        }
        lines.push(
          `      <g${transformAttr}${imageFill?.crop ? ` clip-path="url(#${cropClipId})"` : ''}>`,
        );
        lines.push(
          `        <image href="${escapeXml(asset.dataUrl)}" ${svgRect(placement.drawRect)} preserveAspectRatio="none" />`,
        );
        lines.push(`      </g>`);
        lines.push(`    </mask>`);
        return lines.join('\n');
      }
      lines.push(`    <mask id="${maskId}" style="mask-type: alpha">`);
      lines.push(
        `      <image href="${escapeXml(asset.dataUrl)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" />`,
      );
      lines.push(`    </mask>`);
      return lines.join('\n');
    }
    // Missing asset: empty mask (fully transparent)
    return null;
  }

  // Determine mask content
  const hasVectorMask = mask.vectorMask && mask.vectorMask.points.length > 0;
  const hasSourceNode = mask.sourceNodeId && doc.nodes[mask.sourceNodeId];

  const contentLines: string[] = [];

  if (hasVectorMask) {
    const d = vectorMaskToPathData(mask.vectorMask!);
    if (d) {
      if (mask.type === 'clip') {
        const fillRuleAttr = mask.fillRule === 'evenodd' ? ` clip-rule="evenodd"` : '';
        contentLines.push(`${indent}<path d="${d}"${fillRuleAttr} />`);
      } else {
        contentLines.push(`${indent}<path d="${d}" fill="white" />`);
      }
    }
  } else if (hasSourceNode) {
    const sourceNode = doc.nodes[mask.sourceNodeId!]!;
    if (mask.type === 'clip') {
      const elements = collectClipElements(doc, sourceNode);
      for (const el of elements) {
        contentLines.push(`${indent}${el}`);
      }
    } else {
      const maskTransform: Affine =
        mask.linked === false ? (mask.transform ?? [1, 0, 0, 1, 0, 0]) : [1, 0, 0, 1, 0, 0];
      const content = renderSourceNodeAsMaskContent(
        doc,
        mask.sourceNodeId!,
        'white',
        maskTransform,
        0,
      );
      if (content) contentLines.push(content);
    }
  }

  if (contentLines.length === 0) return null;

  const contentStr = contentLines.join('\n');

  if (mask.type === 'clip') {
    if (mask.inverted) {
      // Clip inversion: use <mask> with white rect + black clip shape
      lines.push(`    <mask id="${maskId}">`);
      lines.push(`      <rect width="100%" height="100%" fill="white" />`);
      if (hasVectorMask) {
        const d = vectorMaskToPathData(mask.vectorMask!);
        lines.push(`      <path d="${d}" fill="black" />`);
      } else {
        lines.push(contentStr.replace(/fill="[^"]*"/g, 'fill="black"'));
      }
      lines.push(`    </mask>`);
    } else {
      const fillRuleAttr = mask.fillRule === 'evenodd' ? ` clip-rule="evenodd"` : '';
      const unitsAttr = mask.linked === false ? ` clipPathUnits="userSpaceOnUse"` : '';
      lines.push(`    <clipPath id="${maskId}"${fillRuleAttr}${unitsAttr}>`);
      lines.push(contentStr);
      lines.push(`    </clipPath>`);
    }
  } else {
    // alpha or luminance mask
    const maskTypeAttr = mask.type === 'luminance' ? ` mask-type="luminance"` : '';
    const unitsAttr =
      mask.linked === false ? ` maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"` : '';

    if (mask.feather && mask.feather > 0) {
      const filterId = `${maskId}-filter`;
      lines.push(`    <filter id="${filterId}">`);
      lines.push(`      <feGaussianBlur stdDeviation="${mask.feather}" />`);
      lines.push(`    </filter>`);
    }

    const filterId = `${maskId}-filter`;
    const hasFilter = mask.feather && mask.feather > 0;
    const filterAttr = hasFilter ? ` filter="url(#${filterId})"` : '';

    lines.push(`    <mask id="${maskId}"${maskTypeAttr}${filterAttr}${unitsAttr}>`);

    if (mask.inverted) {
      lines.push(`      <rect width="100%" height="100%" fill="white" />`);
      // Black content punches holes
      lines.push(contentStr.replace(/fill="[^"]*"/g, 'fill="black"'));
    } else {
      lines.push(`      <rect width="100%" height="100%" fill="black" />`);
      lines.push(contentStr);
    }

    // Density < 1: reduce effect via opacity on the mask
    if (mask.density !== undefined && mask.density < 1) {
      // Wrap mask children in a group with reduced opacity to simulate density
      // We add an opacity on the baseline assumption: black bg + white fg with
      // density as a multiplier on the fg opacity. Approximate by replacing
      // "fill="white"" with reduced-opacity fills.
      // Since we already emitted the content, we can't easily wrap it here.
      // Instead, add a rect with opacity that backs off the mask effect.
      const densityOpacity = 1 - mask.density;
      lines.push(
        `      <rect width="100%" height="100%" fill="white" opacity="${densityOpacity}" />`,
      );
    }

    lines.push(`    </mask>`);
  }

  return lines.join('\n');
}

/** Walk a subtree and collect mask defs from every masked node. */
function collectSubtreeMaskDefs(doc: SceneDocument, node: SceneNode): string[] {
  const defs: string[] = [];
  const mask = resolveMask(node, doc);
  if (mask) {
    const def = buildMaskDef(doc, node.id, mask);
    if (def) defs.push(def);
  }
  // Recurse into containers (frame, group) to check children.
  if (node.kind === 'frame' || node.kind === 'group') {
    for (const child of getChildren(doc, node)) {
      defs.push(...collectSubtreeMaskDefs(doc, child));
    }
  }
  return defs;
}

function buildTextContent(node: TextNode, indent: string): string {
  const baseY = 0;
  const lineHeight = (node.lineHeight ?? 1.2) * (node.fontSize ?? 16);
  const childIndent = `${indent}  `;

  if (!node.richText) {
    let displayText = node.text ?? '';
    if (node.textCase === 'uppercase') displayText = displayText.toUpperCase();
    else if (node.textCase === 'lowercase') displayText = displayText.toLowerCase();
    else if (node.textCase === 'capitalize')
      displayText = displayText.replace(/\b\w/g, (c: string) => c.toUpperCase());

    const lines = displayText.split('\n');
    return lines
      .map((line: string, i: number) => {
        const y = baseY + i * lineHeight;
        let prefixed = line;
        if (node.listStyle === 'disc') prefixed = `• ${line}`;
        else if (node.listStyle === 'circle') prefixed = `○ ${line}`;
        else if (node.listStyle === 'square') prefixed = `[ ] ${line}`;
        else if (node.listStyle === 'decimal') prefixed = `${i + 1}. ${line}`;
        return `${childIndent}<tspan x="0" y="${y.toFixed(2)}">${escapeXml(prefixed)}</tspan>`;
      })
      .join('\n');
  }

  // Rich text path: emit one tspan per run, preserving per-run formatting.
  const spans: string[] = [];
  let y = baseY;
  for (const paragraph of node.richText.paragraphs) {
    const paraDirection = paragraph.format?.direction;
    let x = 0;
    for (const run of paragraph.runs) {
      const runAttrs: string[] = [`x="${x.toFixed(2)}"`, `y="${y.toFixed(2)}"`];
      const format = run.format ?? {};
      if (format.fontFamily) runAttrs.push(`font-family="${escapeXml(format.fontFamily)}"`);
      if (format.fontSize) runAttrs.push(`font-size="${format.fontSize}"`);
      if (format.fontWeight) runAttrs.push(`font-weight="${format.fontWeight}"`);
      if (format.fontStyle === 'italic') runAttrs.push(`font-style="italic"`);
      if (format.letterSpacing) runAttrs.push(`letter-spacing="${format.letterSpacing}"`);
      if (format.textDecoration && format.textDecoration !== 'none') {
        runAttrs.push(`text-decoration="${format.textDecoration}"`);
      }
      if (format.color) runAttrs.push(`fill="${rgba(format.color)}"`);

      const runStyleParts: string[] = [];
      if (format.variableFontSettings && Object.keys(format.variableFontSettings).length > 0) {
        const settings = Object.entries(format.variableFontSettings)
          .map(([tag, value]) => `"${tag}" ${value}`)
          .join(', ');
        runStyleParts.push(`font-variation-settings: ${settings};`);
      }
      if (format.openTypeFeatures && Object.keys(format.openTypeFeatures).length > 0) {
        const features = Object.entries(format.openTypeFeatures)
          .filter(([tag]) => tag !== 'custom')
          .map(([tag, on]) => `"${tag}" ${on ? '1' : '0'}`)
          .join(', ');
        if (features) runStyleParts.push(`font-feature-settings: ${features};`);
        const custom = format.openTypeFeatures.custom;
        if (custom) {
          const customFeatures = Object.entries(custom)
            .map(([tag, on]) => `"${tag}" ${on ? '1' : '0'}`)
            .join(', ');
          if (customFeatures) runStyleParts.push(`font-feature-settings: ${customFeatures};`);
        }
      }
      if (runStyleParts.length > 0) runAttrs.push(`style="${runStyleParts.join(' ')}"`);
      // Per-paragraph RTL direction for BiDi-aware SVG renderers.
      if (paraDirection === 'rtl') {
        runAttrs.push('direction="rtl"', 'unicode-bidi="bidi-override"');
      }

      spans.push(`${childIndent}<tspan ${runAttrs.join(' ')}>${escapeXml(run.text)}</tspan>`);
      // Approximate advance for positioning; a real layout engine would provide exact metrics.
      x += run.text.length * (format.fontSize ?? node.fontSize ?? 16) * 0.6;
    }
    y += lineHeight;
  }
  return spans.join('\n');
}

const ARROW_SPREAD = Math.PI / 7;

function arrowheadSvgPath(
  from: readonly [number, number],
  to: readonly [number, number],
  size: number,
  style: 'arrow' | 'circle' | 'square' | 'diamond',
  isStart: boolean,
): string {
  const tip = isStart ? from : to;
  const tail = isStart ? to : from;
  const angle = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const transform = (lx: number, ly: number): string => {
    const x = tip[0] + lx * cos - ly * sin;
    const y = tip[1] + lx * sin + ly * cos;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  };

  switch (style) {
    case 'arrow': {
      const x1 = -size * Math.cos(-ARROW_SPREAD);
      const y1 = -size * Math.sin(-ARROW_SPREAD);
      const x2 = -size * Math.cos(ARROW_SPREAD);
      const y2 = -size * Math.sin(ARROW_SPREAD);
      return `M ${transform(0, 0)} L ${transform(x1, y1)} L ${transform(x2, y2)} Z`;
    }
    case 'circle': {
      const r = size * 0.5;
      return `M ${transform(-r, 0)} A ${r} ${r} 0 1 0 ${transform(r, 0)} A ${r} ${r} 0 1 0 ${transform(-r, 0)} Z`;
    }
    case 'square': {
      const s = size * 0.7;
      return `M ${transform(-s, -s * 0.5)} L ${transform(0, -s * 0.5)} L ${transform(0, s * 0.5)} L ${transform(-s, s * 0.5)} Z`;
    }
    case 'diamond': {
      const s = size * 0.6;
      return `M ${transform(0, 0)} L ${transform(-s, -s * 0.5)} L ${transform(-s * 2, 0)} L ${transform(-s, s * 0.5)} Z`;
    }
  }
}

function lineArrowheadSvgTags(node: SceneNode, indent: string, withTransform: string): string[] {
  if (node.kind !== 'shape') return [];
  const s = node.shape;
  if (s.kind !== 'line' && s.kind !== 'arrow') return [];
  const strokes = node.strokes ?? [];
  if (strokes.length === 0) return [];
  const stroke = strokes[0]!;
  const weight = stroke.weight || 1;
  const strokeColor = stroke.color ? rgba(stroke.color) : 'black';
  const headSize = s.kind === 'arrow' ? Math.max(s.arrowheadSize, weight * 3) : weight * 3;
  const arrowStart = stroke.arrowStart ?? (s.kind === 'arrow' ? 'none' : 'none');
  const arrowEnd = stroke.arrowEnd ?? (s.kind === 'arrow' ? 'arrow' : 'none');
  const tags: string[] = [];
  if (arrowStart !== 'none') {
    const d = arrowheadSvgPath(s.from, s.to, headSize, arrowStart, true);
    tags.push(`${indent}<path d="${d}" fill="${strokeColor}"${withTransform} />`);
  }
  if (arrowEnd !== 'none') {
    const d = arrowheadSvgPath(s.from, s.to, headSize, arrowEnd, false);
    tags.push(`${indent}<path d="${d}" fill="${strokeColor}"${withTransform} />`);
  }
  return tags;
}

/**
 * Build an SVG tag with optional mask wrapper for any node type.
 */
function buildMaskedNode(
  inner: string,
  node: SceneNode,
  doc: SceneDocument,
  indent: string,
): string {
  const mask = resolveMask(node, doc);
  if (!mask) return inner;
  const maskId = `url(#mask-${node.id})`;
  const attr = mask.type === 'clip' && !mask.inverted ? `clip-path` : `mask`;
  return `${indent}<g ${attr}="${maskId}">\n${inner}\n${indent}</g>`;
}

/**
 * Marker for a live warp this exporter could not bake (text, group, frame).
 * The element is emitted undeformed, so the output says so rather than
 * looking like a faithful export.
 */
function warpNotBakedComment(node: SceneNode): string {
  const kind = unbakeableWarpKind(node);
  if (!kind) return '';
  return `<!-- varve: live warp not baked into this ${kind === 'text' ? 'text' : 'container'}; exported undeformed -->\n`;
}

function nodeToSvgTag(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  transform: Affine,
  preserveColorSpace: boolean,
  rasterAssets?: Record<string, import('./types').RasterAsset>,
): string {
  const indent = '  '.repeat(depth);
  // Fold the node's separate `rotation` field (transform · rotate) so the
  // emitted transform matches the canvas renderer. Callers pass the node's
  // local transform; the rotation field lives on the node itself.
  const rot = node.rotation ?? 0;
  const effTransform: Affine = rot !== 0 ? multiplyAffine(transform, rotateDeg(rot)) : transform;

  // Check for a pre-rendered raster asset first — this handles gradient types
  // (angular, diamond) and effects that SVG cannot represent natively.
  const rasterAsset = rasterAssets?.[node.id];
  if (rasterAsset) {
    // Effects that spill outside the source bounds render on a padded
    // surface; the image must be placed at the expansion offset with the
    // expanded size so the spill is visible and the content lands exactly
    // on the node bounds.
    const exp = rasterAsset.expansion;
    const x = exp ? -exp.left : 0;
    const y = exp ? -exp.top : 0;
    const w = exp ? rasterAsset.cssWidth + exp.left + exp.right : rasterAsset.cssWidth;
    const h = exp ? rasterAsset.cssHeight + exp.top + exp.bottom : rasterAsset.cssHeight;
    const href = escapeXml(rasterAsset.dataUrl);
    const t = affineToSvg(effTransform);
    return `${indent}<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" transform="${t}" />`;
  }

  const { fillAttr, comment } = fillToSvg(node, node.id, doc, preserveColorSpace);
  const t = affineToSvg(effTransform);
  const withTransform = ` transform="${t}"`;
  const compositing = svgCompositing(node, node.kind === 'frame' || node.kind === 'group');
  const compositingAttrs = [
    ...compositing.attributes,
    ...(compositing.styles.length > 0 ? [`style="${compositing.styles.join(' ')}"`] : []),
  ];
  const compositingSuffix = compositingAttrs.length > 0 ? ` ${compositingAttrs.join(' ')}` : '';

  switch (node.kind) {
    case 'shape': {
      // Live warp modifiers bake to export-quality path geometry here (SVG has
      // no envelope-distort primitive). Unwarped nodes pass through unchanged.
      const s = exportShapeOf(node, doc);
      const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
      if (imgFill?.image) {
        const img = imgFill.image;
        const href = escapeXml(img.src);
        const placement = imagePlacementForShape(node, img);
        if (!placement) return '';
        const clipId = `clip-${node.id}`;
        const cropClipId = `crop-${node.id}`;
        const contentTransform = imageContentTransform(placement);
        const contentTransformAttr = contentTransform ? ` transform="${contentTransform}"` : '';
        const cropDef = img.crop
          ? `${indent}  <clipPath id="${cropClipId}" clipPathUnits="userSpaceOnUse"><rect ${svgRect(placement.sampleDrawRect)} /></clipPath>\n`
          : '';
        const cropAttr = img.crop ? ` clip-path="url(#${cropClipId})"` : '';
        const nodeMask = resolveMask(node, doc);
        const maskAttr = nodeMask
          ? nodeMask.type === 'clip' && !nodeMask.inverted
            ? ` clip-path="url(#mask-${node.id})"`
            : ` mask="url(#mask-${node.id})"`
          : '';
        const imageTag = `${indent}    <image href="${href}" ${svgRect(placement.drawRect)} preserveAspectRatio="none" />`;
        const shapeInner = [
          `${indent}<g${withTransform}${maskAttr}${compositingSuffix}>`,
          `${indent}  <clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${shapeClipPath(node)}</clipPath>`,
          cropDef.trimEnd(),
          `${indent}  <g clip-path="url(#${clipId})">`,
          `${indent}    <g${contentTransformAttr}${cropAttr}>`,
          imageTag,
          `${indent}    </g>`,
          `${indent}  </g>`,
          `${indent}</g>`,
        ]
          .filter(Boolean)
          .join('\n');
        return comment
          ? `${indent}<!-- ${comment} -->
${shapeInner}`
          : shapeInner;
      }
      let shapeInner: string;
      switch (s.kind) {
        case 'rect':
          shapeInner = `${indent}<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fillAttr}"${withTransform}${compositingSuffix} />`;
          break;
        case 'ellipse':
          shapeInner = `${indent}<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${fillAttr}"${withTransform}${compositingSuffix} />`;
          break;
        case 'circle':
          shapeInner = `${indent}<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fillAttr}"${withTransform}${compositingSuffix} />`;
          break;
        case 'line':
        case 'arrow': {
          const stroke = node.strokes?.[0];
          const sw = stroke?.weight ?? s.tolerance * 2;
          const strokeColor = stroke?.color ? rgba(stroke.color) : fillAttr;
          const lineTag = `${indent}<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}" stroke="${strokeColor}" stroke-width="${sw}" stroke-linecap="${stroke?.cap ?? 'round'}"${withTransform} />`;
          const headTags = lineArrowheadSvgTags(node, indent, withTransform);
          shapeInner =
            headTags.length > 0
              ? `${indent}<g${compositingSuffix}>\n${lineTag}\n${headTags.join('\n')}\n${indent}</g>`
              : lineTag.replace(' />', `${compositingSuffix} />`);
          break;
        }
        case 'polygon':
        case 'star':
          shapeInner = `${indent}<polygon points="${shapeVerticesToPoints(node)}" fill="${fillAttr}"${withTransform}${compositingSuffix} />`;
          break;
        case 'path': {
          // Holes are emitted as extra subpaths, so the fill rule has to ride
          // along or a compound path renders solid. Matches the document
          // emitter in index.ts.
          const fillRule = s.fillRule ?? (s.holes && s.holes.length > 0 ? 'evenodd' : undefined);
          const fillRuleAttr = fillRule ? ` fill-rule="${fillRule}"` : '';
          shapeInner = `${indent}<path d="${pathToData(s)}" fill="${fillAttr}"${fillRuleAttr}${withTransform}${compositingSuffix} />`;
          break;
        }
        default:
          shapeInner = '';
      }
      return buildMaskedNode(
        comment
          ? `${indent}<!-- ${comment} -->
${shapeInner}`
          : shapeInner,
        node,
        doc,
        indent,
      );
    }
    case 'text': {
      const textNode = node as TextNode;
      const attrs: string[] = [
        `x="0"`,
        `y="0"`,
        `fill="${fillAttr}"`,
        `font-size="${textNode.fontSize}"`,
      ];
      if (textNode.fontFamily) attrs.push(`font-family="${escapeXml(textNode.fontFamily)}"`);
      if (textNode.fontWeight) attrs.push(`font-weight="${textNode.fontWeight}"`);
      if (textNode.fontStyle === 'italic') attrs.push(`font-style="italic"`);
      if (textNode.textAlign)
        attrs.push(
          `text-anchor="${textNode.textAlign === 'center' ? 'middle' : textNode.textAlign === 'right' ? 'end' : 'start'}"`,
        );
      if (textNode.direction === 'rtl') {
        attrs.push('direction="rtl"', 'unicode-bidi="bidi-override"');
      }
      if (textNode.letterSpacing) attrs.push(`letter-spacing="${textNode.letterSpacing}"`);
      if (textNode.lineHeight) attrs.push(`line-height="${textNode.lineHeight}"`);
      if (textNode.textDecoration && textNode.textDecoration !== 'none') {
        attrs.push(`text-decoration="${textNode.textDecoration}"`);
      }

      const styleParts: string[] = [];
      if (textNode.variableAxes && Object.keys(textNode.variableAxes).length > 0) {
        const settings = Object.entries(textNode.variableAxes)
          .map(([tag, value]) => `"${tag}" ${value}`)
          .join(', ');
        styleParts.push(`font-variation-settings: ${settings};`);
      }
      if (textNode.openTypeFeatures && Object.keys(textNode.openTypeFeatures).length > 0) {
        const features = Object.entries(textNode.openTypeFeatures)
          .filter(([tag]) => tag !== 'custom')
          .map(([tag, on]) => `"${tag}" ${on ? '1' : '0'}`)
          .join(', ');
        if (features) styleParts.push(`font-feature-settings: ${features};`);
        const custom = textNode.openTypeFeatures.custom;
        if (custom) {
          const customFeatures = Object.entries(custom)
            .map(([tag, on]) => `"${tag}" ${on ? '1' : '0'}`)
            .join(', ');
          if (customFeatures) styleParts.push(`font-feature-settings: ${customFeatures};`);
        }
      }
      attrs.push(...compositing.attributes);
      styleParts.push(...compositing.styles);
      if (styleParts.length > 0) attrs.push(`style="${styleParts.join(' ')}"`);

      const content = buildTextContent(textNode, indent);
      const textTag = `${indent}${warpNotBakedComment(node)}<text ${attrs.join(' ')}${withTransform}>\n${content}\n${indent}</text>`;
      return buildMaskedNode(textTag, node, doc, indent);
    }
    case 'frame':
    case 'group': {
      const mask = resolveMask(node, doc);
      const filteredChildren = getChildren(doc, node).filter(
        (child) => !(mask?.hideMaskSource && mask.sourceNodeId === child.id),
      );
      const children = filteredChildren
        .map((child) =>
          nodeToSvgTag(child, doc, depth + 1, child.transform, preserveColorSpace, rasterAssets),
        )
        .join('\n');
      let groupAttrs = withTransform;
      groupAttrs += compositingSuffix;
      if (mask) {
        const maskId = `url(#mask-${node.id})`;
        if (mask.type === 'clip' && !mask.inverted) {
          groupAttrs = ` clip-path="${maskId}"${groupAttrs}`;
        } else {
          groupAttrs = ` mask="${maskId}"${groupAttrs}`;
        }
      }
      return `${indent}${warpNotBakedComment(node)}<g${groupAttrs}>\n${children}\n${indent}</g>`;
    }
    case 'table': {
      // ADR-0016: native tables export as flattened cells (SVG has no table
      // semantics); geometry and wrapping come from the shared deterministic
      // layout so export matches the canvas exactly.
      const tableNode = node as import('@varve/scene').TableNode;
      const layout = computeTableLayout(tableNode.table, tableNode.w ?? 480);
      const out: string[] = [`${indent}<g${withTransform}${compositingSuffix}>`];
      const app = tableNode.table.appearance;
      const padding = app.cellPadding ?? 8;
      const fontSize = 13;
      for (const cell of layout.cellLayouts) {
        const fill = cell.isHeader
          ? app.headerFill
          : cell.zebra && app.zebra
            ? app.alternateFill
            : app.bodyFill;
        out.push(
          `${indent}  <rect x="${fmt(cell.x)}" y="${fmt(cell.y)}" width="${fmt(cell.w)}" height="${fmt(cell.h)}" fill="${rgba(fill)}" />`,
        );
        if (cell.content.kind === 'text' && cell.content.text) {
          const color = cell.isHeader ? app.headerText : app.bodyText;
          const weight = cell.isHeader ? 600 : 400;
          const align = cell.style?.alignH ?? (cell.isHeader ? 'center' : 'left');
          const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
          const textX =
            align === 'center'
              ? cell.x + cell.w / 2
              : align === 'right'
                ? cell.x + cell.w - padding
                : cell.x + padding;
          const lines = textWrap(cell.content.text, Math.max(8, cell.w - padding * 2), {
            fontSize,
            fontFamily: DEFAULT_ARTWORK_FONT_FAMILY,
            fontWeight: weight,
            lineHeight: 1.35,
          });
          const lineH = fontSize * 1.35;
          const totalH = lines.length * lineH;
          const alignV = cell.style?.alignV ?? 'middle';
          let textY = cell.y + padding + lineH - 3;
          if (alignV === 'middle')
            textY = cell.y + Math.max(padding, (cell.h - totalH) / 2) + lineH - 3;
          else if (alignV === 'bottom') textY = cell.y + cell.h - padding - totalH + lineH - 3;
          for (const line of lines) {
            out.push(
              `${indent}  <text x="${fmt(textX)}" y="${fmt(textY)}" fill="${rgba(color)}" font-size="${fontSize}" font-family="${escapeXml(DEFAULT_ARTWORK_FONT_FAMILY)}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(line.text)}</text>`,
            );
            textY += lineH;
          }
        }
      }
      // Inner dividers + outer border.
      const divider = app.dividerWidth;
      if (divider > 0) {
        const half = divider / 2;
        for (let i = 1; i < layout.colPositions.length; i++) {
          const x = layout.colPositions[i] ?? 0;
          out.push(
            `${indent}  <rect x="${fmt(x - half)}" y="0" width="${fmt(divider)}" height="${fmt(layout.totalH)}" fill="${rgba(app.dividerColor)}" />`,
          );
        }
        for (let i = 1; i < layout.rowPositions.length; i++) {
          const y = layout.rowPositions[i] ?? 0;
          out.push(
            `${indent}  <rect x="0" y="${fmt(y - half)}" width="${fmt(layout.totalW)}" height="${fmt(divider)}" fill="${rgba(app.dividerColor)}" />`,
          );
        }
      }
      if (app.borderWidth > 0) {
        out.push(
          `${indent}  <rect x="0" y="0" width="${fmt(tableNode.w)}" height="${fmt(tableNode.h)}" fill="none" stroke="${rgba(app.borderColor)}" stroke-width="${fmt(app.borderWidth)}" />`,
        );
      }
      out.push(`${indent}</g>`);
      return out.join('\n');
    }
    case 'adjustment': {
      const asset = rasterAssets?.[node.id];
      if (asset) {
        const exp = asset.expansion;
        const x = exp ? -exp.left : 0;
        const y = exp ? -exp.top : 0;
        const w = exp ? asset.cssWidth + exp.left + exp.right : asset.cssWidth;
        const h = exp ? asset.cssHeight + exp.top + exp.bottom : asset.cssHeight;
        const href = escapeXml(asset.dataUrl);
        return `${indent}<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}"${withTransform} />`;
      }
      return '';
    }
  }
  return '';
}

export function exportNodeToSvg(
  node: SceneNode,
  doc: SceneDocument,
  opts?: SvgExportOptions,
): string {
  const rasterAssets = opts?.rasterAssets;
  const bounds = nodeSvgBounds(node, doc);
  const pos = {
    x: bounds?.minX ?? node.transform[4] ?? 0,
    y: bounds?.minY ?? node.transform[5] ?? 0,
    w: opts?.viewBoxWidth ?? Math.max(1, (bounds?.maxX ?? 200) - (bounds?.minX ?? 0)),
    h: opts?.viewBoxHeight ?? Math.max(1, (bounds?.maxY ?? 160) - (bounds?.minY ?? 0)),
  };
  const maskDefs = collectSubtreeMaskDefs(doc, node);
  const gradDefs = collectGradientDefs(node, node.id, opts?.preserveColorSpace ?? false);
  const allDefs = [...maskDefs, ...gradDefs];
  const defsSection = allDefs.length > 0 ? `  <defs>\n${allDefs.join('\n')}\n  </defs>\n` : '';
  const inner = nodeToSvgTag(
    node,
    doc,
    2,
    node.transform,
    opts?.preserveColorSpace ?? false,
    rasterAssets,
  );
  const backdrop =
    opts?.background === 'transparent'
      ? ''
      : '  <rect width="100%" height="100%" fill="#ffffff" />';
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(pos.x)} ${fmt(pos.y)} ${fmt(pos.w)} ${fmt(pos.h)}" width="${fmt(pos.w)}" height="${fmt(pos.h)}">`,
    backdrop,
    defsSection,
    inner,
    `</svg>`,
    '',
  ].join('\n');
  return opts?.minify ? minifySvg(svg) : svg;
}

/**
 * Report features used by `node` that inline SVG 1.1 cannot represent
 * portably — primarily external image references and CSS-only effects.
 *
 * SVG has broad coverage; gaps are limited to embedded assets and
 * browser-specific filter support.
 */
export function svgTargetGaps(
  node: SceneNode,
  _doc: SceneDocument,
  flattenedNodes?: Set<string>,
): TargetGap[] {
  const gaps: TargetGap[] = [
    ...adjustmentStackTargetGaps(node, undefined, flattenedNodes?.has(node.id)),
  ];

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'external image reference',
      severity: 'warning',
      fallback: 'Embed image as a base64 data URL for self-contained SVG portability',
    });
  }

  const fills = node.fills ?? [];
  const nonLinearGradientFill = fills.find(
    (f) =>
      f.type === 'gradient' &&
      f.gradient &&
      f.gradient.type !== 'linear' &&
      f.gradient.type !== 'radial',
  );
  if (nonLinearGradientFill?.gradient) {
    const gradType = nonLinearGradientFill.gradient.type;
    const flattened = flattenedNodes?.has(node.id);
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `${gradType} gradient fill`,
      severity: flattened ? 'info' : 'warning',
      fallback: flattened
        ? 'Rasterized at export resolution — gradient preserved as pixel-accurate image'
        : 'Flatten to a raster bitmap for correct export, or use a linear/radial gradient',
    });
  }

  if (fills.some((f) => f.type === 'pattern')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'pattern fill',
      severity: 'warning',
      fallback: 'Use an SVG <pattern> element with patternUnits="userSpaceOnUse"',
    });
  }

  // Shape leaves bake to path data; text and containers cannot yet, and must
  // not be reported as clean when their deformation was not applied.
  const unbakeable = unbakeableWarpKind(node);
  if (unbakeable) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: unbakeable === 'text' ? 'warped text' : 'warped group or frame',
      severity: 'warning',
      fallback:
        unbakeable === 'text'
          ? 'SVG <text> cannot carry a nonlinear warp — outline the text (Expand Appearance) or rasterize before export; it currently exports undeformed'
          : 'Container warps are not baked per child — Expand Appearance on the leaves, or rasterize the group; it currently exports undeformed',
    });
  }

  const effects =
    node.kind === 'shape' || node.kind === 'text' || node.kind === 'frame' || node.kind === 'group'
      ? (node.effects ?? [])
      : [];
  if (effects.some((e) => e.type === 'backgroundBlur')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'background blur effect',
      severity: 'warning',
      fallback: 'Use feGaussianBlur inside an SVG <filter> element (limited browser support)',
    });
  }

  return gaps;
}
