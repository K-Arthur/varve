/**
 * Web Component target emitter.
 *
 * Produces native custom elements using the Custom Elements v1 spec
 * with Shadow DOM, HTML templates, and constructable stylesheets.
 * Framework-agnostic — works in any modern browser.
 *
 * Research basis: Custom Elements v1, Shadow DOM, HTMLTemplateElement,
 * CSSStyleSheet (constructable stylesheets).
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

export interface WebComponentExportOptions {
  elementName?: string;
  variableStore?: VariableStore;
  useShadowDom?: boolean;
  includeModuleWrapper?: boolean;
}

function cssColor(node: SceneNode, opts?: WebComponentExportOptions): string {
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) return `var(--${tokenName})`;
  return colorToHex(node.fill);
}

function cssBg(node: SceneNode, opts?: WebComponentExportOptions): string {
  const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
  if (imgFill?.image) {
    return `background-image: url('${imgFill.image.src}'); background-size: ${imgFill.image.fit === 'fill' ? 'cover' : imgFill.image.fit === 'fit' ? 'contain' : 'auto'}; background-position: center; background-repeat: no-repeat;`;
  }
  return `background: ${cssColor(node, opts)};`;
}

function toAttrClass(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
}

function buildTemplateHTML(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: WebComponentExportOptions,
): string {
  const indent = '  '.repeat(depth);
  const cls = toAttrClass(node.name);

  if (isImageShape(node)) {
    const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
    const src = imgFill?.image?.src ? escapeXml(imgFill.image.src) : '';
    return `${indent}<img src="${src}" alt="${node.name}" class="${cls}" part="${cls}" />`;
  }

  if (node.kind === 'text') {
    const tn = node as import('@strata/scene').TextNode;
    return `${indent}<span class="${cls}" part="${cls}">${escapeXml(tn.text ?? '')}</span>`;
  }

  if (
    (node.kind === 'frame' || node.kind === 'group') &&
    (node as import('@strata/scene').FrameNode).layoutStyle
  ) {
    const children = getChildren(doc, node)
      .map((child) => buildTemplateHTML(child, doc, depth + 1, opts))
      .join('\n');
    return `${indent}<div class="${cls}" part="${cls}">\n${children}\n${indent}</div>`;
  }

  if (node.kind === 'frame' || node.kind === 'group') {
    const children = getChildren(doc, node)
      .map((child) => buildTemplateHTML(child, doc, depth + 1, opts))
      .join('\n');
    if (children) {
      return `${indent}<div class="${cls}" part="${cls}">\n${children}\n${indent}</div>`;
    }
    return `${indent}<div class="${cls}" part="${cls}"></div>`;
  }

  return `${indent}<div class="${cls}" part="${cls}"></div>`;
}

function buildStylesCSS(
  node: SceneNode,
  doc: SceneDocument,
  _name: string,
  _opts?: WebComponentExportOptions,
): string[] {
  const lines: string[] = [];
  const pos = computeNodePos(node);
  const cls = toAttrClass(node.name);
  const selector = `.${cls}`;

  if (isImageShape(node)) {
    lines.push(
      `${selector} { position: absolute; left: ${pos.x}px; top: ${pos.y}px; width: ${pos.w}px; height: ${pos.h}px; object-fit: cover; }`,
    );
    return lines;
  }

  if (node.kind === 'text') {
    const tn = node as import('@strata/scene').TextNode;
    lines.push(
      `${selector} { position: absolute; left: ${pos.x}px; top: ${pos.y}px; font-size: ${tn.fontSize ?? 16}px;${tn.fontFamily ? ` font-family: '${tn.fontFamily}';` : ''} color: #000; }`,
    );
    return lines;
  }

  if (node.kind === 'frame' || node.kind === 'group') {
    const fn = node as import('@strata/scene').FrameNode;
    const styles = [
      `position: absolute`,
      `left: ${pos.x}px`,
      `top: ${pos.y}px`,
      `width: ${pos.w}px`,
      `height: ${pos.h}px`,
    ];
    if (fn.layoutStyle) {
      styles.push(`display: flex`, `flex-direction: ${fn.layoutStyle.direction}`);
      if (fn.layoutStyle.gap) styles.push(`gap: ${fn.layoutStyle.gap}px`);
      if (fn.layoutStyle.padding.some((p: number) => p !== 0)) {
        styles.push(`padding: ${fn.layoutStyle.padding.map((p: number) => `${p}px`).join(' ')}`);
      }
    }
    styles.push(cssBg(node, _opts));
    lines.push(`${selector} { ${styles.join('; ')} }`);
  } else {
    const styles = [
      `position: absolute`,
      `left: ${pos.x}px`,
      `top: ${pos.y}px`,
      `width: ${pos.w}px`,
      `height: ${pos.h}px`,
      cssBg(node, _opts),
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
    lines.push(`${selector} { ${styles.join('; ')} }`);
  }

  if (node.kind === 'frame' || node.kind === 'group') {
    const children = getChildren(doc, node);
    for (const child of children) {
      lines.push(...buildStylesCSS(child, doc, _name, _opts));
    }
  }

  return lines;
}

export function exportNodeToWebComponent(
  node: SceneNode,
  doc: SceneDocument,
  opts?: WebComponentExportOptions,
): string {
  const elementName = opts?.elementName ?? `strata-${toAttrClass(node.name)}`;
  const name = node.name[0]?.toUpperCase() + node.name.slice(1) || 'Component';
  const useShadow = opts?.useShadowDom !== false;

  const templateHTML = buildTemplateHTML(node, doc, 4, opts);
  const styles = buildStylesCSS(node, doc, name, opts);

  const parts: string[] = [];

  if (opts?.includeModuleWrapper !== false) {
    parts.push(`// Generated by @strata/codegen web-component emitter`);
    parts.push(`// Custom Element: <${elementName}>`);
    parts.push('');
    parts.push(`const template = document.createElement('template');`);
    parts.push(`template.innerHTML = \``);
    parts.push(`  <style>`);
    parts.push(`    :host {`);
    parts.push(`      display: block;`);
    parts.push(`      position: relative;`);
    parts.push(`      width: 100%;`);
    parts.push(`      height: 100%;`);
    parts.push(`      overflow: hidden;`);
    parts.push(`    }`);
    parts.push(...styles.map((s) => `    ${s}`));
    parts.push(`  </style>`);
    parts.push(templateHTML);
    parts.push(`\`;`);
    parts.push('');
    parts.push(`class ${name} extends HTMLElement {`);
    parts.push(`  constructor() {`);
    parts.push(`    super();`);
    if (useShadow) {
      parts.push(`    this.attachShadow({ mode: 'open' });`);
      parts.push(`    this.shadowRoot!.appendChild(template.content.cloneNode(true));`);
    } else {
      parts.push(`    this.appendChild(template.content.cloneNode(true));`);
    }
    parts.push(`  }`);
    parts.push(`}`);
    parts.push('');
    parts.push(`customElements.define('${elementName}', ${name});`);
    parts.push('');
    parts.push(`export default ${name};`);
  }

  return parts.join('\n');
}

export function webComponentTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback: 'Use <img> tag in template',
    });
  }
  if (node.kind === 'shape' && node.shape.kind !== 'rect') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `non-rectangular shape (${node.shape.kind})`,
      severity: 'warning',
      fallback: 'Use inline SVG',
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
