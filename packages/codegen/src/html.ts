// COMPLEXITY: ~52 — fillToCss (12), appearanceToCss (28), exportIrToHtml (18)
// Plan: extract fill/effect CSS builders into html-css.ts
/**
 * Semantic HTML + modern CSS emitter.
 *
 * Produces clean, accessible HTML with CSS Grid / Flexbox layout,
 * semantic elements, CSS custom properties, and responsive design.
 * No absolute positioning — uses the design's auto-layout and
 * responsive intent to generate real layout.
 *
 * v2.1: Uses the enhanced DesignIR with flattening info,
 *       responsive inference, and HTML element hints.
 */

import type {
  AppearanceSpec,
  FidelityWarning,
  FillSpec,
  FlattenInfo,
  IRDocument,
  LayoutSpec,
  SemanticNode,
  TypographySpec,
} from './ir-types';

export interface HtmlExportOptions {
  /** Include CSS reset/normalize. Default true. */
  includeReset?: boolean;
  /** Use CSS custom properties for tokens. Default true. */
  useCustomProperties?: boolean;
  /** Unit for dimensions. Default 'px'. */
  unit?: 'px' | 'rem';
  /** Base font size for rem units. Default 16. */
  baseFontSize?: number;
  /** Include responsive media queries. Default true. */
  responsive?: boolean;
  /** Include reduced-motion media query. Default true. */
  reducedMotion?: boolean;
  /** Indent string. Default '  '. */
  indent?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sizeValue(px: number, unit: string, base: number): string {
  if (unit === 'rem' && base > 0) return `${(px / base).toFixed(3)}rem`;
  return `${px}px`;
}

function colorValue(fill: FillSpec): string {
  if (fill.type === 'solid') return fill.value;
  if (fill.type === 'gradient') {
    const g = fill.gradient;
    const stops = g.stops.map((s) => `${s.color} ${s.position * 100}%`).join(', ');
    const space =
      g.interpolationSpace && g.interpolationSpace !== 'srgb'
        ? ` in ${g.interpolationSpace === 'linear-srgb' ? 'srgb-linear' : g.interpolationSpace}`
        : '';
    const hue =
      g.hueInterpolation && (g.interpolationSpace === 'oklch' || g.interpolationSpace === 'hsl')
        ? ` ${g.hueInterpolation} hue`
        : '';
    if (g.type === 'linear')
      return `linear-gradient(${g.rotation ?? 0}deg${space}${hue}, ${stops})`;
    if (g.type === 'radial') return `radial-gradient(circle${space}${hue}, ${stops})`;
    return `linear-gradient(${g.rotation ?? 0}deg${space}${hue}, ${stops})`;
  }
  if (fill.type === 'image') return `url("${escapeHtml(fill.image.src)}")`;
  if (fill.type === 'token') return `var(--${fill.tokenId})`;
  return 'transparent';
}

function fillToCss(fills: FillSpec[]): string | undefined {
  const visible = fills.filter((f) => f.opacity > 0);
  if (visible.length === 0) return undefined;
  if (visible.length === 1) {
    const f = visible[0]!;
    return f.opacity < 1
      ? `color-mix(in srgb, ${colorValue(f)} ${f.opacity * 100}%, transparent)`
      : colorValue(f);
  }
  // Stacked fills: only the topmost renders as background
  const top = visible[visible.length - 1]!;
  return top.opacity < 1
    ? `color-mix(in srgb, ${colorValue(top)} ${top.opacity * 100}%, transparent)`
    : colorValue(top);
}

// ── Layout to CSS ─────────────────────────────────────────────────────────────

function layoutToCss(layout: LayoutSpec, unit: string, base: number): Record<string, string> {
  const props: Record<string, string> = {};

  if (layout.mode === 'flex') {
    props.display = 'flex';
    switch (layout.direction) {
      case 'row':
        props['flex-direction'] = 'row';
        break;
      case 'column':
        props['flex-direction'] = 'column';
        break;
      case 'row-reverse':
        props['flex-direction'] = 'row-reverse';
        break;
      case 'column-reverse':
        props['flex-direction'] = 'column-reverse';
        break;
    }
    const gapH = layout.gap.left || layout.gap.right;
    const gapV = layout.gap.top || layout.gap.bottom;
    if (gapH || gapV) props.gap = sizeValue(Math.max(gapH, gapV), unit, base);
    if (layout.wrap) props['flex-wrap'] = 'wrap';

    const ai = layout.alignItems;
    if (ai === 'start') props['align-items'] = 'flex-start';
    else if (ai === 'end') props['align-items'] = 'flex-end';
    else if (ai === 'center') props['align-items'] = 'center';
    else if (ai === 'stretch') props['align-items'] = 'stretch';

    const jc = layout.justifyContent;
    if (jc === 'start') props['justify-content'] = 'flex-start';
    else if (jc === 'end') props['justify-content'] = 'flex-end';
    else if (jc === 'center') props['justify-content'] = 'center';
    else if (jc === 'stretch') props['justify-content'] = 'stretch';
  }

  if (layout.mode === 'grid') {
    props.display = 'grid';
  }

  const pad = layout.padding;
  if (pad.top || pad.right || pad.bottom || pad.left) {
    props.padding = [pad.top, pad.right, pad.bottom, pad.left]
      .map((v) => sizeValue(v, unit, base))
      .join(' ');
  }

  const pos = layout.position;
  if (pos && pos.type === 'absolute') {
    props.position = 'absolute';
    if (pos.left !== undefined) props.left = sizeValue(pos.left, unit, base);
    if (pos.top !== undefined) props.top = sizeValue(pos.top, unit, base);
    if (pos.right !== undefined) props.right = sizeValue(pos.right, unit, base);
    if (pos.bottom !== undefined) props.bottom = sizeValue(pos.bottom, unit, base);
  } else if (pos && pos.type === 'relative') {
    props.position = 'relative';
  } else if (layout.mode !== 'flex' && layout.mode !== 'grid') {
    props.position = 'relative';
  }

  if (layout.width.mode === 'fixed' && layout.width.value > 0) {
    props.width = sizeValue(layout.width.value, unit, base);
  } else if (layout.width.mode === 'fill') {
    props.width = '100%';
  } else if (layout.width.mode === 'percent') {
    props.width = `${layout.width.value}%`;
  } else if (layout.width.mode === 'hug') {
    props.width = 'fit-content';
  }

  if (layout.height.mode === 'fixed' && layout.height.value > 0) {
    props.height = sizeValue(layout.height.value, unit, base);
  } else if (layout.height.mode === 'fill') {
    props.height = '100%';
  } else if (layout.height.mode === 'percent') {
    props.height = `${layout.height.value}%`;
  } else if (layout.height.mode === 'hug') {
    props.height = 'fit-content';
  }

  const ox = layout.overflow;
  if (ox.x !== 'visible' || ox.y !== 'visible') {
    props.overflow = ox.x === ox.y ? ox.x : `${ox.x} ${ox.y}`;
  }

  if (layout.flex) {
    const f = layout.flex;
    props.flex = `${f.grow} ${f.shrink} ${f.basis === 'auto' ? 'auto' : typeof f.basis === 'number' ? sizeValue(f.basis, unit, base) : f.basis}`;
    if (f.alignSelf) props['align-self'] = f.alignSelf;
    if (f.order && f.order !== 0) props.order = String(f.order);
  }

  return props;
}

// ── Appearance to CSS ─────────────────────────────────────────────────────────

function appearanceToCss(
  appearance: AppearanceSpec,
  flattening: FlattenInfo | undefined,
  unit: string,
  base: number,
): Record<string, string> {
  const props: Record<string, string> = {};

  if (flattening?.mustFlatten && flattening.flattenedImageUrl) {
    props['background-image'] = `url("${flattening.flattenedImageUrl}")`;
    props['background-size'] = 'contain';
    props['background-repeat'] = 'no-repeat';
    props['background-position'] = 'center';
    if (
      appearance.borderRadius.topLeft ||
      appearance.borderRadius.topRight ||
      appearance.borderRadius.bottomRight ||
      appearance.borderRadius.bottomLeft
    ) {
      const br = appearance.borderRadius;
      props['border-radius'] = [br.topLeft, br.topRight, br.bottomRight, br.bottomLeft]
        .map((v) => sizeValue(v, unit, base))
        .join(' ');
    }
    return props;
  }

  const bg = fillToCss(appearance.background);
  if (bg) props.background = bg;

  if (appearance.opacity !== 1) props.opacity = String(appearance.opacity);

  if (appearance.blendMode !== 'normal') {
    props['mix-blend-mode'] = appearance.blendMode;
  }

  const br = appearance.borderRadius;
  if (br.topLeft || br.topRight || br.bottomRight || br.bottomLeft) {
    props['border-radius'] = [br.topLeft, br.topRight, br.bottomRight, br.bottomLeft]
      .map((v) => sizeValue(v, unit, base))
      .join(' ');
  }

  if (appearance.border.uniform !== false) {
    const b = appearance.border.top;
    if (b.width > 0 && b.style !== 'none') {
      props.border = `${sizeValue(b.width, unit, base)} ${b.style} ${b.color}`;
    }
  } else {
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    for (const side of sides) {
      const b = appearance.border[side];
      if (b.width > 0 && b.style !== 'none') {
        props[`border-${side}`] = `${sizeValue(b.width, unit, base)} ${b.style} ${b.color}`;
      }
    }
  }

  for (const stroke of appearance.strokes) {
    if (stroke.weight > 0 && stroke.fills.length > 0) {
      const c = colorValue(stroke.fills[0]!);
      props.outline = `${sizeValue(stroke.weight, unit, base)} solid ${c}`;
      if (stroke.align === 'inside')
        props['outline-offset'] = `-${sizeValue(stroke.weight, unit, base)}`;
    }
  }

  for (const effect of appearance.effects) {
    if (effect.type === 'drop-shadow') {
      props['box-shadow'] =
        `${sizeValue(effect.offsetX, unit, base)} ${sizeValue(effect.offsetY, unit, base)} ${sizeValue(effect.radius, unit, base)} ${effect.color}`;
    }
    if (effect.type === 'layer-blur') {
      props.filter = `blur(${sizeValue(effect.radius, unit, base)})`;
    }
    if (effect.type === 'background-blur') {
      props['backdrop-filter'] = `blur(${sizeValue(effect.radius, unit, base)})`;
    }
  }

  if (appearance.transform.rotate !== 0) {
    props.transform = `rotate(${appearance.transform.rotate}deg)`;
  }
  if (appearance.transform.scale.x !== 1 || appearance.transform.scale.y !== 1) {
    const cur = props.transform || '';
    props.transform =
      `${cur} scale(${appearance.transform.scale.x}, ${appearance.transform.scale.y})`.trim();
  }

  if (appearance.clipContent) {
    props.overflow = 'hidden';
  }

  return props;
}

// ── Typography to CSS ─────────────────────────────────────────────────────────

function typographyToCss(typo: TypographySpec, unit: string, base: number): Record<string, string> {
  const props: Record<string, string> = {};

  if (typo.fontFamily) {
    props['font-family'] = typo.fontFamily.includes(' ') ? `"${typo.fontFamily}"` : typo.fontFamily;
  }
  props['font-size'] = sizeValue(typo.fontSize, unit, base);
  props['font-weight'] = String(typo.fontWeight);

  if (typo.lineHeight && typo.lineHeight !== 1.4) {
    props['line-height'] = String(typo.lineHeight);
  }
  if (typo.letterSpacing !== 0) {
    props['letter-spacing'] = sizeValue(typo.letterSpacing, unit, base);
  }
  if (typo.textAlign && typo.textAlign !== 'left') {
    props['text-align'] = typo.textAlign;
  }
  if (typo.textTransform && typo.textTransform !== 'none') {
    props['text-transform'] = typo.textTransform;
  }
  if (typo.decoration && typo.decoration !== 'none') {
    props['text-decoration'] = typo.decoration;
  }
  if (typo.direction && typo.direction !== 'ltr') {
    props.direction = typo.direction;
  }
  if (typo.writingMode) {
    props['writing-mode'] = typo.writingMode;
  }
  if (typo.whiteSpace) {
    props['white-space'] = typo.whiteSpace;
  }
  if (typo.overflowWrap) {
    props['overflow-wrap'] = typo.overflowWrap;
  }
  if (typo.textIndent) {
    props['text-indent'] = sizeValue(typo.textIndent, unit, base);
  }

  return props;
}

// ── CSS Output ────────────────────────────────────────────────────────────────

function propsToCss(props: Record<string, string>, indent: string): string {
  return Object.entries(props)
    .filter(([_, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join('\n');
}

function makeClassName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'el'
  );
}

export function exportIrToHtml(
  ir: IRDocument,
  opts: HtmlExportOptions = {},
): { html: string; css: string; assets: string[]; warnings: FidelityWarning[] } {
  const unit = opts.unit ?? 'px';
  const base = opts.baseFontSize ?? 16;
  const indent = opts.indent ?? '  ';
  const _useCp = opts.useCustomProperties ?? true;
  void _useCp;

  const cssLines: string[] = [];
  const htmlParts: string[] = [];
  const assets: string[] = [];
  const usedClasses = new Map<string, number>();

  // ── CSS Reset ──────────────────────────────────────────────────────────────
  if (opts.includeReset !== false) {
    cssLines.push('*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }');
    cssLines.push('html { -webkit-text-size-adjust: 100%; }');
    cssLines.push('img, svg, video { max-width: 100%; display: block; }');
    cssLines.push('');
  }

  // ── Reduced Motion ─────────────────────────────────────────────────────────
  if (opts.reducedMotion !== false) {
    cssLines.push('@media (prefers-reduced-motion: reduce) {');
    cssLines.push('  *, *::before, *::after {');
    cssLines.push('    animation-duration: 0.01ms !important;');
    cssLines.push('    transition-duration: 0.01ms !important;');
    cssLines.push('  }');
    cssLines.push('}');
    cssLines.push('');
  }

  // ── Collect all flattened image assets ─────────────────────────────────────
  function collectAssets(node: SemanticNode) {
    if (node.flattening?.flattenedImageUrl) {
      assets.push(node.flattening.flattenedImageUrl);
    }
    for (const child of node.children) collectAssets(child);
  }
  for (const rootId of ir.rootIds) {
    const root = ir.nodes[rootId];
    if (root) collectAssets(root);
  }

  // ── Atomic class building ──────────────────────────────────────────────────
  function buildNodeCss(
    node: SemanticNode,
    parentIsFlex: boolean,
  ): { className: string; css: string; htmlTag: string } {
    const baseName = makeClassName(node.name || node.kind || 'el');
    let className = baseName;
    let idx = 2;
    while (usedClasses.has(className)) className = `${baseName}-${idx++}`;
    usedClasses.set(className, 1);

    const tag = ir.htmlHints[node.id] || 'div';
    const nodeCss: Record<string, string> = {};

    // Layout
    const layoutProps = layoutToCss(node.layout, unit, base);

    // Only emit position: absolute or relative when the parent is a stacking context
    // If parent is flex, remove absolute positioning from children
    if (parentIsFlex && layoutProps.position) {
      delete layoutProps.position;
    }

    // If node is in a flex parent, it doesn't need position/width/height the same way
    Object.assign(nodeCss, layoutProps);

    // Appearance
    const appearanceProps = appearanceToCss(node.appearance, node.flattening, unit, base);
    Object.assign(nodeCss, appearanceProps);

    // Typography
    if (node.appearance.typography) {
      const typoProps = typographyToCss(node.appearance.typography, unit, base);
      Object.assign(nodeCss, typoProps);
    }

    // z-index
    if (node.zIndex !== undefined && node.zIndex !== 0) {
      nodeCss['z-index'] = String(node.zIndex);
    }

    // Visibility
    if (!node.visible) {
      nodeCss.display = 'none';
    }

    const cssBlock = propsToCss(nodeCss, indent + indent);
    const fullCss = cssBlock ? `\n${indent}.${className} {\n${cssBlock}\n${indent}}` : '';

    return { className, css: fullCss, htmlTag: tag };
  }

  // ── Recursive HTML emitter ─────────────────────────────────────────────────
  function emitNode(node: SemanticNode, parentIsFlex: boolean, depth: number): string {
    const { className, css, htmlTag } = buildNodeCss(node, parentIsFlex);
    if (css) cssLines.push(css);

    const innerIndent = indent.repeat(depth + 1);
    const childIndent = indent.repeat(depth + 2);
    const classAttr = `class="${className}"`;

    // Content
    let content = '';
    if (node.content.type === 'text' && node.content.text) {
      content = escapeHtml(node.content.text.value);
    } else if (node.content.type === 'image' && node.content.image) {
      const img = node.content.image;
      const alt = img.alt ? ` alt="${escapeHtml(img.alt)}"` : ' role="presentation"';
      const src = img.src;
      content = `<img src="${escapeHtml(src)}"${alt} class="${className}__img" />`;
    }

    // Children
    const childrenHtml = node.children
      .filter((c) => c.visible !== false)
      .map((c) => emitNode(c, node.layout.mode === 'flex', depth + 1))
      .join('\n');

    // Flattened image content
    let flattenedImg = '';
    if (node.flattening?.emitAs === 'image' && node.flattening.flattenedImageUrl) {
      flattenedImg = `${childIndent}<img src="${escapeHtml(node.flattening.flattenedImageUrl)}" alt="${escapeHtml(node.name)}" class="${className}__flattened" />\n`;
    }

    // Build tag with accessibility
    let ariaAttrs = '';
    if (node.accessibility.label)
      ariaAttrs += ` aria-label="${escapeHtml(node.accessibility.label)}"`;
    if (node.accessibility.role) ariaAttrs += ` role="${escapeHtml(node.accessibility.role)}"`;
    if (node.accessibility.liveRegion) ariaAttrs += ' aria-live="polite"';
    if (node.accessibility.focusable) ariaAttrs += ' tabindex="0"';
    if (node.accessibility.ariaExpanded !== undefined)
      ariaAttrs += ` aria-expanded="${node.accessibility.ariaExpanded}"`;
    if (node.accessibility.ariaHidden) ariaAttrs += ' aria-hidden="true"';
    if (node.accessibility.ariaCurrent)
      ariaAttrs += ` aria-current="${node.accessibility.ariaCurrent}"`;

    const fullContent = content || flattenedImg;
    const hasChildrenOrContent = childrenHtml || fullContent;

    if (htmlTag === 'img') {
      const src = node.content.image?.src || node.flattening?.flattenedImageUrl || '';
      const alt = node.accessibility.label || node.name;
      return `${innerIndent}<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${classAttr ? ` ${classAttr}` : ''} />`;
    }

    if (htmlTag === 'hr') {
      return `${innerIndent}<hr${classAttr ? ` ${classAttr}` : ''} />`;
    }

    if (!hasChildrenOrContent) {
      return `${innerIndent}<${htmlTag}${classAttr ? ` ${classAttr}` : ''}${ariaAttrs}></${htmlTag}>`;
    }

    const childContent = childrenHtml || fullContent;
    return `${innerIndent}<${htmlTag}${classAttr ? ` ${classAttr}` : ''}${ariaAttrs}>\n${childContent}\n${innerIndent}</${htmlTag}>`;
  }

  // ── Emit Roots ─────────────────────────────────────────────────────────────
  for (const rootId of ir.rootIds) {
    const node = ir.nodes[rootId];
    if (!node || node.visible === false) continue;
    const html = emitNode(node, false, 0);
    if (html) htmlParts.push(html);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(ir.metadata.name)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
${htmlParts.join('\n')}
</body>
</html>`;

  const _css = cssLines.join('\n');
  void _css;

  // ── Responsive Media Queries ───────────────────────────────────────────────
  if (opts.responsive !== false && ir.breakpoints.length > 0) {
    const mqLines: string[] = ['\n/* Responsive Breakpoints */'];
    for (const bp of ir.breakpoints) {
      if (bp.minWidth === 0) continue;
      mqLines.push(`\n@media (max-width: ${bp.minWidth - 0.5}px) {`);
      for (const [_nodeId, node] of Object.entries(ir.nodes)) {
        const ri = node.responsiveInference;
        if (ri && ri.breakpoint >= bp.minWidth && ri.confidence > 0.5 && ri.layoutChanges) {
          const cls = makeClassName(node.name || node.kind);
          mqLines.push(`  .${cls} {`);
          if (ri.layoutChanges.wrap) mqLines.push(`    flex-wrap: wrap;`);
          if (ri.layoutChanges.direction)
            mqLines.push(`    flex-direction: ${ri.layoutChanges.direction};`);
          mqLines.push(`  }`);
        }
      }
      mqLines.push('}');
    }
    cssLines.push(...mqLines);
  }

  return {
    html,
    css: cssLines.join('\n'),
    assets,
    warnings: ir.fidelityWarnings ?? [],
  };
}
