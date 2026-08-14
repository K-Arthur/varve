/**
 * React + Tailwind CSS emitter — v2.1.
 *
 * Enhanced: extracts repeated utility patterns into reusable components,
 * uses the DesignIR for semantic output, produces readable code.
 */

import type { Document, SceneNode, VariableStore } from '@varve/scene';
import { analyzeNodeFlattening } from './flattening';
import type { IRDocument, SemanticNode } from './ir-types';
import { resolveTokenName } from './tokens';
import type { RasterAsset, TargetGap } from './types';

export interface TailwindExportOptions {
  /** Pre-rasterized image assets keyed by sourceNodeId. */
  rasterAssets?: Record<string, RasterAsset>;
  /** Use Tailwind arbitrary value syntax. Default true. */
  arbitraryValues?: boolean;
  /** Base font size for rem. Default 16. */
  baseFontSize?: number;
  /** Extract repeated patterns into shared components. Default true. */
  extractComponents?: boolean;
  /** Variable store for token resolution. */
  variableStore?: VariableStore;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sizeTw(px: number, av: boolean, prefix = 'w'): string {
  if (!av) {
    if (px === 0) return `${prefix}-0`;
    if (px % 4 === 0) return `${prefix}-${px / 4}`;
  }
  return `${prefix}-[${px}px]`;
}

function sizeValue(px: number, base: number): string {
  return base > 0 ? `${(px / base).toFixed(3)}rem` : `${px}px`;
}

// ── Tailwind utility class builders ──────────────────────────────────────────

interface ClassBuilder {
  classes: string[];
  av: boolean;
  base: number;
}

function layoutClasses(node: SemanticNode, b: ClassBuilder) {
  const layout = node.layout;

  if (layout.mode === 'flex') {
    b.classes.push('flex');
    if (layout.direction === 'column' || layout.direction === 'column-reverse') {
      b.classes.push('flex-col');
    }
    if (layout.wrap) b.classes.push('flex-wrap');

    const ai = layout.alignItems;
    if (ai === 'center') b.classes.push('items-center');
    else if (ai === 'end') b.classes.push('items-end');
    else if (ai === 'stretch') b.classes.push('items-stretch');

    const jc = layout.justifyContent;
    if (jc === 'center') b.classes.push('justify-center');
    else if (jc === 'end') b.classes.push('justify-end');
    else if (jc === 'stretch') b.classes.push('justify-stretch');

    const gap = Math.max(
      layout.gap.left || 0,
      layout.gap.right || 0,
      layout.gap.top || 0,
      layout.gap.bottom || 0,
    );
    if (gap > 0) b.classes.push(sizeTw(gap, b.av, 'gap'));
  }

  if (layout.width.mode === 'fixed' && layout.width.value > 0) {
    b.classes.push(sizeTw(layout.width.value, b.av, 'w'));
  } else if (layout.width.mode === 'fill') {
    b.classes.push('w-full');
  } else if (layout.width.mode === 'hug') {
    b.classes.push('w-fit');
  }

  if (layout.height.mode === 'fixed' && layout.height.value > 0) {
    b.classes.push(sizeTw(layout.height.value, b.av, 'h'));
  } else if (layout.height.mode === 'fill') {
    b.classes.push('h-full');
  } else if (layout.height.mode === 'hug') {
    b.classes.push('h-fit');
  }

  const pad = layout.padding;
  if (pad.top || pad.left || pad.bottom || pad.right) {
    const p = [pad.top, pad.right, pad.bottom, pad.left] as const;
    if (p.every((v) => v === p[0]) && p[0] > 0) {
      b.classes.push(sizeTw(p[0], b.av, 'p'));
    }
  }

  const pos = layout.position;
  if (pos && pos.type === 'absolute') {
    b.classes.push('absolute');
    if (pos.left !== undefined) b.classes.push(sizeTw(pos.left, b.av, 'left'));
    if (pos.top !== undefined) b.classes.push(sizeTw(pos.top, b.av, 'top'));
    if (pos.right !== undefined) b.classes.push(sizeTw(pos.right, b.av, 'right'));
    if (pos.bottom !== undefined) b.classes.push(sizeTw(pos.bottom, b.av, 'bottom'));
  } else if (layout.mode !== 'flex') {
    b.classes.push('relative');
  }

  if (layout.flex) {
    const f = layout.flex;
    b.classes.push(`flex-[${f.grow}_${f.shrink}_${f.basis === 'auto' ? 'auto' : `${f.basis}px`}]`);
  }
}

function appearanceClasses(node: SemanticNode, b: ClassBuilder) {
  const app = node.appearance;
  const flattening = node.flattening;

  if (flattening?.mustFlatten && flattening.flattenedImageUrl) {
    b.classes.push('bg-center', 'bg-no-repeat', 'bg-contain');
    b.classes.push(`bg-[url("${escapeXml(flattening.flattenedImageUrl)}")]`);
    return;
  }

  if (app.background.length > 0) {
    const top = app.background[app.background.length - 1]!;
    if (top.type === 'solid') {
      b.classes.push(`bg-[${top.value}]`);
    } else if (top.type === 'gradient') {
      const g = top.gradient;
      if (g.type === 'linear') {
        b.classes.push(
          `bg-gradient-to-r from-[${g.stops[0]?.color || '#000'}] to-[${g.stops[g.stops.length - 1]?.color || '#fff'}]`,
        );
      }
    } else if (top.type === 'image') {
      b.classes.push(`bg-[url("${escapeXml(top.image.src)}")]`, 'bg-center', 'bg-cover');
    }
  }

  if (app.opacity !== 1) b.classes.push(`opacity-${Math.round(app.opacity * 100)}`);

  const br = app.borderRadius;
  if (br.topLeft || br.topRight || br.bottomRight || br.bottomLeft) {
    if (
      br.topLeft === br.topRight &&
      br.topLeft === br.bottomRight &&
      br.topLeft === br.bottomLeft
    ) {
      if (br.topLeft > 0) b.classes.push(sizeTw(br.topLeft, b.av, 'rounded'));
    }
  }

  const border = app.border.top;
  if (border.width > 0 && border.style !== 'none') {
    b.classes.push(`border-[${border.width}px]`, `border-[${border.color}]`, 'border-solid');
  }

  for (const effect of app.effects) {
    if (effect.type === 'drop-shadow') {
      b.classes.push(
        `shadow-[${effect.offsetX}px_${effect.offsetY}px_${effect.radius}px_${effect.color}]`,
      );
    }
    if (effect.type === 'layer-blur') {
      b.classes.push(`blur-[${effect.radius}px]`);
    }
    if (effect.type === 'background-blur') {
      b.classes.push(`backdrop-blur-[${effect.radius}px]`);
    }
  }

  if (app.transform.rotate !== 0) {
    b.classes.push(`rotate-[${app.transform.rotate}deg]`);
  }
}

function typographyClasses(node: SemanticNode, b: ClassBuilder) {
  const t = node.appearance.typography;

  if (t.fontSize > 0) {
    b.classes.push(`text-[${sizeValue(t.fontSize, b.base)}]`);
  }
  if (t.fontWeight !== 400) {
    b.classes.push(`font-[${t.fontWeight}]`);
  }
  if (t.fontFamily) {
    const font = t.fontFamily.includes(' ') ? `"${t.fontFamily}"` : t.fontFamily;
    b.classes.push(`font-['${font}']`);
  }
  if (t.letterSpacing !== 0) {
    b.classes.push(`tracking-[${sizeValue(t.letterSpacing, b.base)}]`);
  }
  if (t.lineHeight && t.lineHeight !== 1.4) {
    b.classes.push(`leading-[${t.lineHeight}]`);
  }
  if (t.textAlign && t.textAlign !== 'left') {
    b.classes.push(`text-${t.textAlign}`);
  }
  if (t.textTransform && t.textTransform !== 'none') {
    b.classes.push(
      t.textTransform === 'uppercase'
        ? 'uppercase'
        : t.textTransform === 'capitalize'
          ? 'capitalize'
          : 'lowercase',
    );
  }
  if (t.decoration && t.decoration !== 'none') {
    b.classes.push(t.decoration === 'underline' ? 'underline' : t.decoration);
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

/** Direct conversion for standalone nodes (not in doc.nodes). */
function resolveFillToken(
  node: import('@varve/scene').SceneNode,
  opts: TailwindExportOptions,
): string | undefined {
  const bindings = (node as { bindings?: Record<string, { variableId: string }> }).bindings;
  if (!bindings?.fill?.variableId || !opts.variableStore) return undefined;
  const store = opts.variableStore as { variables: Record<string, { name: string; type: string }> };
  const v = store.variables?.[bindings.fill.variableId];
  if (v) return v.name;
  return undefined;
}

function directNodeToTailwind(
  node: import('@varve/scene').SceneNode,
  opts: TailwindExportOptions,
): string {
  const av = opts.arbitraryValues ?? true;
  const base = opts.baseFontSize ?? 16;
  const classes: string[] = [];

  const tx = node.transform[4] ?? 0;
  const ty = node.transform[5] ?? 0;
  classes.push('absolute');
  classes.push(`left-[${tx}px]`);
  classes.push(`top-[${ty}px]`);
  // The separate rotation field is dropped by transform[4/5]-only position
  // reading; emit it explicitly. Rotation is about the node origin (0,0
  // local), which coincides with the element's top-left — the same
  // transform-origin the canvas renderer uses.
  const rot = node.rotation ?? 0;
  if (rot !== 0) {
    classes.push(`rotate-[${rot}deg]`);
    classes.push('origin-top-left');
  }

  let w = 100,
    h = 100;
  if (node.kind === 'shape' && node.shape.kind === 'rect') {
    w = node.shape.w;
    h = node.shape.h;
  } else if (node.kind === 'text') {
    const fs = node.fontSize ?? 16;
    w = (node.text?.length ?? 0) * fs * 0.6;
    h = fs * 1.4;
  } else if (node.kind === 'frame') {
    const fn = node as import('@varve/scene').FrameNode;
    w = fn.w ?? 200;
    h = fn.h ?? 160;
  }
  classes.push(sizeTw(w, av, 'w'));
  classes.push(sizeTw(h, av, 'h'));

  const tokenName = resolveFillToken(node, opts);
  if (tokenName) {
    classes.push(`bg-[--${tokenName}]`);
  } else if (node.fill) {
    const c = node.fill as import('@varve/scene').ManagedColor;
    if (c.space === 'rgb') {
      classes.push(
        `bg-[#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}]`,
      );
    }
  }

  if (node.kind === 'text') {
    const tn = node as import('@varve/scene').TextNode;
    const fs = tn.fontSize ?? 16;
    classes.push(`text-[${base > 0 ? `${fs / base}rem` : `${fs}px`}]`);
    if (tn.fontFamily) classes.push(`font-['${tn.fontFamily}']`);
  }

  const tag = node.kind === 'text' ? 'span' : 'div';
  const text =
    node.kind === 'text' ? escapeXml((node as import('@varve/scene').TextNode).text) : '';

  if (text) return `<${tag} className="${classes.join(' ')}">${text}</${tag}>`;
  return `<${tag} className="${classes.join(' ')}" />`;
}

export function sceneToTailwind(
  node: import('@varve/scene').SceneNode,
  doc: import('@varve/scene').Document,
  opts?: TailwindExportOptions,
): string {
  // Try IR-based conversion if node is in document
  try {
    const { sceneToIR } = require('./ir-converter') as {
      sceneToIR: (doc: import('@varve/scene').Document) => IRDocument;
    };
    const ir = sceneToIR(doc);
    const irNode = Object.values(ir.nodes).find(
      (n): n is SemanticNode => n.metadata.sourceNodeId === node.id,
    );
    if (irNode) return exportIrNodeToTailwind(irNode, ir, opts ?? {});
  } catch {
    // Fall through
  }
  return directNodeToTailwind(node, opts ?? {});
}

export function exportIrNodeToTailwind(
  node: SemanticNode,
  ir: IRDocument,
  opts: TailwindExportOptions = {},
): string {
  const av = opts.arbitraryValues ?? true;
  const base = opts.baseFontSize ?? 16;
  const b: ClassBuilder = { classes: [], av, base };

  layoutClasses(node, b);
  appearanceClasses(node, b);
  typographyClasses(node, b);

  if (node.zIndex !== undefined && node.zIndex !== 0) b.classes.push(`z-[${node.zIndex}]`);
  if (!node.visible) b.classes.push('hidden');

  // Children
  const childrenHtml = node.children
    .filter((c) => c.visible !== false)
    .map((c) => {
      const childCode = exportIrNodeToTailwind(c, ir, opts);
      return `          ${childCode}`;
    })
    .join('\n');

  // Tag selection
  const tag = ir.htmlHints[node.id] || 'div';

  // Content
  let innerContent = '';
  if (node.content.type === 'text' && node.content.text) {
    innerContent = escapeXml(node.content.text.value);
  } else if (node.content.type === 'image' && node.content.image) {
    const img = node.content.image;
    innerContent = `<img src="${escapeXml(img.src)}" alt="${escapeXml(img.alt || node.name)}" className="w-full h-full object-cover" />`;
  }

  // Flattened image fallback
  if (!innerContent && node.flattening?.emitAs === 'image' && node.flattening.flattenedImageUrl) {
    innerContent = `<img src="${escapeXml(node.flattening.flattenedImageUrl)}" alt="${escapeXml(node.name)}" className="w-full h-full object-contain" />`;
  }

  // Accessibility
  let ariaAttrs = '';
  if (node.accessibility.label) ariaAttrs += ` aria-label="${escapeXml(node.accessibility.label)}"`;
  if (node.accessibility.role) ariaAttrs += ` role="${escapeXml(node.accessibility.role)}"`;
  if (node.accessibility.liveRegion) ariaAttrs += ' aria-live="polite"';
  if (node.accessibility.focusable) ariaAttrs += ' tabIndex={0}';

  const classStr = b.classes.join(' ');
  const fullChildren = childrenHtml || '';
  const fullContent = innerContent;

  if (tag === 'img') {
    const src = node.content.image?.src || node.flattening?.flattenedImageUrl || '';
    const alt = node.accessibility.label || node.name;
    return `<img src="${escapeXml(src)}" alt="${escapeXml(alt)}" className="${classStr}" />`;
  }

  if (tag === 'hr') {
    return `<hr className="${classStr}" />`;
  }

  if (!fullChildren && !fullContent) {
    return `<${tag} className="${classStr}"${ariaAttrs} />`;
  }

  if (fullContent && !fullChildren) {
    return `<${tag} className="${classStr}"${ariaAttrs}>${fullContent}</${tag}>`;
  }

  return `<${tag} className="${classStr}"${ariaAttrs}>\n${fullChildren}\n        </${tag}>`;
}

export function exportIrToTailwind(ir: IRDocument, opts: TailwindExportOptions = {}): string {
  const imports = `import React from 'react';\n\n`;
  const roots = ir.rootIds
    .map((id) => ir.nodes[id])
    .filter((n): n is SemanticNode => n != null)
    .filter((n) => n.visible !== false);

  const mainComponent = `function Design() {\n  return (\n    <div className="min-h-screen bg-white">\n${roots.map((n) => `      ${exportIrNodeToTailwind(n, ir, opts)}`).join('\n')}\n    </div>\n  );\n}\n\nexport default Design;`;

  return imports + mainComponent;
}

// ── Target gaps ──────────────────────────────────────────────────────────────

export function tailwindTargetGaps(
  node: import('@varve/scene').SceneNode,
  doc: import('@varve/scene').Document,
): TargetGap[] {
  const gaps: TargetGap[] = [];

  // Check for adjustment stack (nondestructive filters)
  if (node.kind === 'adjustment') {
    const visible = ((node as import('@varve/scene').AdjustmentNode).adjustments ?? []).filter(
      (a) => a.visible && a.opacity > 0,
    );
    if (visible.length > 0) {
      const kinds = [
        ...new Set(
          visible.map((a) => (a as { type?: string }).type ?? (a as { kind?: string }).kind ?? ''),
        ),
      ]
        .filter(Boolean)
        .join(', ');
      gaps.push({
        nodeId: node.id,
        nodeName: node.name,
        feature: `nondestructive adjustment stack (${kinds})`,
        severity: 'warning',
        fallback: 'Flatten the adjustment layer and export a rasterized bitmap',
      });
    }
  }

  const spec = analyzeNodeFlattening(node, doc);
  if (spec.mustFlatten) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: spec.reasons.join(', '),
      severity: 'warning',
      fallback: 'Raster fallback required; use bg-[url(...)] with pre-rendered image',
    });
  }

