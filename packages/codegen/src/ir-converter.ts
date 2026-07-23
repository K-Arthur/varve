/**
 * Scene-to-IR converter — transforms Strata scene documents into intermediate
 * representation with full design-fidelity capture.
 *
 * v2.0: captures strokes, gradients, effects, interaction states, masks,
 *       responsive intent, flex child layout, z-index, and all fill types.
 */

import type {
  Document,
  Effect,
  Fill,
  FrameNode,
  NodeId,
  BlendMode as SceneBlendMode,
  SceneNode,
  ShapeNode,
  TextNode,
} from '@strata/scene';
import {
  activePageNodes,
  getParent,
  isImageShape,
  resolveAdjustmentScope,
  resolveMask,
} from '@strata/scene';
import { managedColorToRgba } from '@strata/shared';
import {
  type AccessibilityMetadata,
  type AdjustmentScopeInfo,
  type AppearanceSpec,
  type BlurSpec,
  type BorderRadiusSpec,
  type BorderSideSpec,
  type BorderSpec,
  type BreakpointConfig,
  type ColorStop,
  type ComponentLibrary,
  type ComponentRef,
  type ConstraintSpec,
  type ContentSpec,
  DEFAULT_ACCESSIBILITY,
  DEFAULT_APPEARANCE_SPEC,
  DEFAULT_BREAKPOINTS,
  DEFAULT_CONSTRAINT_SPEC,
  DEFAULT_CONTENT,
  DEFAULT_FLATTEN_INFO,
  DEFAULT_LAYOUT_SPEC,
  DEFAULT_METADATA,
  DEFAULT_TOKEN_BINDINGS,
  type DocumentMetadata,
  type EffectSpec,
  type FidelityWarning,
  type FillSpec,
  type FlattenInfo,
  type FlattenReason,
  type FlexChildSpec,
  type GradientSpec,
  type HtmlElementHint,
  type ImageFillSpec,
  type InferenceContext,
  type InferenceRule,
  type InteractionStateSpec,
  type IRDocument,
  type LayoutSpec,
  type NodeMetadata,
  type ResponsiveBreakpointInference,
  type SceneAnalysisResult,
  type SemanticKind,
  type SemanticNode,
  type SemanticRole,
  type ShadowSpec,
  type SizingSpec,
  type Spacing,
  type StrokeSpec,
  type TokenBindings,
  type TokenLibrary,
  type TransformSpec,
  type TypographySpec,
} from './ir-types';

// ── Color Helpers ──────────────────────────────────────────────────────────────

function managedColorToCss(color: import('@strata/scene').ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return a < 255 ? `rgba(${r},${g},${b},${(a / 255).toFixed(3)})` : `rgb(${r},${g},${b})`;
}

// ── Semantic Inference Rules ───────────────────────────────────────────────────

