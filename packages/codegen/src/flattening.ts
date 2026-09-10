/**
 * Flattening analysis for code generation — detects nodes that require
 * raster fallback in web-target formats (HTML/CSS/Vue/Svelte/WebC).
 *
 * v2.1: Uses IR flattening types, provides per-target capability checks.
 */

import type { Document, Effect, SceneNode } from '@varve/scene';
import { isImageShape } from '@varve/scene';
import type { FlattenInfo, FlattenReason } from './ir-types';
import { warpRequiresFlattening } from './warpBake';

export type { FlattenInfo, FlattenReason };

export type EmitStrategy = 'native' | 'image' | 'container-with-image';

export interface FlattenedNodeSpec {
  nodeId: string;
  nodeName: string;
  mustFlatten: boolean;
  reasons: FlattenReason[];
  canEmitContainer: boolean;
  flattensChildren: boolean;
}

export interface FlatteningAnalysis {
  nodes: Map<string, FlattenedNodeSpec>;
  nodesNeedingRaster: string[];
  totalNodes: number;
  nativeNodes: number;
  flattenedNodes: number;
}

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

function hasMultipleStrokes(node: SceneNode): boolean {
  return (
    ((node as { strokes?: import('@varve/scene').Stroke[] }).strokes ?? []).filter(
      (s: import('@varve/scene').Stroke) => s.visible !== false,
    ).length > 1
  );
}

function hasInnerShadow(node: SceneNode): boolean {
  return ((node as { effects?: Effect[] }).effects ?? []).some((e) => e.type === 'innerShadow');
}

function hasBackgroundBlur(node: SceneNode): boolean {
  return ((node as { effects?: Effect[] }).effects ?? []).some((e) => e.type === 'backgroundBlur');
}

function hasLayerBlur(node: SceneNode): boolean {
  return ((node as { effects?: Effect[] }).effects ?? []).some((e) => e.type === 'layerBlur');
}

function hasAlphaMask(node: SceneNode, doc: Document): boolean {
  const mask = (node as { mask?: { type?: string } }).mask;
  if (!mask) return false;
  const resolved = doc.nodes[node.id] as { mask?: { type?: string } } | undefined;
  return resolved?.mask?.type === 'alpha' || resolved?.mask?.type === 'luminance';
}

function hasUnsupportedBlend(node: SceneNode): boolean {
  const blend = node.blendMode;
  return (
    blend !== undefined &&
    blend !== 'normal' &&
    blend !== 'passThrough' &&
    UNSUPPORTED_BLENDS.has(blend)
  );
}

function hasPatternFill(node: SceneNode): boolean {
  return (node.fills ?? []).some((f) => f.type === 'pattern');
}

function hasNonRectShape(node: SceneNode): boolean {
  if (node.kind !== 'shape') return false;
  return node.shape.kind !== 'rect';
}

export function analyzeNodeFlattening(
  node: SceneNode,
  doc: Document,
  parentSpec?: FlattenedNodeSpec,
): FlattenedNodeSpec {
  const reasons: FlattenReason[] = [];

  if (node.kind === 'adjustment') reasons.push('adjustment-layer');
  if (hasNonRectShape(node)) reasons.push('non-rect-shape');
  if (hasInnerShadow(node)) reasons.push('inner-shadow');
  if (hasBackgroundBlur(node)) reasons.push('background-blur');
  if (hasLayerBlur(node)) reasons.push('layer-blur');
  if (hasAlphaMask(node, doc)) reasons.push('alpha-mask');
  if (hasGradientType(node, 'angular')) reasons.push('angular-gradient');
  if (hasGradientType(node, 'diamond')) reasons.push('diamond-gradient');
  if (hasGradientType(node, 'conic')) reasons.push('angular-gradient');
  if (hasUnsupportedBlend(node)) reasons.push('unsupported-blend');
  if (hasPatternFill(node)) reasons.push('pattern-fill');
  if (hasMultipleVisibleFills(node)) reasons.push('stacked-fills');
  if (hasMultipleStrokes(node)) reasons.push('multiple-strokes');
  if (isImageShape(node)) reasons.push('image-node');
  if (warpRequiresFlattening(node)) reasons.push('warp');

  const effects = (node as { effects?: Effect[] }).effects ?? [];
  if (effects.some((e) => e.type === 'glassMaterial')) reasons.push('glass-material');
  if (effects.some((e) => e.type === 'chromaticAberration')) reasons.push('chromatic-aberration');

  if (parentSpec?.flattensChildren) {
    if (!reasons.includes('adjustment-layer')) reasons.push('adjustment-layer');
  }

  const mustFlatten = reasons.length > 0;
  const flattensChildren = hasBackgroundBlur(node) || hasAlphaMask(node, doc);
  const canEmitContainer = !mustFlatten || node.kind === 'frame' || node.kind === 'group';

  return {
    nodeId: node.id,
    nodeName: node.name,
    mustFlatten,
    reasons,
    canEmitContainer,
    flattensChildren,
  };
}

