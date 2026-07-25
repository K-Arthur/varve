/**
 * Svelte component target emitter.
 *
 * Produces `.svelte` files with semantic HTML, scoped CSS, and
 * responsive layout primitives. Uses the shared intermediate
 * representation for full design fidelity.
 *
 * Research basis: Svelte 5 (runes) + Svelte 4 (legacy) compatibility.
 */

import type { Document as SceneDocument, SceneNode, VariableStore } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import {
  adjustmentStackTargetGaps,
  colorToHex,
  computeNodePos,
  escapeXml,
  getChildren,
} from './shared';
import { resolveTokenName } from './tokens';
import type { TargetGap } from './types';

export interface SvelteExportOptions {
  componentName?: string;
  variableStore?: VariableStore;
  useRunes?: boolean;
  includeTypes?: boolean;
}

function cssColor(node: SceneNode, opts?: SvelteExportOptions): string {
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) return `var(--${tokenName})`;
  return colorToHex(node.fill);
}

function cssBg(node: SceneNode, opts?: SvelteExportOptions): string {
  const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
  if (imgFill?.image) {
    return `background-image: url('${imgFill.image.src}'); background-size: ${imgFill.image.fit === 'fill' ? 'cover' : imgFill.image.fit === 'fit' ? 'contain' : 'auto'}; background-position: center; background-repeat: no-repeat;`;
  }
  return `background: ${cssColor(node, opts)};`;
}

function toSvelteClass(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
}

function buildTemplate(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: SvelteExportOptions,
): string {
  const indent = '  '.repeat(depth);
  const pos = computeNodePos(node);
  const cls = toSvelteClass(node.name);

  if (isImageShape(node)) {
    const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
    const src = imgFill?.image?.src ? escapeXml(imgFill.image.src) : '';
    return `${indent}<img src="${src}" alt="${node.name}" class="${cls}" style="position: absolute; left: ${pos.x}px; top: ${pos.y}px; width: ${pos.w}px; height: ${pos.h}px; object-fit: cover;" />`;
  }

  if (node.kind === 'text') {
    const tn = node as import('@strata/scene').TextNode;
    const styles = [
      `position: absolute`,
      `left: ${pos.x}px`,
      `top: ${pos.y}px`,
      `font-size: ${tn.fontSize ?? 16}px`,
    ];
    if (tn.fontFamily) styles.push(`font-family: '${tn.fontFamily}'`);
    styles.push(`color: ${cssColor(node, opts)}`);
    return `${indent}<span class="${cls}" style="${styles.join('; ')}">${escapeXml(tn.text ?? '')}</span>`;
  }

  if (
    (node.kind === 'frame' || node.kind === 'group') &&
    (node as import('@strata/scene').FrameNode).layoutStyle
  ) {
    const ls = (node as import('@strata/scene').FrameNode).layoutStyle!;
    const children = getChildren(doc, node)
      .map((child) => buildTemplate(child, doc, depth + 1, opts))
      .join('\n');
    const styles = [
      `position: absolute`,
      `left: ${pos.x}px`,
      `top: ${pos.y}px`,
      `width: ${pos.w}px`,
      `height: ${pos.h}px`,
      `display: flex`,
      `flex-direction: ${ls.direction}`,
    ];
    if (ls.gap) styles.push(`gap: ${ls.gap}px`);
    if (ls.padding.some((p: number) => p !== 0)) {
      styles.push(`padding: ${ls.padding.map((p: number) => `${p}px`).join(' ')}`);
    }
    styles.push(cssBg(node, opts));
    return `${indent}<div class="${cls}" style="${styles.join('; ')}">\n${children}\n${indent}</div>`;
  }

  if (node.kind === 'frame' || node.kind === 'group') {
    const children = getChildren(doc, node)
      .map((child) => buildTemplate(child, doc, depth + 1, opts))
      .join('\n');
    const styles = [
      `position: absolute`,
      `left: ${pos.x}px`,
      `top: ${pos.y}px`,
      `width: ${pos.w}px`,
      `height: ${pos.h}px`,
      cssBg(node, opts),
    ];
    if (children) {
      return `${indent}<div class="${cls}" style="${styles.join('; ')}">\n${children}\n${indent}</div>`;
    }
    return `${indent}<div class="${cls}" style="${styles.join('; ')}"></div>`;
  }

  const styles = [
    `position: absolute`,
    `left: ${pos.x}px`,
    `top: ${pos.y}px`,
    `width: ${pos.w}px`,
    `height: ${pos.h}px`,
    cssBg(node, opts),
  ];
  if (node.kind === 'shape') {
    const s = node.shape;
    if (s.kind === 'rect' && 'cornerRadius' in s) {
      const r =
        typeof s.cornerRadius === 'number'
          ? s.cornerRadius
          : ((s.cornerRadius as number[])?.[0] ?? 0);
      if (r > 0) styles.push(`border-radius: ${r}px`);
    }
  }
  return `${indent}<div class="${cls}" style="${styles.join('; ')}"></div>`;
}

export function exportNodeToSvelte(
  node: SceneNode,
  doc: SceneDocument,
  opts?: SvelteExportOptions,
): string {
  const name =
    opts?.componentName ?? (node.name[0]?.toUpperCase() + node.name.slice(1) || 'Component');
  const template = buildTemplate(node, doc, 0, opts);

  const parts: string[] = [];

  // Script section
  if (opts?.useRunes !== false) {
    parts.push(`<script lang="ts">`);
    parts.push(`  // Generated by @strata/codegen svelte emitter`);
    parts.push(`  let { class: className, ...rest }: { class?: string } = $props();`);
    parts.push(`</script>`);
  } else {
    parts.push(`<script lang="ts">`);
    parts.push(`  // Generated by @strata/codegen svelte emitter`);
    parts.push(`  export let className: string = '';`);
    parts.push(`</script>`);
  }
  parts.push('');

  // Template
  parts.push(`<div class="${name.toLowerCase()}">`);
  parts.push(template);
  parts.push(`</div>`);
  parts.push('');

  // Styles
  parts.push(`<style>`);
  parts.push(`  .${name.toLowerCase()} {`);
  parts.push(`    position: relative;`);
  parts.push(`    width: 100%;`);
  parts.push(`    height: 100%;`);
  parts.push(`    overflow: hidden;`);
  parts.push(`  }`);
  parts.push(`</style>`);

  return parts.join('\n');
}

export function svelteTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback: 'Use <img> tag',
    });
  }
  if (node.kind === 'shape' && node.shape.kind !== 'rect') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `non-rectangular shape (${node.shape.kind})`,
      severity: 'warning',
      fallback: 'Use inline SVG or clip-path',
    });
  }
  const fills = node.fills ?? [];
  if (fills.some((f) => f.type === 'gradient')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'gradient fill',
      severity: 'warning',
      fallback: 'Use background: linear-gradient(...)',
    });
  }

  return gaps;
}
