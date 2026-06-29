/**
 * @strata/codegen — Scene → code export (Strata plan §3.3, task 0.10).
 *
 * Exports the scene model to SVG markup, React Tailwind JSX, and later Flutter,
 * SwiftUI, and .fig/.AI parsers.
 */
import type { Affine, Color } from '@strata/engine';
import type { Document, NodeId, SceneNode } from '@strata/scene';

export * from './spec';

export const PACKAGE = '@strata/codegen' as const;

function rgba(c: Color): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
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

function shapeVerticesToPoints(s: { kind: string } & Record<string, unknown>): string {
  if (s.kind === 'polygon') {
    const cx = Number(s.cx),
      cy = Number(s.cy),
      radius = Number(s.radius),
      sides = Number(s.sides),
      rotation = Number(s.rotation);
    const pts: string[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides - Math.PI / 2 + rotation;
      pts.push(`${cx + radius * Math.cos(a)},${cy + radius * Math.sin(a)}`);
    }
    return pts.join(' ');
  }
  if (s.kind === 'star') {
    const cx = Number(s.cx),
      cy = Number(s.cy),
      ir = Number(s.innerRadius),
      or = Number(s.outerRadius),
      points = Number(s.points),
      rotation = Number(s.rotation);
    const pts: string[] = [];
    for (let i = 0; i < points * 2; i++) {
      const a = (Math.PI * i) / points - Math.PI / 2 + rotation;
      const r = i % 2 === 0 ? or : ir;
      pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
    }
    return pts.join(' ');
  }
  return '';
}

function nodeToSvg(node: SceneNode, doc: Document, depth: number): string {
  const indent = '  '.repeat(depth);
  const fill = rgba(node.fill);
  const transform = affineToSvg(node.transform);

  switch (node.kind) {
    case 'shape': {
      const s = node.shape;
      switch (s.kind) {
        case 'rect':
          return `${indent}<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fill}" transform="${transform}" />`;
        case 'ellipse':
          return `${indent}<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${fill}" transform="${transform}" />`;
        case 'circle':
          return `${indent}<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fill}" transform="${transform}" />`;
        case 'line':
          return `${indent}<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}" stroke="${fill}" stroke-width="${s.tolerance * 2}" stroke-linecap="round" transform="${transform}" />`;
        case 'polygon':
          return `${indent}<polygon points="${shapeVerticesToPoints(s)}" fill="${fill}" transform="${transform}" />`;
        case 'star':
          return `${indent}<polygon points="${shapeVerticesToPoints(s)}" fill="${fill}" transform="${transform}" />`;
      }
      break;
    }
    case 'text':
      return `${indent}<text x="0" y="0" fill="${fill}" font-size="${node.fontSize}" transform="${transform}">${escapeXml(node.text)}</text>`;
    case 'frame': {
      const children = (node.children ?? [])
        .map((cid: NodeId) => {
          const child = doc.nodes[cid];
          return child ? nodeToSvg(child, doc, depth + 1) : '';
        })
        .join('\n');
      return `${indent}<g transform="${transform}">\n${children}\n${indent}</g>`;
    }
    default:
      return '';
  }
}

/** Export a Document to a standalone SVG string. */
export function exportDocumentToSvg(doc: Document): string {
  const children = doc.rootChildren
    .map((id: NodeId) => {
      const node = doc.nodes[id];
      return node ? nodeToSvg(node, doc, 2) : '';
    })
    .join('\n');

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">`,
    `  <rect width="100%" height="100%" fill="#ffffff" />`,
    children,
    `</svg>`,
    '',
  ].join('\n');
}

/** Export a Document to React/Tailwind JSX. */
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
              return `        <polygon points="${shapeVerticesToPoints(s)}" fill="${fill}" style={{ transform: "${t}" }} />`;
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