export function analyzeFlattening(rootNodes: SceneNode[], doc: Document): FlatteningAnalysis {
  const nodes = new Map<string, FlattenedNodeSpec>();
  const nodesNeedingRaster: string[] = [];

  function walk(node: SceneNode, parentSpec?: FlattenedNodeSpec) {
    const spec = analyzeNodeFlattening(node, doc, parentSpec);
    nodes.set(node.id, spec);
    if (spec.mustFlatten) nodesNeedingRaster.push(node.id);

    if ((node.kind === 'frame' || node.kind === 'group') && node.children) {
      for (const childId of node.children) {
        const child = doc.nodes[childId];
        if (child) walk(child, spec);
      }
    }
  }

  for (const node of rootNodes) {
    walk(node);
  }

  return {
    nodes,
    nodesNeedingRaster,
    totalNodes: nodes.size,
    nativeNodes: nodes.size - nodesNeedingRaster.length,
    flattenedNodes: nodesNeedingRaster.length,
  };
}

/** Reasons that CSS can handle natively (no raster fallback needed). */
const CSS_REPRESENTABLE_REASONS: Set<FlattenReason> = new Set([
  'image-node',
  'stacked-fills',
  'multiple-strokes',
  'inner-shadow',
  'layer-blur',
]);

export function canEmitAsHtml(
  node: SceneNode,
  doc: Document,
): {
  canEmit: boolean;
  reasons: FlattenReason[];
  emitAs: EmitStrategy;
} {
  const spec = analyzeNodeFlattening(node, doc);

  if (!spec.mustFlatten) {
    return { canEmit: true, reasons: [], emitAs: 'native' };
  }

  // If ALL reasons are CSS-representable, emit natively
  const allCssRepresentable = spec.reasons.every((r) => CSS_REPRESENTABLE_REASONS.has(r));
  if (allCssRepresentable) {
    return { canEmit: true, reasons: spec.reasons, emitAs: 'native' };
  }

  // Adjustment layers and background blur truly need raster fallback
  if (spec.reasons.includes('adjustment-layer') || spec.reasons.includes('background-blur')) {
    return { canEmit: false, reasons: spec.reasons, emitAs: 'image' };
  }

  // Containers with complex effects can hold a raster image background
  if (spec.canEmitContainer) {
    return { canEmit: true, reasons: spec.reasons, emitAs: 'container-with-image' };
  }

  return { canEmit: false, reasons: spec.reasons, emitAs: 'image' };
}

export function blendModeToCss(blendMode?: string): string | undefined {
  const map: Record<string, string> = {
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    darken: 'darken',
    lighten: 'lighten',
    colorDodge: 'color-dodge',
    colorBurn: 'color-burn',
    hardLight: 'hard-light',
    softLight: 'soft-light',
    difference: 'difference',
    exclusion: 'exclusion',
    hue: 'hue',
    saturation: 'saturation',
    color: 'color',
    luminosity: 'luminosity',
    plusDarker: 'plus-darker',
    plusLighter: 'plus-lighter',
  };
  return blendMode ? map[blendMode] : undefined;
}

/** Determine if a renderer is capable of handling a node natively. */
export type RenderCapability = 'full' | 'partial' | 'raster-required';

export function getRenderCapability(
  node: SceneNode,
  doc: Document,
): {
  capability: RenderCapability;
  reasons: FlattenReason[];
} {
  const spec = analyzeNodeFlattening(node, doc);
  if (!spec.mustFlatten) return { capability: 'full', reasons: [] };
  if (spec.canEmitContainer) return { capability: 'partial', reasons: spec.reasons };
  return { capability: 'raster-required', reasons: spec.reasons };
}

/** Get the HTML element tag appropriate for a node's emit strategy. */
export function getEmitTag(strategy: EmitStrategy, nodeKind: string): string {
  if (strategy === 'image') return 'img';
  if (strategy === 'container-with-image') return 'div';
  if (nodeKind === 'text') return 'span';
  if (nodeKind === 'frame' || nodeKind === 'group') return 'div';
  if (nodeKind === 'shape') return 'div';
  if (nodeKind === 'adjustment') return 'div';
  return 'div';
}