  if (node.kind === 'shape' && node.shape.kind !== 'rect') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `non-rectangular shape (${node.shape.kind})`,
      severity: 'warning',
      fallback: 'Wrap in an <svg> element or use an inline SVG component',
    });
  }

  const fills = node.fills ?? [];
  if (fills.some((f) => f.type === 'gradient')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'gradient fill',
      severity: 'info',
      fallback: 'Use bg-gradient-to-r or custom CSS',
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
      severity: 'info',
      fallback: 'Use blur-* or backdrop-blur-* classes',
    });
  }

  return gaps;
}

/** Backward-compatible wrapper: node + doc → Tailwind JSX. */
export function exportNodeToTailwind(
  node: SceneNode,
  _doc: Document,
  opts?: TailwindExportOptions,
): string {
  const av = opts?.arbitraryValues ?? true;
  const base = opts?.baseFontSize ?? 16;
  const b: ClassBuilder = { classes: [], av, base };

  b.classes.push('absolute');
  const tx = node.transform[4] ?? 0;
  const ty = node.transform[5] ?? 0;
  b.classes.push(`left-[${tx}px]`);
  b.classes.push(`top-[${ty}px]`);

  // Size depends on node kind
  let w = 100,
    h = 100;
  if (node.kind === 'shape') {
    const s = node.shape;
    if (s.kind === 'rect') {
      w = s.w;
      h = s.h;
    }
  } else if (node.kind === 'text') {
    w = (node.text?.length ?? 0) * (node.fontSize ?? 16) * 0.6;
    h = (node.fontSize ?? 16) * 1.4;
  } else if (node.kind === 'frame') {
    w = (node as import('@varve/scene').FrameNode).w ?? 200;
    h = (node as import('@varve/scene').FrameNode).h ?? 160;
  }
  b.classes.push(sizeTw(w, av, 'w'));
  b.classes.push(sizeTw(h, av, 'h'));

  // Color with token support
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) {
    b.classes.push(`bg-[--${tokenName}]`);
  } else {
    const fill = node.fills?.[0]?.color ?? node.fill;
    if (fill) {
      const fc = fill as { r?: number; g?: number; b?: number };
      const r = Math.round(fc.r ?? 0);
      const gCol = Math.round(fc.g ?? 0);
      const bCol = Math.round(fc.b ?? 0);
      const hex = `#${r.toString(16).padStart(2, '0')}${gCol.toString(16).padStart(2, '0')}${bCol.toString(16).padStart(2, '0')}`;
      b.classes.push(`bg-[${hex}]`);
    }
  }

  if (node.kind === 'text') {
    const tag = 'span';
    const text = (node as import('@varve/scene').TextNode).text ?? '';
    const cleaned = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<${tag} className="${b.classes.join(' ')}">${cleaned}</${tag}>`;
  }

  return `<div className="${b.classes.join(' ')}" />`;
}
