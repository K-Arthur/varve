/**
 * @strata/codegen — Scene → code export (Strata plan §3.3, task 0.10).
 *
 * Exports the scene model to CSS, React+Tailwind, React+CSS-Modules,
 * SVG, Flutter, and SwiftUI output. All exports are local-only:
 * zero network round-trips.
 */

import type { Affine } from '@strata/engine';
import type { Document, ManagedColor, NodeId, SceneNode } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { applyAffine, managedColorToRgba, multiplyAffine } from '@strata/shared';

export { timelineToCSSKeyframes } from './animation-css';
export type { InteractiveExportOptions, InteractiveExportResult } from './animation-interactive';
export { exportInteractiveAnimations } from './animation-interactive';
export { timelineToLottieJSON } from './animation-lottie';
export { timelineToSVGAnimations } from './animation-svg';
export { cssTargetGaps, exportNodeToCss } from './css';
export { cssModulesTargetGaps, exportNodeToCssModules } from './css-modules';
export { exportNodeToFlutter, flutterTargetGaps } from './flutter';
export * from './shared';
export * from './spec';
export { exportNodeToSvg, svgTargetGaps } from './svg';
export { exportNodeToSwiftUI, swiftuiTargetGaps } from './swiftui';
export { exportNodeToTailwind, tailwindTargetGaps } from './tailwind';
export * from './target-analysis';
export { resolveTokenName } from './tokens';
export type { CodeEmitter, TargetGap } from './types';

export const PACKAGE = '@strata/codegen' as const;

export interface SvgExportOptions {
  precision?: number;
  minify?: boolean;
  includeHidden?: boolean;
  styleMode?: 'inline' | 'presentation';
}

