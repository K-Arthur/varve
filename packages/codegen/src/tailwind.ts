/**
 * React + Tailwind CSS target emitter.
 *
 * Research basis: Tailwind CSS arbitrary values syntax (`w-[200px]`, `bg-[#...]`).
 * Token-aware: when a variable store is provided, emits theme tokens instead.
 */

import type {
  ManagedColor,
  Document as SceneDocument,
  SceneNode,
  VariableStore,
} from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { adjustmentStackTargetGaps, colorToHex, computeNodePos, escapeXml } from './shared';
import { resolveTokenName } from './tokens';
import type { TargetGap } from './types';

export interface TailwindExportOptions {
  /** Token map: property key → Tailwind theme path (e.g. { width: 'w-4' }). */
  tokens?: Record<string, string>;
  /** Use Tailwind arbitrary value syntax. Default: true. */
  arbitraryValues?: boolean;
  /** Variable store for resolving token bindings. */
  variableStore?: VariableStore;
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

function bgClass(c: ManagedColor, node: SceneNode, opts?: TailwindExportOptions): string {
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) return `bg-[--${tokenName}]`;
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
  classes.push(bgClass(node.fill, node, opts));

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
    const dirClass =
      l.direction === 'row' ? 'flex-row' : l.direction === 'column' ? 'flex-col' : '';
    if (dirClass) classes.push(dirClass);
    if (l.gap) classes.push(`gap-[${l.gap}px]`);
  }

  const tag = node.kind === 'text' ? 'span' : 'div';
  const children =
    node.kind === 'frame' || node.kind === 'group'
      ? `\n${(node.children ?? [])
          .map((cid: string) => {
            const child = doc.nodes[cid];
            return child ? `          {/* ${child.name} */}` : '';
          })
          .filter(Boolean)
          .join('\n')}`
      : '';

  if (node.kind === 'text') {
    return `<${tag} className="${classes.join(' ')}">${escapeXml(node.text)}</${tag}>`;
  }

  return `<${tag} className="${classes.join(' ')}">${children}\n        </${tag}>`;
}

/**
 * Report features used by `node` that Tailwind CSS cannot faithfully represent.
 *
 * Checks: non-rectangular shapes (need SVG), gradient fills, image nodes,
 * and effects (shadows, blurs) that require manual Tailwind extension config.
 */
export function tailwindTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback: 'Use <img> or bg-[url(...)] with a Tailwind arbitrary value',
    });
  }

  if (node.kind === 'shape') {
    const shapeKind = node.shape.kind;
    if (shapeKind !== 'rect') {
      gaps.push({
        nodeId: node.id,
        nodeName: node.name,
        feature: `non-rectangular shape (${shapeKind})`,
        severity: 'warning',
        fallback: 'Wrap in an <svg> element or use an inline SVG component',
      });
    }
  }

  const fills = node.fills ?? [];
  if (fills.some((f) => f.type === 'gradient')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'gradient fill',
      severity: 'warning',
      fallback: 'Use bg-gradient-to-r or a custom CSS class with the gradient value',
    });
  }

  if (fills.some((f) => f.type === 'image')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image fill',
      severity: 'warning',
      fallback: 'Use bg-[url(...)] with an arbitrary value or an <img> tag',
    });
  }

  const effects =
    node.kind === 'shape' || node.kind === 'text' || node.kind === 'frame' || node.kind === 'group'
      ? (node.effects ?? [])
      : [];
  if (effects.some((e) => e.type === 'layerBlur' || e.type === 'backgroundBlur')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'blur effect',
      severity: 'warning',
      fallback: 'Use blur-* or backdrop-blur-* Tailwind classes',
    });
  }

  return gaps;
}
