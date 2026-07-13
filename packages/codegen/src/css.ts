/**
 * CSS class-based target emitter.
 *
 * Research basis: CSS Properties and Values API; custom property naming conventions.
 */

import type {
  ManagedColor,
  Document as SceneDocument,
  SceneNode,
  VariableStore,
} from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { adjustmentStackTargetGaps, colorToHex, computeNodePos, rgba } from './shared';
import { resolveTokenName } from './tokens';
import type { TargetGap } from './types';

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

function formatColor(c: ManagedColor, format: 'hex' | 'rgb'): string {
  return format === 'hex' ? colorToHex(c) : rgba(c);
}

function formatSize(px: number, unit: 'px' | 'rem', base: number): string {
  return unit === 'rem' ? `${px / base}rem` : `${px}px`;
}

function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, '\\a ');
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

  // Image fill: emit background-image for image-filled shapes.
  const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
  if (imgFill?.image) {
    lines.push(`  background-image: url("${escapeCssString(imgFill.image.src)}");`);
    lines.push(
      imgFill.image.fit === 'fill'
        ? '  background-size: cover;'
        : imgFill.image.fit === 'fit'
          ? '  background-size: contain;'
          : imgFill.image.fit === 'stretch'
            ? '  background-size: 100% 100%;'
            : '  background-size: auto;',
    );
    lines.push(
      imgFill.image.fit === 'tile'
        ? '  background-repeat: repeat;'
        : '  background-repeat: no-repeat;',
    );
    lines.push('  background-position: center;');
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

/**
 * Report features used by `node` that plain CSS classes cannot represent.
 *
 * Checks: non-rectangular shapes (need SVG), gradient fills needing complex
 * CSS syntax, image fills requiring a URL source, and blur effects.
 */
export function cssTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback: 'Use background-image with a URL or an <img> tag',
    });
  }

  if (node.kind === 'shape' && node.shape.kind !== 'rect') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `non-rectangular shape (${node.shape.kind})`,
      severity: 'warning',
      fallback: 'Use clip-path or an inline SVG element',
    });
  }

  const fills = node.fills ?? [];
  if (fills.some((f) => f.type === 'gradient')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'gradient fill',
      severity: 'warning',
      fallback: 'Use background: linear-gradient(...) or conic-gradient(...)',
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
      fallback: 'Use backdrop-filter: blur(...) with browser prefix if needed',
    });
  }

  return gaps;
}
