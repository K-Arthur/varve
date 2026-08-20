// COMPLEXITY: ~130 (convertToSemanticNode=35, buildAccessibilityMetadata=35,
// buildAutoLayoutSpec=15, buildContentSpec=15)
// Plan: extract accessibility metadata into its own module

/**
 * Spec builder functions for scene-to-IR conversion.
 */

import type {
  Document,
  FrameNode,
  GradientInterpolationSpace,
  NodeId,
  SceneNode,
  ShapeNode,
  TextNode,
} from '@varve/scene';
import { isImageShape, resolveMask } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import type {
  AccessibilityMetadata,
  AppearanceSpec,
  BlurSpec,
  BorderRadiusSpec,
  BorderSpec,
  ColorStop,
  ConstraintSpec,
  ContentSpec,
  EffectSpec,
  FillSpec,
  FlexChildSpec,
  GradientSpec,
  ImageFillSpec,
  InferenceContext,
  InteractionStateSpec,
  LayoutMode,
  LayoutSpec,
  SceneAnalysisResult,
  SemanticKind,
  SemanticNode,
  SemanticRole,
  ShadowSpec,
  StrokeSpec,
  TransformSpec,
  TypographySpec,
} from './ir-types';
import {
  DEFAULT_ACCESSIBILITY,
  DEFAULT_APPEARANCE_SPEC,
  DEFAULT_CONSTRAINT_SPEC,
  DEFAULT_CONTENT,
  DEFAULT_LAYOUT_SPEC,
  DEFAULT_TOKEN_BINDINGS,
} from './ir-types';

// ── Color Helpers ──────────────────────────────────────────────────────────────

