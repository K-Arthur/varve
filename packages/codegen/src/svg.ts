/**
 * Per-node SVG export target.
 *
 * Research basis: SVG 1.1 (W3C Recommendation).
 */

import type { Affine } from '@strata/engine';
import type {
  Mask,
  Document as SceneDocument,
  SceneNode,
  TextNode,
  VectorMaskData,
} from '@strata/scene';
import { isImageShape, resolveMask } from '@strata/scene';
import { applyAffine, multiplyAffine } from '@strata/shared';
import {
  adjustmentStackTargetGaps,
  affineToSvg,
  colorToSvgValue,
  escapeXml,
  getChildren,
  rgba,
  shapeVerticesToPoints,
  svgCompositing,
} from './shared';
import type { TargetGap } from './types';

function fitToPreserveAspectRatio(fit: string): string {
  switch (fit) {
    case 'fill':
      return 'xMidYMid slice';
    case 'fit':
      return 'xMidYMid meet';
    case 'stretch':
      return 'none';
    default:
      return 'xMidYMid meet';
  }
}

function shapeBounds(shape: import('@strata/engine').Shape): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  switch (shape.kind) {
    case 'rect':
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
      return `<rect x="0" y="0" width="${s.w}" height="${s.h}" />`;
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

function pathToData(shape: Extract<import('@strata/engine').Shape, { kind: 'path' }>): string {
  const ringToCommands = (
    points: import('@strata/engine').PathPoint[],
    closed: boolean,
  ): string[] => {
    const first = points[0];
    if (!first) return [];
    const commands = [`M ${first.x} ${first.y}`];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1] as import('@strata/engine').PathPoint;
      const current = points[index] as import('@strata/engine').PathPoint;
      if (previous.handleOut || current.handleIn) {
        const c1x = previous.x + (previous.handleOut?.[0] ?? 0);
        const c1y = previous.y + (previous.handleOut?.[1] ?? 0);
        const c2x = current.x + (current.handleIn?.[0] ?? 0);
        const c2y = current.y + (current.handleIn?.[1] ?? 0);
        commands.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${current.x} ${current.y}`);
      } else {
        commands.push(`L ${current.x} ${current.y}`);
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
  const worldTransform = multiplyAffine(parentTransform, node.transform);
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
  if (node.kind !== 'shape') return null;
  const bounds = shapeBounds(node.shape);
  const points: Array<readonly [number, number]> = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x + bounds.width, bounds.y + bounds.height],
    [bounds.x, bounds.y + bounds.height],
  ];
  if (node.shape.kind === 'path') {
    for (const point of node.shape.points) {
      if (point.handleIn) points.push([point.x + point.handleIn[0], point.y + point.handleIn[1]]);
      if (point.handleOut)
        points.push([point.x + point.handleOut[0], point.y + point.handleOut[1]]);
    }
  }
  return transformedBounds(points, worldTransform);
}

/** P2: Generate SVG <defs> for gradient fills, returns {defs, fillRef}. */
function fillToSvg(
  node: SceneNode,
  nodeId: string,
  doc: SceneDocument,
  preserveColorSpace: boolean,
): { fillAttr: string; comment?: string } {
  if (!node.fills || node.fills.length === 0) {
    const result = colorToSvgValue(node.fill, doc, preserveColorSpace);
    return { fillAttr: result.value, comment: result.warning };
  }

  // For a single solid fill, use the color directly
  if (node.fills.length === 1 && node.fills[0]?.type === 'solid' && node.fills[0]?.color) {
    const result = colorToSvgValue(node.fills[0].color, doc, preserveColorSpace);
    return { fillAttr: result.value, comment: result.warning };
  }

  // For gradient fills, generate <defs> with gradient elements
  const defs: string[] = [];
  const fillAttrs: string[] = [];

  node.fills.forEach((fill, i) => {
    if (fill.type === 'solid' && fill.color) {
      fillAttrs.push(colorToSvgValue(fill.color, doc, preserveColorSpace).value);
    } else if (fill.type === 'gradient' && fill.gradient) {
      const gradId = `grad-${nodeId}-${i}`;
      const rot = (fill.gradient.rotation ?? 0) * (Math.PI / 180);
      const x1 = 50 - Math.cos(rot) * 50;
      const y1 = 50 - Math.sin(rot) * 50;
      const x2 = 50 + Math.cos(rot) * 50;
      const y2 = 50 + Math.sin(rot) * 50;
      const stops = fill.gradient.stops
        .map(
          (s) =>
            `      <stop offset="${(s.position * 100).toFixed(1)}%" stop-color="${rgba(s.color)}" />`,
        )
        .join('\n');
      defs.push(
        `    <linearGradient id="${gradId}" x1="${x1.toFixed(1)}%" y1="${y1.toFixed(1)}%" x2="${x2.toFixed(1)}%" y2="${y2.toFixed(1)}%">\n${stops}\n    </linearGradient>`,
      );
      fillAttrs.push(`url(#${gradId})`);
    }
  });

  // For stacked fills, we'd need multiple elements with different fills.
  // For now, use the topmost fill as the SVG fill attribute.
  return {
    defs: defs.length > 0 ? `  <defs>\n${defs.join('\n')}\n  </defs>\n` : '',
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
  const t = affineToSvg(localTransform);
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
      lines.push(`    <mask id="${maskId}">`);
      lines.push(
        `      <image href="${asset.dataUrl}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" />`,
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

function nodeToSvgTag(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  transform: Affine,
  preserveColorSpace: boolean,
): string {
  const indent = '  '.repeat(depth);
  const { fillAttr, comment } = fillToSvg(node, node.id, doc, preserveColorSpace);
  const t = affineToSvg(transform);
  const withTransform = ` transform="${t}"`;
  const compositing = svgCompositing(node, node.kind === 'frame' || node.kind === 'group');
  const compositingAttrs = [
    ...compositing.attributes,
    ...(compositing.styles.length > 0 ? [`style="${compositing.styles.join(' ')}"`] : []),
  ];
  const compositingSuffix = compositingAttrs.length > 0 ? ` ${compositingAttrs.join(' ')}` : '';

  switch (node.kind) {
    case 'shape': {
      const s = node.shape;
      // Image fill: render <image> element instead of geometry shape.
      const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
      if (imgFill?.image) {
        const img = imgFill.image;
        const par = fitToPreserveAspectRatio(img.fit);
        const href = escapeXml(img.src);
        let shapeInner: string;
        if (s.kind === 'rect') {
          shapeInner = `${indent}<image href="${href}" x="0" y="0" width="${s.w}" height="${s.h}" preserveAspectRatio="${par}"${withTransform}${compositingSuffix} />`;
        } else {
          const clipId = `clip-${node.id}`;
          const bounds = shapeBounds(s);
          shapeInner = `${indent}<g${withTransform}${compositingSuffix}>\n${indent}  <clipPath id="${clipId}">${shapeClipPath(node)}</clipPath>\n${indent}  <image href="${href}" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" preserveAspectRatio="${par}" clip-path="url(#${clipId})" />\n${indent}</g>`;
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
        case 'path':
          shapeInner = `${indent}<path d="${pathToData(s)}" fill="${fillAttr}"${withTransform}${compositingSuffix} />`;
          break;
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
      // RTL direction: emit dir + unicode-bidi so SVG renderers apply the
      // Unicode Bidirectional Algorithm. LTR is the SVG default (omitted);
      // 'auto' is left to the renderer.
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
      const textTag = `${indent}<text ${attrs.join(' ')}${withTransform}>\n${content}\n${indent}</text>`;
      return buildMaskedNode(textTag, node, doc, indent);
    }
    case 'frame':
    case 'group': {
      const mask = resolveMask(node, doc);
      const filteredChildren = getChildren(doc, node).filter(
        (child) => !(mask?.hideMaskSource && mask.sourceNodeId === child.id),
      );
      const children = filteredChildren
        .map((child) => nodeToSvgTag(child, doc, depth + 1, child.transform, preserveColorSpace))
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
      return `${indent}<g${groupAttrs}>\n${children}\n${indent}</g>`;
    }
  }
  return '';
}

export function exportNodeToSvg(
  node: SceneNode,
  doc: SceneDocument,
  opts?: SvgExportOptions,
): string {
  const bounds = nodeSvgBounds(node, doc);
  const pos = {
    x: bounds?.minX ?? node.transform[4] ?? 0,
    y: bounds?.minY ?? node.transform[5] ?? 0,
    w: opts?.viewBoxWidth ?? Math.max(1, (bounds?.maxX ?? 200) - (bounds?.minX ?? 0)),
    h: opts?.viewBoxHeight ?? Math.max(1, (bounds?.maxY ?? 160) - (bounds?.minY ?? 0)),
  };
  const maskDefs = collectSubtreeMaskDefs(doc, node);
  const defsSection = maskDefs.length > 0 ? `  <defs>\n${maskDefs.join('\n')}\n  </defs>\n` : '';
  const inner = nodeToSvgTag(node, doc, 2, node.transform, opts?.preserveColorSpace ?? false);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${pos.x} ${pos.y} ${pos.w} ${pos.h}" width="${pos.w}" height="${pos.h}">`,
    `  <rect width="100%" height="100%" fill="#ffffff" />`,
    defsSection,
    inner,
    `</svg>`,
    '',
  ].join('\n');
}

/**
 * Report features used by `node` that inline SVG 1.1 cannot represent
 * portably — primarily external image references and CSS-only effects.
 *
 * SVG has broad coverage; gaps are limited to embedded assets and
 * browser-specific filter support.
 */
export function svgTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

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
  if (fills.some((f) => f.type === 'pattern')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'pattern fill',
      severity: 'warning',
      fallback: 'Use an SVG <pattern> element with patternUnits="userSpaceOnUse"',
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
