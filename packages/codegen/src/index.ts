/**
 * @strata/codegen — Scene → code export (Strata plan §3.3, task 0.10).
 *
 * Exports the scene model to CSS, React+Tailwind, React+CSS-Modules,
 * SVG, Flutter, and SwiftUI output. All exports are local-only:
 * zero network round-trips.
 */

import type { Affine } from '@strata/engine';
import type { Document, ManagedColor, NodeId, SceneNode } from '@strata/scene';
import { managedColorToRgba } from '@strata/shared';

export { timelineToCSSKeyframes } from './animation-css';
export { timelineToLottieJSON } from './animation-lottie';
export { timelineToSVGAnimations } from './animation-svg';
export { exportInteractiveAnimations } from './animation-interactive';
export type { InteractiveExportOptions, InteractiveExportResult } from './animation-interactive';
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

/**
 * Compute the bounding box of all root-level nodes in a document.
 */
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
    hasNodes = true;
    const tx = node.transform[4] ?? 0;
    const ty = node.transform[5] ?? 0;
    let bx = 0,
      by = 0,
      bw = 100,
      bh = 100;
    if (node.kind === 'shape') {
      const s = node.shape;
      switch (s.kind) {
        case 'rect':
          bx = s.x;
          by = s.y;
          bw = s.w;
          bh = s.h;
          break;
        case 'ellipse':
          bx = s.cx - s.rx;
          by = s.cy - s.ry;
          bw = s.rx * 2;
          bh = s.ry * 2;
          break;
        case 'circle':
          bx = s.cx - s.r;
          by = s.cy - s.r;
          bw = s.r * 2;
          bh = s.r * 2;
          break;
        case 'line':
          bx = Math.min(s.from[0], s.to[0]);
          by = Math.min(s.from[1], s.to[1]);
          bw = Math.abs(s.to[0] - s.from[0]);
          bh = Math.abs(s.to[1] - s.from[1]);
          break;
        case 'polygon':
          bx = s.cx - s.radius;
          by = s.cy - s.radius;
          bw = s.radius * 2;
          bh = s.radius * 2;
          break;
        case 'star':
          bx = s.cx - s.outerRadius;
          by = s.cy - s.outerRadius;
          bw = s.outerRadius * 2;
          bh = s.outerRadius * 2;
          break;
      }
    } else if (node.kind === 'text') {
      bw = node.text.length * node.fontSize * 0.6;
      bh = node.fontSize * 1.2;
    } else if (node.kind === 'frame') {
      bw = 200;
      bh = 200; // approximate
    }
    minX = Math.min(minX, tx + bx);
    minY = Math.min(minY, ty + by);
    maxX = Math.max(maxX, tx + bx + bw);
    maxY = Math.max(maxY, ty + by + bh);
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
