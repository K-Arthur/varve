/**
 * Per-node SVG export target.
 *
 * Research basis: SVG 1.1 (W3C Recommendation).
 */

import type { Affine } from '@strata/engine';
import type { Document as SceneDocument, SceneNode } from '@strata/scene';
import { affineToSvg, escapeXml, getChildren, rgba, shapeVerticesToPoints } from './shared';

export interface SvgExportOptions {
  /** Width of the SVG viewBox. Defaults to node width. */
  viewBoxWidth?: number;
  /** Height of the SVG viewBox. Defaults to node height. */
  viewBoxHeight?: number;
}

function nodeToSvgTag(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  transform: Affine,
): string {
  const indent = '  '.repeat(depth);
  const fill = rgba(node.fill);
  const t = affineToSvg(transform);
  const withTransform = ` transform="${t}"`;

  switch (node.kind) {
    case 'shape': {
      const s = node.shape;
      switch (s.kind) {
        case 'rect':
          return `${indent}<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fill}"${withTransform} />`;
        case 'ellipse':
          return `${indent}<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${fill}"${withTransform} />`;
        case 'circle':
          return `${indent}<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fill}"${withTransform} />`;
        case 'line':
          return `${indent}<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}" stroke="${fill}" stroke-width="${s.tolerance * 2}" stroke-linecap="round"${withTransform} />`;
        case 'polygon':
        case 'star':
          return `${indent}<polygon points="${shapeVerticesToPoints(node)}" fill="${fill}"${withTransform} />`;
      }
      break;
    }
    case 'text':
      return `${indent}<text x="0" y="0" fill="${fill}" font-size="${node.fontSize}"${withTransform}>${escapeXml(node.text)}</text>`;
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
  const pos = {
    x: node.transform[4] ?? 0,
    y: node.transform[5] ?? 0,
    w: opts?.viewBoxWidth ?? 200,
    h: opts?.viewBoxHeight ?? 160,
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