function managedColorToCss(color: import('@varve/scene').ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return a < 255 ? `rgba(${r},${g},${b},${(a / 255).toFixed(3)})` : `rgb(${r},${g},${b})`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateExportId(sourceId: string): string {
  return `export_${sourceId}`;
}

// ── Fill Spec Builder ──────────────────────────────────────────────────────────

function buildFillSpec(
  node: SceneNode,
  documentGradientInterpolation: GradientInterpolationSpace = 'oklab',
): FillSpec[] {
  const fills: FillSpec[] = [];

  if (node.fills && node.fills.length > 0) {
    for (const f of node.fills) {
      if (f.visible === false) continue;
      if (f.type === 'solid' && f.color) {
        fills.push({ type: 'solid', value: managedColorToCss(f.color), opacity: f.opacity ?? 1 });
      } else if (f.type === 'gradient' && f.gradient) {
        const g = f.gradient;
        const stops: ColorStop[] = g.stops.map((s) => ({
          position: s.position,
          color: managedColorToCss(s.color),
          opacity: s.color.a / 255,
        }));
        fills.push({
          type: 'gradient',
          gradient: {
            type: g.type,
            stops,
            interpolationSpace:
              g.interpolationSource === 'document'
                ? documentGradientInterpolation
                : (g.interpolationSpace ?? 'srgb'),
            ...(g.hueInterpolation ? { hueInterpolation: g.hueInterpolation } : {}),
            rotation: g.rotation,
          } as GradientSpec,
          opacity: f.opacity ?? 1,
        });
      } else if (f.type === 'image' && f.image) {
        const img = f.image;
        fills.push({
          type: 'image',
          image: {
            src: img.src,
            fit: img.fit,
            position: { x: 0, y: 0 },
            crop: img.crop,
            imageWidth: img.imageWidth,
            imageHeight: img.imageHeight,
            rotation: img.rotation,
            flipH: img.flipH,
            flipV: img.flipV,
          } as ImageFillSpec,
          opacity: f.opacity ?? 1,
        });
      }
    }
  }

  if (fills.length === 0 && node.fill) {
    fills.push({ type: 'solid', value: managedColorToCss(node.fill), opacity: 1 });
  }

  return fills.length > 0 ? fills : [{ type: 'solid', value: '#00000000', opacity: 0 }];
}

// ── Stroke Spec Builder ────────────────────────────────────────────────────────

function buildStrokeSpec(node: SceneNode): StrokeSpec[] {
  const strokes = (node as unknown as Record<string, unknown>).strokes as
    | Array<Record<string, unknown>>
    | undefined;
  if (!strokes || strokes.length === 0) return [];

  return strokes
    .filter((s) => s.visible !== false)
    .map((s) => ({
      fills: s.color
        ? [
            {
              type: 'solid',
              value: managedColorToCss(s.color as import('@varve/scene').ManagedColor),
              opacity: 1,
            },
          ]
        : [],
      weight: (s.weight as number) ?? 1,
      cap: (s.cap as 'round' | 'butt' | 'square') ?? 'round',
      join: (s.join as 'miter' | 'round' | 'bevel') ?? 'miter',
      miterLimit: (s.miterLimit as number) ?? 4,
      dashArray: (s.dashArray as number[]) ?? [],
      dashOffset: (s.dashOffset as number) ?? 0,
      align: (s.align as 'center' | 'inside' | 'outside') ?? 'center',
    }));
}

// ── Border Spec Builder ────────────────────────────────────────────────────────

function buildBorderSpec(_node: SceneNode): BorderSpec {
  return {
    top: { width: 0, color: '#000000', style: 'none' },
    right: { width: 0, color: '#000000', style: 'none' },
    bottom: { width: 0, color: '#000000', style: 'none' },
    left: { width: 0, color: '#000000', style: 'none' },
    uniform: true,
  };
}

// ── Typography Spec Builder ─────────────────────────────────────────────────────

function buildTypographySpec(node: SceneNode): TypographySpec {
  const base: TypographySpec = {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
  };

  if (node.kind === 'text') {
    const tn = node as TextNode;
    base.fontFamily = tn.fontFamily || 'Inter';
    base.fontSize = tn.fontSize || 16;
    base.fontWeight = tn.fontWeight || 400;
    base.lineHeight = tn.lineHeight || 1.4;
    base.letterSpacing = tn.letterSpacing || 0;
    if (tn.textAlign) base.textAlign = tn.textAlign;
    if (tn.textCase) base.textTransform = tn.textCase;
    if (tn.textDecoration) base.decoration = tn.textDecoration;
    if (tn.direction && tn.direction !== 'auto') base.direction = tn.direction;
    if (tn.variableAxes && Object.keys(tn.variableAxes).length > 0) {
      base.variableAxes = tn.variableAxes;
    }
    if (tn.openTypeFeatures && Object.keys(tn.openTypeFeatures).length > 0) {
      base.openTypeFeatures = tn.openTypeFeatures;
    }
    if ('whiteSpace' in tn && (tn as Record<string, unknown>).whiteSpace)
      base.whiteSpace = (tn as Record<string, unknown>).whiteSpace as
        | 'normal'
        | 'nowrap'
        | 'pre'
        | 'pre-wrap'
        | 'pre-line';
  }

  return base;
}

// ── Effect Spec Builder ────────────────────────────────────────────────────────

function buildEffectSpec(node: SceneNode): EffectSpec[] {
  const effects: EffectSpec[] = [];
  const nodeEffects = (node as { effects?: Array<Record<string, unknown>> }).effects ?? [];

  for (const e of nodeEffects) {
    if (e.visible === false) continue;
    if (e.type === 'dropShadow' || e.type === 'innerShadow') {
      effects.push({
        type: e.type === 'dropShadow' ? 'drop-shadow' : 'inner-shadow',
        // The scene Effect schema stores offsets as x/y and blur radius as
        // blur (matching the engine IR); the codegen spec normalises them to
        // offsetX/offsetY/radius.
        offsetX: (e.x as number) ?? 0,
        offsetY: (e.y as number) ?? 0,
        radius: (e.blur as number) ?? 0,
        spread: (e.spread as number) ?? 0,
        color: e.color
          ? managedColorToCss(e.color as import('@varve/scene').ManagedColor)
          : '#000000',
        inset: e.type === 'innerShadow',
      } as ShadowSpec);
    } else if (e.type === 'layerBlur') {
      effects.push({
        type: 'layer-blur',
        radius: (e.radius as number) ?? 4,
      } as BlurSpec);
    } else if (e.type === 'backgroundBlur') {
      effects.push({
        type: 'background-blur',
        radius: (e.radius as number) ?? 4,
      } as BlurSpec);
    }
  }

  return effects;
}

// ── Border Radius Spec Builder ─────────────────────────────────────────────────

function buildBorderRadiusSpec(node: SceneNode): BorderRadiusSpec {
  if (node.kind === 'shape') {
    const sn = node as ShapeNode;
    if (sn.shape.kind === 'rect' && 'cornerRadius' in sn.shape) {
      const cr = sn.shape.cornerRadius as number | [number, number, number, number] | undefined;
      if (cr !== undefined) {
        if (typeof cr === 'number') {
          return { topLeft: cr, topRight: cr, bottomRight: cr, bottomLeft: cr };
        }
        return {
          topLeft: cr[0] ?? 0,
          topRight: cr[1] ?? 0,
          bottomRight: cr[2] ?? 0,
          bottomLeft: cr[3] ?? 0,
        };
      }
    }
  }
  return { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
}

// ── Transform Spec Builder ─────────────────────────────────────────────────────

function buildTransformSpec(node: SceneNode): TransformSpec {
  const t = node.transform;
  return {
    translate: { x: t[4] ?? 0, y: t[5] ?? 0 },
    rotate: 0,
    scale: { x: t[0] ?? 1, y: t[3] ?? 1 },
    origin: { x: 0, y: 0 },
  };
}

// ── Interaction State Builder ──────────────────────────────────────────────────

function buildInteractionStateSpec(_node: SceneNode): InteractionStateSpec {
  return {};
}

// ── Layout Spec Builders ───────────────────────────────────────────────────────

function buildLayoutSpec(
  constraints: ConstraintSpec,
  _parentLayout: LayoutSpec,
  _node: SceneNode,
): LayoutSpec {
  const layout: LayoutSpec = { ...DEFAULT_LAYOUT_SPEC };

  if (constraints.horizontal === 'stretch' || constraints.vertical === 'stretch') {
    layout.mode = 'flex';
  }

  switch (constraints.horizontal) {
    case 'min':
      layout.justifyContent = 'start';
      break;
    case 'max':
      layout.justifyContent = 'end';
      break;
    case 'center':
      layout.justifyContent = 'center';
      break;
    case 'stretch':
      layout.width = { mode: 'fill', value: 100 };
      break;
    case 'scale':
      layout.width = { mode: 'percent', value: 100 };
      break;
  }

  switch (constraints.vertical) {
    case 'min':
      layout.alignItems = 'start';
      break;
    case 'max':
      layout.alignItems = 'end';
      break;
    case 'center':
      layout.alignItems = 'center';
      break;
    case 'stretch':
      layout.height = { mode: 'fill', value: 100 };
      break;
    case 'scale':
      layout.height = { mode: 'percent', value: 100 };
      break;
  }

  return layout;
}

function buildAutoLayoutSpec(node: FrameNode): LayoutSpec {
  const layout: LayoutSpec = { ...DEFAULT_LAYOUT_SPEC };

  if (node.layoutStyle) {
    layout.mode = 'flex';
    layout.direction = node.layoutStyle.direction === 'row' ? 'row' : 'column';
    layout.wrap = node.layoutStyle.wrap;
    layout.gap = {
      top: node.layoutStyle.gap,
      right: node.layoutStyle.gap,
      bottom: node.layoutStyle.gap,
      left: node.layoutStyle.gap,
    };
    layout.padding = {
      top: node.layoutStyle.padding[0],
      right: node.layoutStyle.padding[1],
      bottom: node.layoutStyle.padding[2],
      left: node.layoutStyle.padding[3],
    };
    layout.alignItems = node.layoutStyle.alignItems ?? 'stretch';
    layout.justifyContent =
      node.layoutStyle.justifyContent === 'spaceBetween'
        ? 'space-between'
        : node.layoutStyle.justifyContent === 'spaceAround'
          ? 'space-around'
          : node.layoutStyle.justifyContent === 'spaceEvenly'
            ? 'space-evenly'
            : (node.layoutStyle.justifyContent ?? 'stretch');
    layout.width = { mode: 'hug', value: 0 };
    layout.height = { mode: 'hug', value: 0 };
  }

  if (node.w && node.w > 0) {
    layout.width = { mode: 'fixed', value: node.w };
  }
  if (node.h && node.h > 0) {
    layout.height = { mode: 'fixed', value: node.h };
  }

  return layout;
}

// ── Node Position Computation ──────────────────────────────────────────────────

function computeNodePosition(node: SceneNode): { x: number; y: number; w: number; h: number } {
  const tx = node.transform[4] ?? 0;
  const ty = node.transform[5] ?? 0;

  if (node.kind === 'shape') {
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return { x: tx + s.x, y: ty + s.y, w: s.w, h: s.h };
      case 'ellipse':
        return { x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
      case 'circle':
        return { x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 };
      case 'line':
      case 'arrow': {
        const minX = Math.min(s.from[0], s.to[0]);
        const minY = Math.min(s.from[1], s.to[1]);
        return {
          x: tx + minX,
          y: ty + minY,
          w: Math.abs(s.to[0] - s.from[0]) || 1,
          h: Math.abs(s.to[1] - s.from[1]) || 1,
        };
      }
      case 'polygon':
        return {
          x: tx + s.cx - s.radius,
          y: ty + s.cy - s.radius,
          w: s.radius * 2,
          h: s.radius * 2,
        };
      case 'star':
        return {
          x: tx + s.cx - s.outerRadius,
          y: ty + s.cy - s.outerRadius,
          w: s.outerRadius * 2,
          h: s.outerRadius * 2,
        };
      case 'path': {
        if (s.points.length === 0) return { x: tx, y: ty, w: 1, h: 1 };
        const xs = s.points.map((p) => p.x);
        const ys = s.points.map((p) => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        return {
          x: tx + minX,
          y: ty + minY,
          w: Math.max(...xs) - minX || 1,
          h: Math.max(...ys) - minY || 1,
        };
      }
    }
  }

  if (node.kind === 'text') {
    const fs = node.fontSize ?? 16;
    return { x: tx, y: ty, w: (node.text?.length ?? 0) * fs * 0.6, h: fs * 1.4 };
  }

  if (node.kind === 'frame') {
    const fn = node as FrameNode;
    return { x: tx, y: ty, w: fn.w ?? 200, h: fn.h ?? 160 };
  }

  return { x: tx, y: ty, w: 200, h: 160 };
}

function guessLayoutMode(node: SceneNode, children: string[], doc: Document): LayoutMode {
  if (node.kind === 'frame') {
    const fn = node as FrameNode;
    if (fn.layoutStyle?.gridTemplateColumns || fn.layoutStyle?.gridTemplateRows) return 'grid';
    if (fn.layoutStyle) return 'flex';
    if (children.length <= 1) return 'absolute';
    const positions = children
      .map((id) => doc.nodes[id])
      .filter((n): n is import('@varve/scene').SceneNode => n != null)
      .map((n) => ({
        x: n.transform[4] ?? 0,
      }));
    const xs = positions.map((p) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    if (maxX - minX > 50 && children.length > 1) return 'flow';
  }
  return 'absolute';
}

function buildPositionLayout(
  pos: { x: number; y: number; w: number; h: number },
  mode: LayoutMode,
): LayoutSpec['position'] {
  if (mode === 'absolute') {
    return { type: 'absolute', left: pos.x, top: pos.y };
  }
  return { type: 'static' };
}

// ── Flex Child Spec Builder ────────────────────────────────────────────────────

function buildFlexChildSpec(node: SceneNode): FlexChildSpec | undefined {
  const ls = (node as { layoutStyle?: Record<string, unknown> }).layoutStyle;
  if (!ls) return undefined;
  return {
    grow: (ls.grow as number) ?? 0,
    shrink: (ls.shrink as number) ?? 1,
    basis: 'auto',
  };
}

// ── Content Spec Builder ───────────────────────────────────────────────────────

function buildContentSpec(node: SceneNode): ContentSpec {
  if (node.kind === 'text') {
    const tn = node as TextNode;
    return {
      type: 'text',
      text: {
        value: tn.text || '',
        runs: tn.richText?.paragraphs.flatMap(
          (p) =>
            p.runs?.map((r) => ({
              text: r.text,
              style: {
                fontFamily: r.format?.fontFamily,
                fontSize: r.format?.fontSize,
                fontWeight: r.format?.fontWeight,
                lineHeight: r.format?.lineHeight,
                letterSpacing: r.format?.letterSpacing,
                decoration:
                  r.format?.textDecoration !== 'none' ? r.format?.textDecoration : undefined,
              },
            })) ?? [],
        ),
      },
    };
  }

  if (node.kind === 'shape' && isImageShape(node)) {
    const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
    if (imgFill?.image) {
      return {
        type: 'image',
        image: {
          src: imgFill.image.src,
          alt: node.name,
          fit:
            imgFill.image.fit === 'fill'
              ? 'cover'
              : imgFill.image.fit === 'fit'
                ? 'contain'
                : 'none',
          position: { x: 0, y: 0 },
          crop: imgFill.image.crop,
          focalPoint: (imgFill.image as unknown as Record<string, unknown>).focalPoint as
            | { x: number; y: number }
            | undefined,
        },
      };
    }
  }

  return { ...DEFAULT_CONTENT };
}

// ── Constraint Spec Builder ────────────────────────────────────────────────────

function buildConstraintSpec(node: SceneNode): ConstraintSpec {
  if (node.kind === 'frame' || node.kind === 'shape' || node.kind === 'text') {
    const cn = (node as { constraints?: ConstraintSpec }).constraints;
    if (cn) return cn;
  }
  return { ...DEFAULT_CONSTRAINT_SPEC };
}

// ── Accessibility Metadata Builder ─────────────────────────────────────────────

function buildAccessibilityMetadata(node: SceneNode, role: SemanticRole): AccessibilityMetadata {
  const metadata: AccessibilityMetadata = { ...DEFAULT_ACCESSIBILITY };

  const roleMap: Record<SemanticKind, string> = {
    button: 'button',
    link: 'link',
    navigation: 'navigation',
    header: 'banner',
    footer: 'contentinfo',
    main: 'main',
    aside: 'complementary',
    article: 'article',
    section: 'region',
    list: 'list',
    'list-item': 'listitem',
    input: 'textbox',
    dialog: 'dialog',
    tooltip: 'tooltip',
    progress: 'progressbar',
    container: 'group',
    text: 'text',
    image: 'img',
    icon: 'img',
    avatar: 'img',
    badge: 'status',
    card: 'group',
    code: 'code',
    quote: 'blockquote',
    figure: 'figure',
    divider: 'separator',
    skeleton: 'presentation',
    unknown: 'generic',
    form: 'form',
    search: 'search',
    banner: 'banner',
    table: 'table',
  };

  metadata.role = roleMap[role.primary] || 'generic';

  if (node.name && !node.name.match(/^(Rectangle|Ellipse|Frame|Group|Text)\s*\d*$/)) {
    metadata.label = node.name;
  }

  if (role.primary === 'button' || role.primary === 'link' || role.primary === 'input') {
    metadata.focusable = true;
    metadata.keyboardNavigable = true;
  }

  return metadata;
}

// ── Node Conversion ────────────────────────────────────────────────────────────

function convertToSemanticNode(
  nodeId: string,
  doc: Document,
  analysis: SceneAnalysisResult,
  context: InferenceContext,
): SemanticNode {
  const node = doc.nodes[nodeId];
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const role =
    analysis.semanticMap.get(nodeId) ||
    ({ primary: 'unknown', inferred: true, confidence: 0 } as SemanticRole);
  const baseLayout = analysis.layoutMap.get(nodeId) || { ...DEFAULT_LAYOUT_SPEC };
  const constraints = buildConstraintSpec(node);
  const pos = computeNodePosition(node);

  const children: NodeId[] =
    node.kind === 'frame' || node.kind === 'group'
      ? (node as { children?: NodeId[] }).children || []
      : [];
  const layoutMode =
    baseLayout.mode !== 'absolute' ? baseLayout.mode : guessLayoutMode(node, children, doc);

  const layout: LayoutSpec = {
    ...baseLayout,
    mode: layoutMode,
    width: pos.w > 0 ? { mode: 'fixed', value: pos.w } : { mode: 'hug', value: 0 },
    height: pos.h > 0 ? { mode: 'fixed', value: pos.h } : { mode: 'hug', value: 0 },
    position: buildPositionLayout(pos, layoutMode),
    flex: buildFlexChildSpec(node),
  };

  const appearance: AppearanceSpec = {
    ...DEFAULT_APPEARANCE_SPEC,
    background: buildFillSpec(node, doc.colorConfig?.defaultGradientInterpolation ?? 'oklab'),
    foreground: buildFillSpec(node, doc.colorConfig?.defaultGradientInterpolation ?? 'oklab'),
    strokes: buildStrokeSpec(node),
    border: buildBorderSpec(node),
    typography: buildTypographySpec(node),
    effects: buildEffectSpec(node),
    transform: buildTransformSpec(node),
    opacity: node.opacity ?? 1,
    blendMode: (node.blendMode ?? 'normal') as AppearanceSpec['blendMode'],
    borderRadius: buildBorderRadiusSpec(node),
    interactions: buildInteractionStateSpec(node),
    clipContent: node.kind === 'frame' ? ((node as FrameNode).clipContent ?? true) : undefined,
  };

  const content = buildContentSpec(node);
  const tokens = analysis.tokenMap.get(nodeId) || { ...DEFAULT_TOKEN_BINDINGS };
  const accessibility = buildAccessibilityMetadata(node, role);
  const componentRef = analysis.componentMap.get(nodeId);

  const childNodes: SemanticNode[] = [];
  const mask = resolveMask(node, doc);
  for (const childId of children) {
    if (mask?.hideMaskSource && mask.sourceNodeId === childId) continue;
    const childContext: InferenceContext = {
      ...context,
      parentRoles: [...context.parentRoles, role],
      depth: context.depth + 1,
    };
    childNodes.push(convertToSemanticNode(childId, doc, analysis, childContext));
  }

  const semanticNode: SemanticNode = {
    id: generateExportId(nodeId),
    kind: role.primary,
    name: node.name,
    role,
    accessibility,
    layout,
    constraints,
    appearance,
    tokens,
    content,
    component: componentRef,
    children: childNodes,
    metadata: {
      sourceNodeId: nodeId,
      exportId: generateExportId(nodeId),
      tags: [],
    },
    visible: node.visible !== false,
    locked: (node as { locked?: boolean }).locked ?? false,
  };

  return semanticNode;
}

export {
  buildAccessibilityMetadata,
  buildAutoLayoutSpec,
  buildBorderRadiusSpec,
  buildBorderSpec,
  buildConstraintSpec,
  buildContentSpec,
  buildEffectSpec,
  buildFillSpec,
  buildFlexChildSpec,
  buildInteractionStateSpec,
  buildLayoutSpec,
  buildPositionLayout,
  buildStrokeSpec,
  buildTransformSpec,
  buildTypographySpec,
  computeNodePosition,
  convertToSemanticNode,
  guessLayoutMode,
  managedColorToCss,
};
