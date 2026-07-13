/**
 * Per-node SVG export target.
 *
 * Research basis: SVG 1.1 (W3C Recommendation).
 */

import type { Affine } from '@strata/engine';
import type { Document as SceneDocument, SceneNode, TextNode } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { applyAffine, multiplyAffine } from '@strata/shared';
import {
  adjustmentStackTargetGaps,
  affineToSvg,
  escapeXml,
  getChildren,
  rgba,
  shapeVerticesToPoints,
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

function shapeClipPath(node: import('@strata/scene').SceneNode): string {
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
      return `<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}" stroke="black" stroke-width="${s.tolerance * 2}" />`;
    case 'arrow':
      return `<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}" stroke="black" stroke-width="${s.tolerance * 2}" />`;
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
function fillToSvg(node: SceneNode, nodeId: string): { defs: string; fillAttr: string } {
  if (!node.fills || node.fills.length === 0) {
    return { defs: '', fillAttr: rgba(node.fill) };
  }

  // For a single solid fill, use the color directly
  if (node.fills.length === 1 && node.fills[0]?.type === 'solid' && node.fills[0]?.color) {
    return { defs: '', fillAttr: rgba(node.fills[0].color) };
  }

  // For gradient fills, generate <defs> with gradient elements
  const defs: string[] = [];
  const fillAttrs: string[] = [];

  node.fills.forEach((fill, i) => {
    if (fill.type === 'solid' && fill.color) {
      fillAttrs.push(rgba(fill.color));
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

      spans.push(`${childIndent}<tspan ${runAttrs.join(' ')}>${escapeXml(run.text)}</tspan>`);
      // Approximate advance for positioning; a real layout engine would provide exact metrics.
      x += run.text.length * (format.fontSize ?? node.fontSize ?? 16) * 0.6;
    }
    y += lineHeight;
  }
  return spans.join('\n');
}

function nodeToSvgTag(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  transform: Affine,
): string {
  const indent = '  '.repeat(depth);
  const { fillAttr } = fillToSvg(node, node.id);
  const t = affineToSvg(transform);
  const withTransform = ` transform="${t}"`;

  switch (node.kind) {
    case 'shape': {
      const s = node.shape;
      // Image fill: render <image> element instead of geometry shape.
      const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
      if (imgFill?.image) {
        const img = imgFill.image;
        const par = fitToPreserveAspectRatio(img.fit);
        const href = escapeXml(img.src);
        if (s.kind === 'rect') {
          return `${indent}<image href="${href}" x="0" y="0" width="${s.w}" height="${s.h}" preserveAspectRatio="${par}"${withTransform} />`;
        }
        const clipId = `clip-${node.id}`;
        const bounds = shapeBounds(s);
        return `${indent}<g${withTransform}>\n${indent}  <clipPath id="${clipId}">${shapeClipPath(node)}</clipPath>\n${indent}  <image href="${href}" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" preserveAspectRatio="${par}" clip-path="url(#${clipId})" />\n${indent}</g>`;
      }
      switch (s.kind) {
        case 'rect':
          return `${indent}<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fillAttr}"${withTransform} />`;
        case 'ellipse':
          return `${indent}<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${fillAttr}"${withTransform} />`;
        case 'circle':
          return `${indent}<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fillAttr}"${withTransform} />`;
        case 'line':
          return `${indent}<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}" stroke="${fillAttr}" stroke-width="${s.tolerance * 2}" stroke-linecap="round"${withTransform} />`;
        case 'polygon':
        case 'star':
          return `${indent}<polygon points="${shapeVerticesToPoints(node)}" fill="${fillAttr}"${withTransform} />`;
        case 'path':
          return `${indent}<path d="${pathToData(s)}" fill="${fillAttr}"${withTransform} />`;
      }
      break;
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
      if (styleParts.length > 0) attrs.push(`style="${styleParts.join(' ')}"`);

      const t = affineToSvg(transform);
      const withTransform = ` transform="${t}"`;
      const content = buildTextContent(textNode, indent);
      return `${indent}<text ${attrs.join(' ')}${withTransform}>\n${content}\n${indent}</text>`;
    }
    case 'frame':
    case 'group': {
      const children = getChildren(doc, node)
        .map((child) => nodeToSvgTag(child, doc, depth + 1, child.transform))
        .join('\n');
      return `${indent}<g${withTransform}>\n${children}\n${indent}</g>`;
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
  const inner = nodeToSvgTag(node, doc, 2, node.transform);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${pos.x} ${pos.y} ${pos.w} ${pos.h}" width="${pos.w}" height="${pos.h}">`,
    `  <rect width="100%" height="100%" fill="#ffffff" />`,
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
