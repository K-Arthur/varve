/**
 * Vue single-file component target emitter.
 *
 * Produces `.vue` SFCs with semantic HTML, scoped CSS, and responsive layout.
 * Uses the shared intermediate representation for full design fidelity.
 *
 * Research basis: Vue 3 SFC spec, Vue Style Guide.
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

export interface VueExportOptions {
  componentName?: string;
  variableStore?: VariableStore;
  useScopedStyles?: boolean;
  includeScript?: boolean;
  useCompositionApi?: boolean;
}

function _sizeClass(px: number): string {
  return px === 0 ? '0' : `${px}px`;
}

function cssColor(node: SceneNode, opts?: VueExportOptions): string {
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) return `var(--${tokenName})`;
  return colorToHex(node.fill);
}

function cssBg(node: SceneNode, opts?: VueExportOptions): string {
  const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
  if (imgFill?.image) {
    return `background-image: url('${imgFill.image.src}'); background-size: ${imgFill.image.fit === 'fill' ? 'cover' : imgFill.image.fit === 'fit' ? 'contain' : 'auto'}; background-position: center; background-repeat: no-repeat;`;
  }
  return `background: ${cssColor(node, opts)};`;
}

function buildVueTemplate(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: VueExportOptions,
): string {
  const indent = '  '.repeat(depth);
  const _pos = computeNodePos(node);

  // Image node
  if (isImageShape(node)) {
    const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
    const img = imgFill?.image;
    const alt = node.name;
    const src = img?.src ? escapeXml(img.src) : '';
    return `${indent}<img src="${src}" alt="${alt}" class="${node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}" />`;
  }

  // Text node
  if (node.kind === 'text') {
    const tn = node as import('@strata/scene').TextNode;
    const classes = [`text-${node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`];
    return `${indent}<span class="${classes.join(' ')}">${escapeXml(tn.text ?? '')}</span>`;
  }

  // Frame/group with auto-layout
  if (
    (node.kind === 'frame' || node.kind === 'group') &&
    (node as import('@strata/scene').FrameNode).layoutStyle
  ) {
    const fn = node as import('@strata/scene').FrameNode;
    const _ls = fn.layoutStyle!;
    const classes = [`container-${node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`];
    const children = getChildren(doc, node)
      .map((child) => buildVueTemplate(child, doc, depth + 1, opts))
      .join('\n');
    return `${indent}<div class="${classes.join(' ')}">\n${children}\n${indent}</div>`;
  }

  // Frame/group without auto-layout
  if (node.kind === 'frame' || node.kind === 'group') {
    const classes = [`container-${node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`];
    const children = getChildren(doc, node)
      .map((child) => buildVueTemplate(child, doc, depth + 1, opts))
      .join('\n');
    if (children) {
      return `${indent}<div class="${classes.join(' ')}">\n${children}\n${indent}</div>`;
    }
    return `${indent}<div class="${classes.join(' ')}"></div>`;
  }

  // Shape
  const classes = [`shape-${node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`];
  return `${indent}<div class="${classes.join(' ')}"></div>`;
}

function buildVueStyle(node: SceneNode, doc: SceneDocument, opts?: VueExportOptions): string[] {
  const lines: string[] = [];
  const pos = computeNodePos(node);
  const bg = cssBg(node, opts);

  // Image
  if (isImageShape(node)) {
    const selector = `.${node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    lines.push(`${selector} {`);
    lines.push(`  position: absolute;`);
    lines.push(`  left: ${pos.x}px;`);
    lines.push(`  top: ${pos.y}px;`);
    lines.push(`  width: ${pos.w}px;`);
    lines.push(`  height: ${pos.h}px;`);
    lines.push(`  object-fit: cover;`);
    lines.push(`}`);
    return lines;
  }

  // Text
  if (node.kind === 'text') {
    const tn = node as import('@strata/scene').TextNode;
    const selector = `.text-${node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    lines.push(`${selector} {`);
    lines.push(`  position: absolute;`);
    lines.push(`  left: ${pos.x}px;`);
    lines.push(`  top: ${pos.y}px;`);
    lines.push(`  width: ${pos.w}px;`);
    lines.push(`  height: ${pos.h}px;`);
    lines.push(`  font-size: ${tn.fontSize ?? 16}px;`);
    if (tn.fontFamily) lines.push(`  font-family: '${tn.fontFamily}';`);
    lines.push(`  color: ${cssColor(node, opts)};`);
    lines.push(`}`);
    return lines;
  }

  // Container with auto-layout
  if (
    (node.kind === 'frame' || node.kind === 'group') &&
    (node as import('@strata/scene').FrameNode).layoutStyle
  ) {
    const fn = node as import('@strata/scene').FrameNode;
    const ls = fn.layoutStyle!;
    const selector = `.container-${node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    lines.push(`${selector} {`);
    lines.push(`  position: absolute;`);
    lines.push(`  left: ${pos.x}px;`);
    lines.push(`  top: ${pos.y}px;`);
    lines.push(`  width: ${pos.w}px;`);
    lines.push(`  height: ${pos.h}px;`);
    lines.push(`  display: flex;`);
    lines.push(`  flex-direction: ${ls.direction};`);
    if (ls.gap) lines.push(`  gap: ${ls.gap}px;`);
    if (ls.padding.some((p: number) => p !== 0)) {
      lines.push(`  padding: ${ls.padding.map((p: number) => `${p}px`).join(' ')};`);
    }
    lines.push(`  background: ${cssColor(node, opts)};`);
    lines.push(`}`);
    return lines;
  }

  // Container
  if (node.kind === 'frame' || node.kind === 'group') {
    const selector = `.container-${node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    lines.push(`${selector} {`);
    lines.push(`  position: absolute;`);
    lines.push(`  left: ${pos.x}px;`);
    lines.push(`  top: ${pos.y}px;`);
    lines.push(`  width: ${pos.w}px;`);
    lines.push(`  height: ${pos.h}px;`);
    lines.push(`  ${bg}`);
    lines.push(`}`);
    return lines;
  }

  // Shape
  const selector = `.shape-${node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
  lines.push(`${selector} {`);
  lines.push(`  position: absolute;`);
  lines.push(`  left: ${pos.x}px;`);
  lines.push(`  top: ${pos.y}px;`);
  lines.push(`  width: ${pos.w}px;`);
  lines.push(`  height: ${pos.h}px;`);
  lines.push(`  ${bg}`);
  if (node.kind === 'shape') {
    const s = node.shape;
    if (s.kind === 'rect' && 'cornerRadius' in s) {
      const r =
        typeof s.cornerRadius === 'number'
          ? s.cornerRadius
          : ((s.cornerRadius as number[])?.[0] ?? 0);
      if (r > 0) lines.push(`  border-radius: ${r}px;`);
    }
  }
  lines.push(`}`);

  // Recurse into children
  if (node.kind === 'frame' || node.kind === 'group') {
    const children = getChildren(doc, node);
    for (const child of children) {
      lines.push(...buildVueStyle(child, doc, opts));
    }
  }

  return lines;
}

export function exportNodeToVue(
  node: SceneNode,
  doc: SceneDocument,
  opts?: VueExportOptions,
): string {
  const name =
    opts?.componentName || node.name[0]?.toUpperCase() + node.name.slice(1) || 'Component';
  const scoped = opts?.useScopedStyles !== false;
  const scopedAttr = scoped ? ' scoped' : '';

  const template = buildVueTemplate(node, doc, 1, opts);
  const styles = buildVueStyle(node, doc, opts);

  const parts: string[] = [];

  if (opts?.includeScript !== false) {
    if (opts?.useCompositionApi !== false) {
      parts.push(`<script setup lang="ts">`);
      parts.push(`// Generated by @strata/codegen vue emitter`);
      parts.push(`</script>`);
    } else {
      parts.push(`<script lang="ts">`);
      parts.push(`import { defineComponent } from 'vue';`);
      parts.push('');
      parts.push(`export default defineComponent({`);
      parts.push(`  name: '${name}',`);
      parts.push(`});`);
      parts.push(`</script>`);
    }
    parts.push('');
  }

  parts.push(`<template>`);
  parts.push(`  <div class="${name.toLowerCase()}-wrapper">`);
  parts.push(template);
  parts.push(`  </div>`);
  parts.push(`</template>`);
  parts.push('');

  parts.push(`<style${scopedAttr}>`);
  parts.push(`.${name.toLowerCase()}-wrapper {`);
  parts.push(`  position: relative;`);
  parts.push(`  width: 100%;`);
  parts.push(`  height: 100%;`);
  parts.push(`  overflow: hidden;`);
  parts.push(`}`);
  parts.push('');
  parts.push(styles.join('\n'));
  parts.push(`</style>`);

  return parts.join('\n');
}

export function vueTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback: 'Use <img> tag with :src binding',
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
      fallback: 'Use background: linear-gradient(...) in CSS',
    });
  }

  return gaps;
}