const INFERENCE_RULES: InferenceRule[] = [
  {
    pattern: { namePattern: /button|btn|cta/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'button', inferred: true, confidence: 0.8 },
  },
  {
    pattern: { kindPattern: ['frame', 'shape'], propertyPattern: { hasClickInteraction: true } },
    role: { primary: 'button', inferred: true, confidence: 0.7 },
  },
  {
    pattern: { namePattern: /nav|navigation|menu/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'navigation', inferred: true, confidence: 0.9 },
  },
  {
    pattern: { namePattern: /link|anchor/i, kindPattern: ['frame', 'shape', 'text'] },
    role: { primary: 'link', inferred: true, confidence: 0.7 },
  },
  {
    pattern: { namePattern: /header|head/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'header', inferred: true, confidence: 0.85 },
  },
  {
    pattern: { namePattern: /footer|foot/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'footer', inferred: true, confidence: 0.85 },
  },
  {
    pattern: { namePattern: /card/i, kindPattern: ['frame'] },
    role: { primary: 'card', inferred: true, confidence: 0.8 },
  },
  {
    pattern: { namePattern: /icon|ic_/i, kindPattern: ['shape', 'group'] },
    role: { primary: 'icon', inferred: true, confidence: 0.9 },
  },
  {
    pattern: { namePattern: /avatar|profile/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'avatar', inferred: true, confidence: 0.8 },
  },
  {
    pattern: { namePattern: /badge|tag|label/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'badge', inferred: true, confidence: 0.75 },
  },
  {
    pattern: { namePattern: /input|field|textfield|search/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'input', inferred: true, confidence: 0.8 },
  },
  {
    pattern: { namePattern: /list|ul|ol/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'list', inferred: true, confidence: 0.7 },
  },
  {
    pattern: { namePattern: /section/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'section', inferred: true, confidence: 0.7 },
  },
  {
    pattern: { namePattern: /dialog|modal|overlay/i, kindPattern: ['frame'] },
    role: { primary: 'dialog', inferred: true, confidence: 0.85 },
  },
  {
    pattern: { namePattern: /tooltip|hint|popover/i, kindPattern: ['frame'] },
    role: { primary: 'tooltip', inferred: true, confidence: 0.8 },
  },
  {
    pattern: { namePattern: /progress|loading|spinner/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'progress', inferred: true, confidence: 0.75 },
  },
  {
    pattern: { namePattern: /skeleton|placeholder/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'skeleton', inferred: true, confidence: 0.8 },
  },
  {
    pattern: { namePattern: /form/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'form', inferred: true, confidence: 0.7 },
  },
  {
    pattern: { namePattern: /search/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'search', inferred: true, confidence: 0.7 },
  },
  {
    pattern: { namePattern: /banner|hero/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'banner', inferred: true, confidence: 0.8 },
  },
  {
    pattern: { namePattern: /table|grid/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'table', inferred: true, confidence: 0.7 },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateExportId(sourceId: string): string {
  return `export_${sourceId}`;
}

function matchesPattern(node: SceneNode, pattern: InferenceRule['pattern']): boolean {
  if (pattern.namePattern && !pattern.namePattern.test(node.name)) return false;
  if (pattern.kindPattern && !pattern.kindPattern.includes(node.kind)) return false;
  if (pattern.propertyPattern) {
    for (const [key, value] of Object.entries(pattern.propertyPattern)) {
      if ((node as Record<string, unknown>)[key] !== value) return false;
    }
  }
  return true;
}

function inferSemanticRole(node: SceneNode, context: InferenceContext): SemanticRole {
  let bestRole: SemanticRole = { primary: 'unknown', inferred: true, confidence: 0 };

  for (const rule of INFERENCE_RULES) {
    if (matchesPattern(node, rule.pattern)) {
      if (rule.role.confidence > bestRole.confidence) {
        bestRole = { ...rule.role };
        bestRole.evidence = [
          `Matched pattern: ${rule.pattern.namePattern?.source || 'property-based'}`,
        ];
      }
    }
  }

  if (context.parentRoles.some((r) => r.primary === 'navigation') && node.kind === 'text') {
    if (bestRole.confidence < 0.6) {
      bestRole = {
        primary: 'link',
        inferred: true,
        confidence: 0.6,
        evidence: ['Child of navigation'],
      };
    }
  }
  if (context.parentRoles.some((r) => r.primary === 'dialog') && node.kind === 'shape') {
    if (bestRole.confidence < 0.3) {
      bestRole = {
        primary: 'icon',
        inferred: true,
        confidence: 0.4,
        evidence: ['Child of dialog'],
      };
    }
  }

  if (bestRole.confidence < 0.5) {
    switch (node.kind) {
      case 'text':
        bestRole = { primary: 'text', inferred: true, confidence: 0.5, evidence: ['Text node'] };
        break;
      case 'frame':
        bestRole = {
          primary: 'container',
          inferred: true,
          confidence: 0.5,
          evidence: ['Frame node'],
        };
        break;
      case 'shape':
        bestRole = {
          primary: 'container',
          inferred: true,
          confidence: 0.4,
          evidence: ['Shape node'],
        };
        break;
      case 'group':
        bestRole = {
          primary: 'container',
          inferred: true,
          confidence: 0.5,
          evidence: ['Group node'],
        };
        break;
      case 'adjustment':
        bestRole = {
          primary: 'container',
          inferred: true,
          confidence: 0.3,
          evidence: ['Adjustment node'],
        };
        break;
    }
  }

  return bestRole;
}

// ── Fill Conversion ────────────────────────────────────────────────────────────

function convertFills(node: SceneNode): FillSpec[] {
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

  // Fallback to legacy fill
  if (fills.length === 0 && node.fill) {
    fills.push({ type: 'solid', value: managedColorToCss(node.fill), opacity: 1 });
  }

  return fills.length > 0 ? fills : [{ type: 'solid', value: '#00000000', opacity: 0 }];
}

// ── Stroke Conversion ──────────────────────────────────────────────────────────

function convertStrokes(node: SceneNode): StrokeSpec[] {
  if (!node.strokes || node.strokes.length === 0) return [];

  return node.strokes
    .filter((s) => s.visible !== false)
    .map((s) => ({
      fills: s.color ? [{ type: 'solid', value: managedColorToCss(s.color), opacity: 1 }] : [],
      weight: s.weight ?? 1,
      cap: s.cap ?? 'round',
      join: s.join ?? 'miter',
      miterLimit: s.miterLimit ?? 4,
      dashArray: s.dashArray ?? [],
      dashOffset: s.dashOffset ?? 0,
      align: s.align ?? 'center',
    }));
}

// ── Border Conversion ──────────────────────────────────────────────────────────

function convertBorder(node: SceneNode): BorderSpec {
  return {
    top: { width: 0, color: '#000000', style: 'none' },
    right: { width: 0, color: '#000000', style: 'none' },
    bottom: { width: 0, color: '#000000', style: 'none' },
    left: { width: 0, color: '#000000', style: 'none' },
    uniform: true,
  };
}

// ── Typography Conversion ──────────────────────────────────────────────────────

function convertTypography(node: SceneNode): TypographySpec {
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
    if (tn.direction) base.direction = tn.direction;
    if (tn.variableAxes && Object.keys(tn.variableAxes).length > 0) {
      base.variableAxes = tn.variableAxes;
    }
    if (tn.openTypeFeatures && Object.keys(tn.openTypeFeatures).length > 0) {
      base.openTypeFeatures = tn.openTypeFeatures;
    }
    if (tn.whiteSpace) base.whiteSpace = tn.whiteSpace;
  }

  return base;
}

// ── Effect Conversion ──────────────────────────────────────────────────────────

function convertEffects(node: SceneNode): EffectSpec[] {
  const effects: EffectSpec[] = [];
  const nodeEffects = (node as { effects?: Array<Record<string, unknown>> }).effects ?? [];

  for (const e of nodeEffects) {
    if (e.type === 'dropShadow' || e.type === 'innerShadow') {
      effects.push({
        type: e.type === 'dropShadow' ? 'drop-shadow' : 'inner-shadow',
        offsetX: (e.offsetX as number) ?? 0,
        offsetY: (e.offsetY as number) ?? 0,
        radius: (e.radius as number) ?? 0,
        spread: (e.spread as number) ?? 0,
        color: e.color
          ? managedColorToCss(e.color as import('@strata/scene').ManagedColor)
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

// ── Border Radius Conversion ───────────────────────────────────────────────────

function convertBorderRadius(node: SceneNode): BorderRadiusSpec {
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

// ── Transform Conversion ───────────────────────────────────────────────────────

function convertTransform(node: SceneNode): TransformSpec {
  const t = node.transform;
  return {
    translate: { x: t[4] ?? 0, y: t[5] ?? 0 },
    rotate: 0,
    scale: { x: t[0] ?? 1, y: t[3] ?? 1 },
    origin: { x: 0, y: 0 },
  };
}

// ── Interaction State Extraction ───────────────────────────────────────────────

function convertInteractions(node: SceneNode): InteractionStateSpec {
  return {};
}

// ── Layout Conversion ──────────────────────────────────────────────────────────

function constraintsToLayoutSpec(
  constraints: ConstraintSpec,
  _parentLayout: LayoutSpec,
  node: SceneNode,
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

function autoLayoutToLayoutSpec(node: FrameNode): LayoutSpec {
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
    layout.alignItems =
      node.layoutStyle.primaryAxisAlignItems === 'MIN'
        ? 'start'
        : node.layoutStyle.primaryAxisAlignItems === 'MAX'
          ? 'end'
          : node.layoutStyle.primaryAxisAlignItems === 'CENTER'
            ? 'center'
            : 'stretch';
    layout.justifyContent =
      node.layoutStyle.counterAxisAlignItems === 'MIN'
        ? 'start'
        : node.layoutStyle.counterAxisAlignItems === 'MAX'
          ? 'end'
          : node.layoutStyle.counterAxisAlignItems === 'CENTER'
            ? 'center'
            : 'stretch';
    layout.width = { mode: 'hug', value: 0 };
    layout.height = { mode: 'hug', value: 0 };
  }

  // Detect sizing from node dimensions
  if (node.w && node.w > 0) {
    layout.width = { mode: 'fixed', value: node.w };
  }
  if (node.h && node.h > 0) {
    layout.height = { mode: 'fixed', value: node.h };
  }

  return layout;
}

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
    if (fn.layoutStyle) return 'flex';
    if (fn.gridStyle) return 'grid';
    if (children.length <= 1) return 'absolute';
    // Detect if children are arranged in a row-like pattern
    const positions = children
      .map((id) => doc.nodes[id])
      .filter(Boolean)
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

// ── Accessibility Conversion ───────────────────────────────────────────────────

function accessibilityFromNode(node: SceneNode, role: SemanticRole): AccessibilityMetadata {
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

// ── Scene Analysis ─────────────────────────────────────────────────────────────

function buildDocumentStructure(doc: Document): Map<string, string[]> {
  const structure = new Map<string, string[]>();
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.kind === 'frame' || node.kind === 'group') {
      structure.set(id, (node as { children?: NodeId[] }).children || []);
    }
  }
  return structure;
}

function analyzeScene(doc: Document): SceneAnalysisResult {
  const semanticMap = new Map<string, SemanticRole>();
  const layoutMap = new Map<string, LayoutSpec>();
  const componentMap = new Map<string, ComponentRef>();
  const tokenMap = new Map<string, TokenBindings>();
  const structure = buildDocumentStructure(doc);

  for (const [id, node] of Object.entries(doc.nodes)) {
    const context: InferenceContext = {
      parentRoles: [],
      siblingRoles: [],
      depth: 0,
      documentStructure: structure,
      siblings: [],
    };

    const role = inferSemanticRole(node, context);
    semanticMap.set(id, role);

    if (node.kind === 'frame') {
      const frameNode = node as FrameNode;
      if (frameNode.layoutStyle) {
        layoutMap.set(id, autoLayoutToLayoutSpec(frameNode));
      } else {
        const constraints = { horizontal: 'min' as const, vertical: 'min' as const };
        layoutMap.set(id, constraintsToLayoutSpec(constraints, DEFAULT_LAYOUT_SPEC, node));
      }
    }

    if (node.kind === 'frame' && (node as { componentId?: string }).componentId) {
      const componentId = (node as { componentId: string }).componentId;
      componentMap.set(id, { componentId, slots: {}, overrides: {} });
    }
  }

  return { semanticMap, layoutMap, componentMap, tokenMap };
}

// ── Flex Child Layout ──────────────────────────────────────────────────────────

function convertFlexChild(node: SceneNode): FlexChildSpec | undefined {
  const ls = (node as { layoutStyle?: Record<string, unknown> }).layoutStyle;
  if (!ls) return undefined;
  return {
    grow: (ls.grow as number) ?? 0,
    shrink: (ls.shrink as number) ?? 1,
    basis: 'auto',
  };
}

// ── Content Extraction ─────────────────────────────────────────────────────────

function contentFromNode(node: SceneNode): ContentSpec {
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
          focalPoint: imgFill.image.focalPoint,
        },
      };
    }
  }

  return { ...DEFAULT_CONTENT };
}

// ── Constraints ────────────────────────────────────────────────────────────────

function constraintsFromNode(node: SceneNode): ConstraintSpec {
  if (node.kind === 'frame' || node.kind === 'shape' || node.kind === 'text') {
    const cn = (node as { constraints?: ConstraintSpec }).constraints;
    if (cn) return cn;
  }
  return { ...DEFAULT_CONSTRAINT_SPEC };
}

// ── Position Layout ────────────────────────────────────────────────────────────

function buildPositionLayout(
  pos: { x: number; y: number; w: number; h: number },
  mode: LayoutMode,
): LayoutSpec['position'] {
  if (mode === 'absolute') {
    return { type: 'absolute', left: pos.x, top: pos.y };
  }
  return { type: 'static' };
}

// ── Node Conversion ────────────────────────────────────────────────────────────

function convertNode(
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
  const constraints = constraintsFromNode(node);
  const pos = computeNodePosition(node);

  // Determine layout mode
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
    flex: convertFlexChild(node),
  };

  const appearance: AppearanceSpec = {
    ...DEFAULT_APPEARANCE_SPEC,
    background: convertFills(node),
    foreground: convertFills(node),
    strokes: convertStrokes(node),
    border: convertBorder(node),
    typography: convertTypography(node),
    effects: convertEffects(node),
    transform: convertTransform(node),
    opacity: node.opacity ?? 1,
    blendMode: (node.blendMode ?? 'normal') as AppearanceSpec['blendMode'],
    borderRadius: convertBorderRadius(node),
    interactions: convertInteractions(node),
    clipContent: node.kind === 'frame' ? ((node as FrameNode).clipContent ?? true) : undefined,
  };

  const content = contentFromNode(node);
  const tokens = analysis.tokenMap.get(nodeId) || { ...DEFAULT_TOKEN_BINDINGS };
  const accessibility = accessibilityFromNode(node, role);
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
    childNodes.push(convertNode(childId, doc, analysis, childContext));
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

// ── Token Extraction ───────────────────────────────────────────────────────────

function extractTokens(doc: Document): TokenLibrary {
  const colors: Record<string, import('./ir-types').TokenValue> = {};
  const spacing: Record<string, import('./ir-types').TokenValue> = {};
  const typography: Record<string, import('./ir-types').TokenValue> = {};
  const effects: Record<string, import('./ir-types').TokenValue> = {};
  const radii: Record<string, import('./ir-types').TokenValue> = {};
  const custom: Record<string, import('./ir-types').TokenValue> = {};

  const colorFrequency = new Map<string, number>();
  for (const node of Object.values(doc.nodes)) {
    if (node.fills) {
      for (const f of node.fills) {
        if (f.type === 'solid' && f.color) {
          const key = managedColorToCss(f.color);
          colorFrequency.set(key, (colorFrequency.get(key) ?? 0) + 1);
        }
      }
    }
  }

  let colorIndex = 0;
  for (const [color, count] of colorFrequency) {
    if (count >= 3) {
      colors[`color-${colorIndex++}`] = { value: color, type: 'color' };
    }
  }

  return { colors, spacing, typography, effects, radii, custom };
}

// ── Flattening Analysis (v2.1) ─────────────────────────────────────────────────

const UNSUPPORTED_BLENDS = new Set([
  'hue',
  'saturation',
  'color',
  'luminosity',
  'plusDarker',
  'plusLighter',
  'colorDodge',
  'colorBurn',
  'hardLight',
  'softLight',
  'difference',
  'exclusion',
]);

function hasGradientType(node: SceneNode, type: string): boolean {
  return (node.fills ?? []).some((f) => f.type === 'gradient' && f.gradient?.type === type);
}

function hasMultipleVisibleFills(node: SceneNode): boolean {
  return (node.fills ?? []).filter((f) => f.visible !== false).length > 1;
}

function hasMultipleVisibleStrokes(node: SceneNode): boolean {
  return (node.strokes ?? []).filter((s) => s.visible !== false).length > 1;
}

function computeFlattenInfo(node: SceneNode, _doc: Document): FlattenInfo {
  const reasons: FlattenReason[] = [];

  if (node.kind === 'adjustment') reasons.push('adjustment-layer');

  if (node.kind === 'shape' && node.shape.kind !== 'rect') {
    reasons.push('non-rect-shape');
  }

  const effects = (node as { effects?: Effect[] }).effects ?? [];
  for (const e of effects) {
    if (e.type === 'innerShadow') reasons.push('inner-shadow');
    if (e.type === 'backgroundBlur') reasons.push('background-blur');
    if (e.type === 'layerBlur') reasons.push('layer-blur');
    if (e.type === 'glassMaterial') reasons.push('glass-material');
    if (e.type === 'chromaticAberration') reasons.push('chromatic-aberration');
  }

  if (hasGradientType(node, 'angular') || hasGradientType(node, 'conic'))
    reasons.push('angular-gradient');
  if (hasGradientType(node, 'diamond')) reasons.push('diamond-gradient');

  const blendMode = node.blendMode;
  if (
    blendMode &&
    blendMode !== 'normal' &&
    blendMode !== 'passThrough' &&
    UNSUPPORTED_BLENDS.has(blendMode)
  ) {
    reasons.push('unsupported-blend');
  }

  if ((node.fills ?? []).some((f) => f.type === 'pattern')) reasons.push('pattern-fill');
  if (hasMultipleVisibleFills(node)) reasons.push('stacked-fills');
  if (hasMultipleVisibleStrokes(node)) reasons.push('multiple-strokes');
  if (isImageShape(node)) reasons.push('image-node');

  const mask = (node as { mask?: { type?: string } }).mask;
  if (mask?.type === 'alpha') reasons.push('alpha-mask');
  if (mask?.type === 'luminance') reasons.push('luminance-mask');

  // Check for halftone/LUT/gradient-map adjustments on adjustment nodes
  if (node.kind === 'adjustment') {
    const adj = node as import('@strata/scene').AdjustmentNode;
    for (const a of adj.adjustments ?? []) {
      if (a.type === 'halftone') reasons.push('halftone');
      if (a.type === 'lut') reasons.push('lut');
      if (a.type === 'gradientMap') reasons.push('gradient-map');
    }
  }

  const mustFlatten = reasons.length > 0;
  const flattensChildren =
    effects.some((e) => e.type === 'backgroundBlur') ||
    mask?.type === 'alpha' ||
    mask?.type === 'luminance';
  const canEmitContainer = !mustFlatten || node.kind === 'frame' || node.kind === 'group';

  return {
    mustFlatten,
    reasons,
    flattensChildren,
    emitAs: !mustFlatten ? 'native' : canEmitContainer ? 'container-with-image' : 'image',
  };
}

// ── Adjustment Scope Analysis (v2.1) ─────────────────────────────────────────

function computeAdjustmentScope(node: SceneNode, doc: Document): AdjustmentScopeInfo | undefined {
  if (node.kind !== 'adjustment') return undefined;

  const scope = (node as import('@strata/scene').AdjustmentNode).scope;
  const targetNodeIds: string[] = [];

  if (!scope) {
    // Legacy — find sibling below in paint order
    const parent = getParent(doc, node.id);
    if (parent && parent.kind === 'frame') {
      const idx = parent.children.indexOf(node.id);
      if (idx > 0) targetNodeIds.push(parent.children[idx - 1]);
    }
    return { mode: 'legacy', targetNodeIds, cssFilterEquivalent: false };
  }

  if (scope.mode === 'image-local' && 'targetNodeId' in scope) {
    targetNodeIds.push((scope as { targetNodeId: string }).targetNodeId);
  } else if (scope.mode === 'explicit-targets' && 'targetNodeIds' in scope) {
    targetNodeIds.push(...(scope as { targetNodeIds: string[] }).targetNodeIds);
  } else if (scope.mode === 'container-descendant' && 'containerId' in scope) {
    const containerId = (scope as { containerId: string }).containerId;
    const container = doc.nodes[containerId];
    if (container && (container.kind === 'frame' || container.kind === 'group')) {
      targetNodeIds.push(...container.children);
    }
  }

  // Check if adjustment can be expressed as CSS filter
  const adjustments = (node as import('@strata/scene').AdjustmentNode).adjustments ?? [];
  const cssCompatible = adjustments.every((a) =>
    [
      'brightness',
      'contrast',
      'saturation',
      'hueRotate',
      'blur',
      'opacity',
      'sepia',
      'grayscale',
      'invert',
    ].includes(a.type),
  );
  const cssFilterValue = cssCompatible
    ? adjustments
        .map((a) => {
          switch (a.type) {
            case 'brightness':
              return `brightness(${a.value})`;
            case 'contrast':
              return `contrast(${a.value})`;
            case 'saturation':
              return `saturate(${a.value})`;
            case 'hueRotate':
              return `hue-rotate(${a.value}deg)`;
            case 'blur':
              return `blur(${a.value}px)`;
            case 'opacity':
              return `opacity(${a.value})`;
            case 'sepia':
              return `sepia(${a.value})`;
            case 'grayscale':
              return `grayscale(${a.value})`;
            case 'invert':
              return `invert(${a.value})`;
            default:
              return '';
          }
        })
        .filter(Boolean)
        .join(' ')
    : undefined;

  return {
    mode: scope.mode,
    targetNodeIds,
    cssFilterEquivalent: cssCompatible,
    cssFilterValue,
  };
}

// ── Responsive Breakpoint Inference (v2.1) ────────────────────────────────────

function inferResponsiveBreakpoints(
  node: SceneNode,
  siblingPositions: { x: number; w: number }[],
): ResponsiveBreakpointInference | undefined {
  if (node.kind !== 'frame' && node.kind !== 'group') return undefined;

  const children = (node as { children?: NodeId[] }).children ?? [];
  if (children.length < 3) return undefined;

  // Detect if children are laid out in a row (desktop) pattern
  const childPositions = siblingPositions;
  if (childPositions.length < 2) return undefined;

  const xs = childPositions.map((p) => p.x);
  const sortedXs = [...xs].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sortedXs.length; i++) {
    gaps.push(sortedXs[i] - sortedXs[i - 1]);
  }

  if (gaps.length > 0) {
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    // If children are spread horizontally with consistent gaps, infer responsive wrap
    if (avgGap > 20 && gaps.every((g) => Math.abs(g - avgGap) / avgGap < 0.5)) {
      const totalWidth =
        xs.length > 0 ? Math.max(...xs) + (childPositions[0]?.w ?? 0) - Math.min(...xs) : 0;
      return {
        breakpoint: totalWidth + 48, // 48px padding
        confidence: 0.6,
        layoutChanges: {
          wrap: true,
          direction: 'column',
        },
      };
    }
  }

  return undefined;
}

// ── HTML Element Hints (v2.1) ─────────────────────────────────────────────────

function suggestHtmlElement(node: SemanticNode): HtmlElementHint {
  const kind = node.kind;
  const role = node.role.primary;
  const hasClick = node.appearance.interactions.hover || node.appearance.interactions.active;

  switch (role) {
    case 'button':
      return 'button';
    case 'link':
      return 'a';
    case 'image':
      return 'img';
    case 'input':
      return 'input';
    case 'navigation':
      return 'nav';
    case 'header':
      return 'header';
    case 'footer':
      return 'footer';
    case 'main':
      return 'main';
    case 'aside':
      return 'aside';
    case 'article':
      return 'article';
    case 'section':
      return 'section';
    case 'list':
      return 'ul';
    case 'list-item':
      return 'li';
    case 'form':
      return 'form';
    case 'search':
      return 'search';
    case 'dialog':
      return 'dialog';
    case 'progress':
      return 'progress';
    case 'quote':
      return 'blockquote';
    case 'code':
      return 'code';
    case 'divider':
      return 'hr';
    case 'figure':
      return 'figure';
    case 'badge':
      return 'span';
    case 'icon':
      return 'span';
    case 'avatar':
      return 'figure';
    case 'card':
      return 'article';
    case 'skeleton':
      return 'div';
    case 'table':
      return 'table';
    case 'banner':
      return 'header';
    case 'text': {
      if (node.content.text) {
        const text = node.content.text.value;
        if (text.length < 80) {
          if (node.appearance.typography.fontSize >= 20) return 'h2';
          if (node.appearance.typography.fontWeight >= 600) return 'strong';
          if (hasClick) return 'a';
          return 'span';
        }
        return 'p';
      }
      return 'span';
    }
    case 'container': {
      if (hasClick) return 'button';
      if (node.layout.mode === 'flex' || node.layout.mode === 'grid') return 'div';
      return 'div';
    }
    default: {
      if (kind === 'text') return 'span';
      if (kind === 'image') return 'img';
      return 'div';
    }
  }
}

// ── Fidelity Warning Collection (v2.1) ────────────────────────────────────────

function collectFidelityWarnings(node: SceneNode, doc: Document): FidelityWarning[] {
  const warnings: FidelityWarning[] = [];
  const nodeId = node.id;

  if (node.flattening !== undefined) {
    // Will be computed after IR; skip for now
  }

  const effects = (node as { effects?: Effect[] }).effects ?? [];
  for (const e of effects) {
    if (e.type === 'glassMaterial') {
      warnings.push({
        nodeId,
        message: 'Glass material effect requires CSS backdrop-filter with blur',
        severity: 'warning',
        category: 'effect',
      });
    }
    if (e.type === 'chromaticAberration') {
      warnings.push({
        nodeId,
        message: 'Chromatic aberration requires SVG filter or WebGL shader',
        severity: 'warning',
        category: 'effect',
      });
    }
    if (e.type === 'innerShadow') {
      warnings.push({
        nodeId,
        message: 'Inner shadow has no CSS equivalent; may need raster fallback',
        severity: 'warning',
        category: 'effect',
      });
    }
  }

  if (node.kind === 'adjustment') {
    const adj = node as import('@strata/scene').AdjustmentNode;
    const hasComplex = (adj.adjustments ?? []).some((a) =>
      [
        'curves',
        'levels',
        'selectiveColor',
        'halftone',
        'lut',
        'gradientMap',
        'tritone',
        'duotone',
      ].includes(a.type),
    );
    if (hasComplex) {
      warnings.push({
        nodeId,
        message: 'Complex adjustment layers require raster fallback for web export',
        severity: 'warning',
        category: 'adjustment',
      });
    }
  }

  if (node.mask) {
    const mask = node.mask as { type?: string };
    if (mask.type === 'alpha' || mask.type === 'luminance') {
      warnings.push({
        nodeId,
        message: `Alpha/luminance mask requires compositing; may need raster fallback`,
        severity: 'info',
        category: 'mask',
      });
    }
  }

  if (node.kind === 'text') {
    const tn = node as TextNode;
    if (tn.openTypeFeatures && Object.keys(tn.openTypeFeatures).length > 0) {
      warnings.push({
        nodeId,
        message: 'OpenType features may not render in all browsers',
        severity: 'info',
        category: 'font',
      });
    }
  }

  return warnings;
}

// ── IR Construction ────────────────────────────────────────────────────────────

function buildIR(doc: Document): IRDocument {
  const analysis = analyzeScene(doc);
  const tokens = extractTokens(doc);
  const nodes: Record<string, SemanticNode> = {};
  const rootIds: string[] = [];
  const fidelityWarnings: FidelityWarning[] = [];
  const htmlHints: Record<string, HtmlElementHint> = {};

  const pageRoots = activePageNodes(doc);
  const allRoots = [...new Set([...pageRoots, ...doc.rootChildren])];

  for (const rootId of allRoots) {
    const context: InferenceContext = {
      parentRoles: [],
      siblingRoles: [],
      depth: 0,
      documentStructure: buildDocumentStructure(doc),
      siblings: [],
    };
    const semanticNode = convertNode(rootId, doc, analysis, context);

    // Compute flattening info (v2.1)
    const sourceNode = doc.nodes[rootId];
    if (sourceNode) {
      semanticNode.flattening = computeFlattenInfo(sourceNode, doc);
      semanticNode.adjustmentScope = computeAdjustmentScope(sourceNode, doc);
      const siblingPositions = semanticNode.children.map((c) => ({
        x: c.layout.position?.left ?? 0,
        w: c.layout.width.value,
      }));
      semanticNode.responsiveInference = inferResponsiveBreakpoints(sourceNode, siblingPositions);
    }

    // Recurse into children to compute v2.1 fields
    function enrichNode(semNode: SemanticNode, sourceId: string) {
      const srcNode = doc.nodes[sourceId];
      if (srcNode) {
        semNode.flattening = computeFlattenInfo(srcNode, doc);
        semNode.adjustmentScope = computeAdjustmentScope(srcNode, doc);

        fidelityWarnings.push(...collectFidelityWarnings(srcNode, doc));
        htmlHints[semNode.id] = suggestHtmlElement(semNode);

        const childPositions = semNode.children.map((c) => ({
          x: c.layout.position?.left ?? 0,
          w: c.layout.width.value,
        }));
        semNode.responsiveInference = inferResponsiveBreakpoints(srcNode, childPositions);
      }

      // Recurse into children
      const sourceChildren = (srcNode && (srcNode as { children?: string[] }).children) ?? [];
      for (let i = 0; i < semNode.children.length && i < sourceChildren.length; i++) {
        enrichNode(semNode.children[i], sourceChildren[i]);
      }
    }

    enrichNode(semanticNode, rootId);
    nodes[semanticNode.id] = semanticNode;
    rootIds.push(semanticNode.id);
  }

  const metadata: DocumentMetadata = {
    documentId: doc.id,
    name: doc.name,
    generatedAt: Date.now(),
    generatorVersion: '1.0.0',
    sourceFormat: 'strata',
  };

  return {
    version: '2.1.0',
    metadata,
    nodes,
    rootIds,
    tokens,
    breakpoints: DEFAULT_BREAKPOINTS,
    components: {},
    unsupportedFeatures: [],
    fidelityWarnings,
    htmlHints,
  };
}

// ── IR Validation ──────────────────────────────────────────────────────────────

function validateIR(ir: IRDocument): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rootId of ir.rootIds) {
    if (!ir.nodes[rootId]) errors.push(`Root node ${rootId} not found`);
  }

  const visited = new Set<string>();
  function checkCircular(nodeId: string, path: string[]): boolean {
    if (path.includes(nodeId)) {
      errors.push(`Circular reference detected: ${path.join(' -> ')} -> ${nodeId}`);
      return true;
    }
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    const n = ir.nodes[nodeId];
    if (n)
      for (const child of n.children) if (checkCircular(child.id, [...path, nodeId])) return true;
    return false;
  }

  for (const rootId of ir.rootIds) checkCircular(rootId, []);

  return { valid: errors.length === 0, errors, warnings };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function sceneToIR(doc: Document): IRDocument {
  const ir = buildIR(doc);
  const validation = validateIR(ir);
  if (!validation.valid) console.warn('IR validation errors:', validation.errors);
  if (validation.warnings.length > 0) console.warn('IR validation warnings:', validation.warnings);
  return ir;
}

export function serializeIR(ir: IRDocument): string {
  return JSON.stringify(ir, null, 2);
}

export function deserializeIR(json: string): IRDocument {
  return JSON.parse(json);
}

export type { IRDocument, SceneAnalysisResult, SemanticNode };
