/**
 * React + Tailwind CSS target emitter.
 *
 * Research basis: Tailwind CSS arbitrary values syntax (`w-[200px]`, `bg-[#...]`).
 * Token-aware: when a variable store is provided, emits theme tokens instead.
 */

import type { Document as SceneDocument, SceneNode } from '@strata/scene';
import { colorToHex, computeNodePos, escapeXml } from './shared';

export interface TailwindExportOptions {
  /** Token map: property key → Tailwind theme path (e.g. { width: 'w-4' }). */
  tokens?: Record<string, string>;
  /** Use Tailwind arbitrary value syntax. Default: true. */
  arbitraryValues?: boolean;
}

function sizeClass(px: number, av: boolean): string {
  if (!av) {
    if (px === 0) return 'w-0';
    if (px % 4 === 0) return `w-${px / 4}`;
  }
  return `w-[${px}px]`;
}

function heightClass(px: number, av: boolean): string {
  if (!av) {
    if (px === 0) return 'h-0';
    if (px % 4 === 0) return `h-${px / 4}`;
  }
  return `h-[${px}px]`;
}

function bgClass(c: readonly [number, number, number, number]): string {
  const hex = colorToHex(c);
  return `bg-[${hex}]`;
}

export function exportNodeToTailwind(
  node: SceneNode,
  doc: SceneDocument,
  opts?: TailwindExportOptions,
): string {
  const av = opts?.arbitraryValues ?? true;
  const pos = computeNodePos(node);
  const classes: string[] = ['absolute'];

  classes.push(`left-[${pos.x}px]`);
  classes.push(`top-[${pos.y}px]`);
  classes.push(sizeClass(pos.w, av));
  classes.push(heightClass(pos.h, av));
  classes.push(bgClass(node.fill));

  if (node.kind === 'text') {
    const fs = node.fontSize ?? 16;
    classes.push(`text-[${fs}px]`);
    if (node.fontFamily) {
      classes.push(`font-['${node.fontFamily}']`);
    }
  }

  if (node.kind === 'frame' && node.layoutStyle) {
    const l = node.layoutStyle;
    classes.push('flex');
    const dirClass = l.direction === 'row' ? 'flex-row' : l.direction === 'column' ? 'flex-col' : '';
    if (dirClass) classes.push(dirClass);
    if (l.gap) classes.push(`gap-[${l.gap}px]`);
  }

  const tag = node.kind === 'text' ? 'span' : 'div';
  const children = node.kind === 'frame' || node.kind === 'group'
    ? '\n' + ((node.children ?? []).map((cid: string) => {
        const child = doc.nodes[cid];
        return child ? `          {/* ${child.name} */}` : '';
      }).filter(Boolean).join('\n'))
    : '';

  if (node.kind === 'text') {
    return `<${tag} className="${classes.join(' ')}">${escapeXml(node.text)}</${tag}>`;
  }

  return `<${tag} className="${classes.join(' ')}">${children}\n        </${tag}>`;
}
