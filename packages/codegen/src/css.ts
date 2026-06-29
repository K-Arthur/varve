/**
 * CSS class-based target emitter.
 *
 * Research basis: CSS Properties and Values API; custom property naming conventions.
 */

import type { Document as SceneDocument, SceneNode, VariableStore } from '@strata/scene';
import { colorToHex, computeNodePos, rgba } from './shared';
import { resolveTokenName } from './tokens';

export interface CssExportOptions {
  /** CSS class prefix. Default: node-name. */
  classPrefix?: string;
  /** Color format: 'hex' | 'rgb'. Default: 'hex'. */
  colorFormat?: 'hex' | 'rgb';
  /** Unit for dimensions. Default: 'px'. */
  unit?: 'px' | 'rem';
  /** Base font size for rem units. Default: 16. */
  baseFontSize?: number;
  /** Variable store for resolving token bindings. */
  variableStore?: VariableStore;
}

function formatColor(c: readonly [number, number, number, number], format: 'hex' | 'rgb'): string {
  return format === 'hex' ? colorToHex(c) : rgba(c);
}

function formatSize(px: number, unit: 'px' | 'rem', base: number): string {
  return unit === 'rem' ? `${px / base}rem` : `${px}px`;
}

function className(node: SceneNode, prefix?: string): string {
  const base = prefix ?? node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return base.startsWith('.') ? base : `.${base}`;
}

export function exportNodeToCss(
  node: SceneNode,
  _doc: SceneDocument,
  opts?: CssExportOptions,
): string {
  const colorFmt = opts?.colorFormat ?? 'hex';
  const unit = opts?.unit ?? 'px';
  const base = opts?.baseFontSize ?? 16;
  const selector = className(node, opts?.classPrefix);
  const pos = computeNodePos(node);
  const lines: string[] = [`${selector} {`];

  lines.push(`  position: absolute;`);
  lines.push(`  left: ${formatSize(pos.x, unit, base)};`);
  lines.push(`  top: ${formatSize(pos.y, unit, base)};`);
  lines.push(`  width: ${formatSize(pos.w, unit, base)};`);
  lines.push(`  height: ${formatSize(pos.h, unit, base)};`);
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) {
    lines.push(`  background: var(--${tokenName});`);
  } else {
    lines.push(`  background: ${formatColor(node.fill, colorFmt)};`);
  }

  if (node.kind === 'text') {
    lines.push(`  font-size: ${formatSize(node.fontSize ?? 16, unit, base)};`);
    if (node.fontFamily) lines.push(`  font-family: '${node.fontFamily}';`);
  }

  if (node.kind === 'shape') {
    const s = node.shape;
    if (s.kind === 'rect' && s.w !== undefined) {
      // corners via border-radius if they were set
    }
  }

  if (node.kind === 'frame' && node.layoutStyle) {
    const l = node.layoutStyle;
    lines.push(`  display: flex;`);
    lines.push(`  flex-direction: ${l.direction};`);
    if (l.gap) lines.push(`  gap: ${formatSize(l.gap, unit, base)};`);
    if (l.padding) {
      const pad = l.padding;
      if (pad[0] || pad[1] || pad[2] || pad[3]) {
        lines.push(
          `  padding: ${[pad[0], pad[1], pad[2], pad[3]].map((v) => formatSize(v, unit, base)).join(' ')};`,
        );
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}
