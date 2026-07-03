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
      }
      break;
    }
    case 'text': {
      const attrs: string[] = [
        `x="0"`,
        `y="0"`,
        `fill="${fillAttr}"`,
        `font-size="${node.fontSize}"`,
      ];
      if (node.fontFamily) attrs.push(`font-family="${escapeXml(node.fontFamily)}"`);
      if (node.fontWeight) attrs.push(`font-weight="${node.fontWeight}"`);
      if (node.fontStyle === 'italic') attrs.push(`font-style="italic"`);
      if (node.textAlign)
        attrs.push(
          `text-anchor="${node.textAlign === 'center' ? 'middle' : node.textAlign === 'right' ? 'end' : 'start'}"`,
        );
      if (node.letterSpacing) attrs.push(`letter-spacing="${node.letterSpacing}"`);
      if (node.lineHeight) attrs.push(`line-height="${node.lineHeight}"`);
      if (node.textDecoration && node.textDecoration !== 'none') {
        attrs.push(`text-decoration="${node.textDecoration}"`);
      }
      const t = affineToSvg(transform);
      const withTransform = ` transform="${t}"`;
      let content = escapeXml(node.text);
      if (node.textCase === 'uppercase') content = content.toUpperCase();
      else if (node.textCase === 'lowercase') content = content.toLowerCase();
      return `${indent}<text ${attrs.join(' ')}${withTransform}>${content}</text>`;
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