function rgba(c: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(c);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

function affineToSvg(t: Affine): string {
  return `matrix(${t[0]},${t[1]},${t[2]},${t[3]},${t[4]},${t[5]})`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n: number, precision: number): string {
  return precision < 10 ? Number(n.toFixed(precision)).toString() : n.toString();
}

function shapeVerticesToPoints(
  s: { kind: string } & Record<string, unknown>,
  precision: number,
): string {
  if (s.kind === 'polygon') {
    const cx = Number(s.cx),
      cy = Number(s.cy),
      radius = Number(s.radius);
    const sides = Number(s.sides),
      rotation = Number(s.rotation);
    const pts: string[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides - Math.PI / 2 + rotation;
      pts.push(
        `${fmtNum(cx + radius * Math.cos(a), precision)},${fmtNum(cy + radius * Math.sin(a), precision)}`,
      );
    }
    return pts.join(' ');
  }
  if (s.kind === 'star') {
    const cx = Number(s.cx),
      cy = Number(s.cy),
      ir = Number(s.innerRadius),
      or = Number(s.outerRadius);
    const points = Number(s.points),
      rotation = Number(s.rotation);
    const pts: string[] = [];
    for (let i = 0; i < points * 2; i++) {
      const a = (Math.PI * i) / points - Math.PI / 2 + rotation;
      const r = i % 2 === 0 ? or : ir;
      pts.push(
        `${fmtNum(cx + r * Math.cos(a), precision)},${fmtNum(cy + r * Math.sin(a), precision)}`,
      );
    }
    return pts.join(' ');
  }
  return '';
}

function shapePathToData(
  shape: Extract<import('@strata/engine').Shape, { kind: 'path' }>,
  precision: number,
): string {
  const ringToCommands = (points: import('@strata/engine').PathPoint[], closed: boolean) => {
    const first = points[0];
    if (!first) return [];
    const commands = [`M ${fmtNum(first.x, precision)} ${fmtNum(first.y, precision)}`];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1] as import('@strata/engine').PathPoint;
      const current = points[index] as import('@strata/engine').PathPoint;
      if (previous.handleOut || current.handleIn) {
        const c1x = previous.x + (previous.handleOut?.[0] ?? 0);
        const c1y = previous.y + (previous.handleOut?.[1] ?? 0);
        const c2x = current.x + (current.handleIn?.[0] ?? 0);
        const c2y = current.y + (current.handleIn?.[1] ?? 0);
        commands.push(
          `C ${fmtNum(c1x, precision)} ${fmtNum(c1y, precision)} ${fmtNum(c2x, precision)} ${fmtNum(c2y, precision)} ${fmtNum(current.x, precision)} ${fmtNum(current.y, precision)}`,
        );
      } else {
        commands.push(`L ${fmtNum(current.x, precision)} ${fmtNum(current.y, precision)}`);
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

/**
 * Compute the bounding box of all root-level nodes in a document.
 */
function documentNodeBounds(
  node: SceneNode,
  doc: Document,
  parentTransform: Affine = [1, 0, 0, 1, 0, 0],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const transform = multiplyAffine(parentTransform, node.transform);
  if (node.kind === 'group' || node.kind === 'frame') {
    const children = node.children
      .map((id) => doc.nodes[id])
      .filter((child): child is SceneNode => child?.visible === true)
      .map((child) => documentNodeBounds(child, doc, transform))
      .filter((bounds): bounds is NonNullable<typeof bounds> => bounds !== null);
    if (children.length > 0) {
      return {
        minX: Math.min(...children.map((bounds) => bounds.minX)),
        minY: Math.min(...children.map((bounds) => bounds.minY)),
        maxX: Math.max(...children.map((bounds) => bounds.maxX)),
        maxY: Math.max(...children.map((bounds) => bounds.maxY)),
      };
    }
  }

  let x = 0;
  let y = 0;
  let width = 100;
  let height = 100;
  if (node.kind === 'shape') {
    const shape = node.shape;
    switch (shape.kind) {
      case 'rect':
        ({ x, y, w: width, h: height } = shape);
        break;
      case 'ellipse':
        x = shape.cx - shape.rx;
        y = shape.cy - shape.ry;
        width = shape.rx * 2;
        height = shape.ry * 2;
        break;
      case 'circle':
        x = shape.cx - shape.r;
        y = shape.cy - shape.r;
        width = shape.r * 2;
        height = shape.r * 2;
        break;
      case 'line':
      case 'arrow':
        x = Math.min(shape.from[0], shape.to[0]);
        y = Math.min(shape.from[1], shape.to[1]);
        width = Math.max(1, Math.abs(shape.to[0] - shape.from[0]));
        height = Math.max(1, Math.abs(shape.to[1] - shape.from[1]));
        break;
      case 'polygon':
        x = shape.cx - shape.radius;
        y = shape.cy - shape.radius;
        width = shape.radius * 2;
        height = shape.radius * 2;
        break;
      case 'star':
        x = shape.cx - shape.outerRadius;
        y = shape.cy - shape.outerRadius;
        width = shape.outerRadius * 2;
        height = shape.outerRadius * 2;
        break;
      case 'path': {
        if (shape.points.length === 0) break;
        const xs = shape.points.flatMap((point) => [
          point.x,
          point.x + (point.handleIn?.[0] ?? 0),
          point.x + (point.handleOut?.[0] ?? 0),
        ]);
        const ys = shape.points.flatMap((point) => [
          point.y,
          point.y + (point.handleIn?.[1] ?? 0),
          point.y + (point.handleOut?.[1] ?? 0),
        ]);
        x = Math.min(...xs);
        y = Math.min(...ys);
        width = Math.max(1, Math.max(...xs) - x);
        height = Math.max(1, Math.max(...ys) - y);
        break;
      }
    }
  } else if (node.kind === 'text') {
    width = Math.max(1, node.text.length * node.fontSize * 0.6);
    height = Math.max(1, node.fontSize * 1.2);
  } else if (node.kind === 'path') {
    if (node.points.length > 0) {
      const xs = node.points.map((point) => point.x);
      const ys = node.points.map((point) => point.y);
      x = Math.min(...xs);
      y = Math.min(...ys);
      width = Math.max(1, Math.max(...xs) - x);
      height = Math.max(1, Math.max(...ys) - y);
    }
  } else if (node.kind === 'frame') {
    width = 200;
    height = 200;
  }

  const corners = [
    applyAffine(transform, [x, y]),
    applyAffine(transform, [x + width, y]),
    applyAffine(transform, [x + width, y + height]),
    applyAffine(transform, [x, y + height]),
  ];
  return {
    minX: Math.min(...corners.map((point) => point[0])),
    minY: Math.min(...corners.map((point) => point[1])),
    maxX: Math.max(...corners.map((point) => point[0])),
    maxY: Math.max(...corners.map((point) => point[1])),
  };
}

export function computeDocumentBounds(doc: Document): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let hasNodes = false;
  const contentRoots = new Set(doc.pages?.map((p) => p.contentRoot) ?? []);

  for (const id of doc.rootChildren) {
    const node = doc.nodes[id];
    if (!node?.visible) continue;
    if (contentRoots.has(id)) continue;
    const bounds = documentNodeBounds(node, doc);
    if (!bounds) continue;
    hasNodes = true;
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  if (!hasNodes) return { x: 0, y: 0, w: doc.canvasWidth ?? 1920, h: doc.canvasHeight ?? 1080 };

  const padX = 20;
  const x = Math.round(minX - padX);
  const y = Math.round(minY - padX);
  const w = Math.round(maxX - minX + padX * 2);
  const h = Math.round(maxY - minY + padX * 2);
  return { x: Math.max(0, x), y: Math.max(0, y), w: Math.max(1, w), h: Math.max(1, h) };
}

function nodeToSvg(
  node: SceneNode,
  doc: Document,
  depth: number,
  options: SvgExportOptions,
): string {
  if (!options.includeHidden && !node.visible) return '';
  const precision = options.precision ?? 3;
  const indent = options.minify ? '' : '  '.repeat(depth);
  const fill = rgba(node.fill);
  const transform = affineToSvg(node.transform);

  switch (node.kind) {
    case 'shape': {
      const s = node.shape;
      // Image fill: render <image> element instead of geometry shape.
      if (isImageShape(node)) {
        const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
        if (imgFill?.image) {
          const img = imgFill.image;
          const par =
            img.fit === 'fill'
              ? 'xMidYMid slice'
              : img.fit === 'stretch'
                ? 'none'
                : 'xMidYMid meet';
          const href = escapeXml(img.src);
          const w = fmtNum(s.kind === 'rect' ? s.w : 200, precision);
          const h = fmtNum(s.kind === 'rect' ? s.h : 160, precision);
          return `${indent}<image href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="${par}" transform="${transform}" />`;
        }
      }
      switch (s.kind) {
        case 'rect':
          return `${indent}<rect x="${fmtNum(s.x, precision)}" y="${fmtNum(s.y, precision)}" width="${fmtNum(s.w, precision)}" height="${fmtNum(s.h, precision)}" fill="${fill}" transform="${transform}" />`;
        case 'ellipse':
          return `${indent}<ellipse cx="${fmtNum(s.cx, precision)}" cy="${fmtNum(s.cy, precision)}" rx="${fmtNum(s.rx, precision)}" ry="${fmtNum(s.ry, precision)}" fill="${fill}" transform="${transform}" />`;
        case 'circle':
          return `${indent}<circle cx="${fmtNum(s.cx, precision)}" cy="${fmtNum(s.cy, precision)}" r="${fmtNum(s.r, precision)}" fill="${fill}" transform="${transform}" />`;
        case 'line':
          return `${indent}<line x1="${fmtNum(s.from[0], precision)}" y1="${fmtNum(s.from[1], precision)}" x2="${fmtNum(s.to[0], precision)}" y2="${fmtNum(s.to[1], precision)}" stroke="${fill}" stroke-width="${fmtNum(s.tolerance * 2, precision)}" stroke-linecap="round" transform="${transform}" />`;
        case 'polygon':
          return `${indent}<polygon points="${shapeVerticesToPoints(s, precision)}" fill="${fill}" transform="${transform}" />`;
        case 'star':
          return `${indent}<polygon points="${shapeVerticesToPoints(s, precision)}" fill="${fill}" transform="${transform}" />`;
        case 'path': {
          const fillRule = s.fillRule ?? (s.holes && s.holes.length > 0 ? 'evenodd' : undefined);
          const fillRuleAttr = fillRule ? ` fill-rule="${fillRule}"` : '';
          return `${indent}<path d="${shapePathToData(s, precision)}" fill="${fill}"${fillRuleAttr} transform="${transform}" />`;
        }
        default:
          return `${indent}<!-- unsupported shape: ${s.kind} -->`;
      }
    }
    case 'text':
      return `${indent}<text x="0" y="0" fill="${fill}" font-size="${node.fontSize}" font-family="${node.fontFamily ?? 'Inter'}" font-weight="${node.fontWeight ?? 400}" transform="${transform}">${escapeXml(node.text)}</text>`;
    case 'frame':
    case 'group': {
      const children = (node.children ?? [])
        .map((cid: NodeId) => {
          const child = doc.nodes[cid];
          return child ? nodeToSvg(child, doc, depth + 1, options) : '';
        })
        .filter(Boolean)
        .join(options.minify ? '' : '\n');
      const sep = options.minify ? '' : '\n';
      return `${indent}<g transform="${transform}">${sep}${children}${sep}${indent}</g>`;
    }
    default:
      return '';
  }
}

/** Export a Document to a standalone SVG string. (legacy, backward-compatible) */
export function exportDocumentToSvg(doc: Document): string {
  const w = doc.canvasWidth ?? 1920;
  const h = doc.canvasHeight ?? 1080;
  return exportDocumentToSvgAdvanced(doc, {}, { x: 0, y: 0, w, h });
}

/** Export a Document to SVG with advanced options. */
export function exportDocumentToSvgAdvanced(
  doc: Document,
  options: SvgExportOptions,
  boundsOverride?: { x: number; y: number; w: number; h: number },
): string {
  const bounds = boundsOverride ?? computeDocumentBounds(doc);
  const nl = options.minify ? '' : '\n';
  const contentRoots = new Set(doc.pages?.map((p) => p.contentRoot) ?? []);
  const children = doc.rootChildren
    .filter((id) => !contentRoots.has(id))
    .map((id: NodeId) => {
      const node = doc.nodes[id];
      return node ? nodeToSvg(node, doc, 2, options) : '';
    })
    .filter(Boolean)
    .join(options.minify ? '' : '\n');

  const parts: string[] = [];
  if (!options.minify) {
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  }
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}" width="${bounds.w}" height="${bounds.h}">`,
  );
  parts.push(
    `  <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="#ffffff" />`,
  );
  parts.push(children);
  parts.push(`</svg>`);

  return parts.join(nl);
}

/** Export a Document to React/Tailwind JSX. (legacy, backward-compatible) */
export function exportDocumentToReact(doc: Document): string {
  const children = doc.rootChildren
    .map((id: NodeId) => {
      const node = doc.nodes[id];
      if (!node) return '';
      const fill = rgba(node.fill);
      switch (node.kind) {
        case 'shape': {
          const s = node.shape;
          const t = affineToSvg(node.transform);
          switch (s.kind) {
            case 'rect':
              return `        <rect x={${s.x}} y={${s.y}} width={${s.w}} height={${s.h}} fill="${fill}" style={{ transform: "${t}" }} />`;
            case 'ellipse':
              return `        <ellipse cx={${s.cx}} cy={${s.cy}} rx={${s.rx}} ry={${s.ry}} fill="${fill}" style={{ transform: "${t}" }} />`;
            case 'circle':
              return `        <circle cx={${s.cx}} cy={${s.cy}} r={${s.r}} fill="${fill}" style={{ transform: "${t}" }} />`;
            case 'line':
              return `        <line x1={${s.from[0]}} y1={${s.from[1]}} x2={${s.to[0]}} y2={${s.to[1]}} stroke="${fill}" strokeWidth={${s.tolerance * 2}} strokeLinecap="round" style={{ transform: "${t}" }} />`;
            case 'polygon':
            case 'star':
              return `        <polygon points="${shapeVerticesToPoints(s, 3)}" fill="${fill}" style={{ transform: "${t}" }} />`;
          }
          break;
        }
        case 'text':
          return `        <text x={0} y={0} fill="${fill}" fontSize={${node.fontSize}} style={{ transform: "${affineToSvg(node.transform)}" }}>${escapeXml(node.text)}</text>`;
        case 'frame':
          return `        <g style={{ transform: "${affineToSvg(node.transform)}" }}>\n          {/* frame children */}\n        </g>`;
        default:
          return '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

  return [
    `import type { FC } from 'react';`,
    '',
    `export const ExportedScene: FC = () => (`,
    `  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="100%" height="100%">`,
    `    <rect width="100%" height="100%" fill="#ffffff" />`,
    children,
    `  </svg>`,
    `);`,
    '',
  ].join('\n');
}
