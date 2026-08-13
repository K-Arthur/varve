// COMPLEXITY: 302 → 106 (buildIR=42, computeFlattenInfo=32, computeAdjustmentScope=36,
// suggestHtmlElement=18, collectFidelityWarnings=20, validateIR=14)
// Plan: extract flatten/adjustment/fidelity into ir-flatten.ts and ir-warnings.ts

import type { Document, Effect, SceneNode, TextNode } from '@varve/scene';
import { activePageNodes, getParent, isImageShape } from '@varve/scene';
import { convertToSemanticNode } from './ir-builders';
import {
  analyzeSceneForDesignIR,
  buildDocumentStructure,
  inferResponsiveBreakpoints,
  inferTokenLibrary,
} from './ir-inference';
import type {
  AdjustmentScopeInfo,
  DocumentMetadata,
  FidelityWarning,
  FlattenInfo,
  FlattenReason,
  HtmlElementHint,
  IRDocument,
  SemanticNode,
} from './ir-types';
import { DEFAULT_BREAKPOINTS } from './ir-types';
import { warpRequiresFlattening } from './warpBake';

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
  const strokes = (node as unknown as Record<string, unknown>).strokes as
    | Array<Record<string, unknown>>
    | undefined;
  return (strokes ?? []).filter((s) => s.visible !== false).length > 1;
}

function computeFlattenInfo(node: SceneNode, _doc: Document): FlattenInfo {
  const reasons: FlattenReason[] = [];

  if (node.kind === 'adjustment') reasons.push('adjustment-layer');

  if (node.kind === 'shape' && node.shape.kind !== 'rect') {
    reasons.push('non-rect-shape');
  }

  const effects = (node as { effects?: Effect[] }).effects ?? [];
  for (const e of effects) {
    if (e.mask) reasons.push('effect-mask');
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

  if (node.kind === 'adjustment') {
    const adj = node as import('@varve/scene').AdjustmentNode;
    for (const a of adj.adjustments ?? []) {
      const ak = (a as { kind?: string }).kind ?? (a as { type?: string }).type ?? '';
      if (ak === 'halftone') reasons.push('halftone');
      if (ak === 'lut') reasons.push('lut');
      if (ak === 'gradientMap') reasons.push('gradient-map');
    }
  }

  // No code target has an envelope/mesh primitive; emitting the source
  // geometry natively would silently drop the deformation.
  if (warpRequiresFlattening(node)) reasons.push('warp');

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

  const scope = (node as import('@varve/scene').AdjustmentNode).scope;
  const targetNodeIds: string[] = [];

  if (!scope) {
    const parentId = getParent(doc, node.id);
    const pn = parentId ? doc.nodes[parentId] : undefined;
    if (pn && pn.kind === 'frame') {
      const idx = pn.children.indexOf(node.id);
      if (idx > 0) targetNodeIds.push(pn.children[idx - 1]!);
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

  const adjustments = (node as import('@varve/scene').AdjustmentNode).adjustments ?? [];
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
    ].includes(a.kind),
  );
  const cssFilterValue = cssCompatible
    ? adjustments
        .map((a) => {
          switch (a.kind) {
            case 'brightness':
              return `brightness(${a.value})`;
            case 'contrast':
              return `contrast(${a.value})`;
            case 'saturation':
              return `saturate(${a.value})`;
            case 'hueRotate':
              return `hue-rotate(${a.value}deg)`;
            case 'blur':
              return `blur(${(a as import('@varve/engine').BlurAdjustment).radius}px)`;
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

function collectFidelityWarnings(node: SceneNode, _doc: Document): FidelityWarning[] {
  const warnings: FidelityWarning[] = [];
  const nodeId = node.id;

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
    const adj = node as import('@varve/scene').AdjustmentNode;
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
      ].includes((a as { kind?: string }).kind ?? (a as { type?: string }).type ?? ''),
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
  const analysis = analyzeSceneForDesignIR(doc);
  const tokens = inferTokenLibrary(doc);
  const nodes: Record<string, SemanticNode> = {};
  const rootIds: string[] = [];
  const fidelityWarnings: FidelityWarning[] = [];
  const htmlHints: Record<string, HtmlElementHint> = {};

  const pageRoots = activePageNodes(doc);
  const allRoots = [...new Set([...pageRoots, ...doc.rootChildren])];

  for (const rootId of allRoots) {
    const context = {
      parentRoles: [],
      siblingRoles: [],
      depth: 0,
      documentStructure: buildDocumentStructure(doc),
      siblings: [],
    };
    const semanticNode = convertToSemanticNode(rootId, doc, analysis, context);

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

      const sourceChildren = (srcNode && (srcNode as { children?: string[] }).children) ?? [];
      for (let i = 0; i < semNode.children.length && i < sourceChildren.length; i++) {
        const child = semNode.children[i]!;
        enrichNode(child, sourceChildren[i]!);
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

export type { IRDocument, SceneAnalysisResult, SemanticNode } from './ir-types';
