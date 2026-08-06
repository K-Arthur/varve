/**
 * Canonical scene-model to render-engine conversion.
 *
 * Every live, worker, motion, thumbnail, and export path must use this module
 * so the strict native/WASM wire contract cannot drift from browser preview.
 * Text is intentionally represented both by top-level compatibility fields
 * and by the required `shape: { kind: 'text', ... }` payload.
 *
 * Research basis: Strata ADR-0001 IR replay; WHATWG Canvas 2D text model;
 * scene-graph local-to-world transform composition.
 */

import {
  adjustmentsToFilters,
  applyStyleOverrides,
  type SceneNode as EngineNode,
} from '@varve/engine';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import {
  applyBindingsToNode,
  buildAllVariantCaches,
  createVariableStore,
  getEffectiveNode,
  resolveAllStyles,
  resolveNodePaints,
  resolveRasterMaskAsset,
} from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY } from '@varve/shared';
import { maskRenderUrl } from '../backgroundRemoval/maskRenderCache';
import { nodeWorldTransform } from '../scene/world';
import { compileTableToEngineNode } from './tableCompile';

export interface SceneNodeConversionOptions {
  /** Preview-only bypass for comparing a background-removal source image. */
  showOriginalBackgroundNodeId?: string | null;
  /** Use the bounded interactive proxy while preserving full-resolution exports. */
  useMaskRenderProxy?: boolean;
}

/**
 * Resolve a node's effective paints by following paintRefs into the document.
 * Returns the original node with paints resolved into fills, so downstream
 * code (which reads fills/fill) doesn't need to know about paintRefs.
 */
function resolvePaintRefs(
  node: SceneNode,
  doc?: { paints?: Record<string, import('@varve/scene').Paint> },
): SceneNode {
  if (!node.paintRefs || node.paintRefs.length === 0 || !doc?.paints) return node;
  const resolvedFills = resolveNodePaints(
    node as unknown as Parameters<typeof resolveNodePaints>[0],
    doc,
  );
  if (resolvedFills.length > 0) {
    return { ...node, fills: resolvedFills } as SceneNode;
  }
  return node;
}

export function sceneNodeToEngineNode(
  node: SceneNode,
  options: SceneNodeConversionOptions = {},
  doc?: Pick<Document, 'paints' | 'rasterMaskAssets'>,
): EngineNode {
  // Resolve paintRefs → paints → fills before converting
  const resolvedNode = resolvePaintRefs(node, doc);
  const base = {
    id: node.id,
    name: node.name,
    fill: resolvedNode.fill,
    fills: resolvedNode.fills,
    transform: node.transform,
    opacity: node.opacity ?? 1,
    blendMode: node.blendMode ?? ('normal' as const),
    rotation: node.rotation ?? 0,
    strokes: 'strokes' in node ? (node.strokes ?? []) : [],
    effects: 'effects' in node ? (node.effects ?? []) : [],
  };

  if (node.kind === 'shape') {
    // V1.8+: shapeless nodes get shapeless flag propagated to the engine
    // Live trace: the node's `shape` field is already set to the resolved
    // traced geometry when resolution succeeds, or kept as the fallback rect
    // when pending. The `liveTrace` state on the scene node is only used to
    // track the trace link and parameter state; the engine always reads the
    // shape directly, so no special case is needed here.
    const shapeless = 'shapeless' in node && node.shapeless === true;
    const nativeRasterMask = doc ? resolveRasterMaskAsset(doc, node) : null;
    const alphaMask = nativeRasterMask?.dataUrl ?? node.backgroundRemoval?.maskDataUrl;
    return {
      ...base,
      shape: node.shape,
      shapeless: shapeless || undefined,
      cornerRadius: node.cornerRadius,
      cornerSmoothing: node.cornerSmoothing !== undefined ? node.cornerSmoothing / 100 : undefined,
      alphaMask:
        options.showOriginalBackgroundNodeId === node.id
          ? undefined
          : alphaMask && options.useMaskRenderProxy
            ? maskRenderUrl(alphaMask)
            : alphaMask,
    };
  }

  if (node.kind === 'text') {
    const fontSize = node.fontSize ?? 14;
    const text = node.text ?? '';
    const measuredWidth = Math.max(text.length * fontSize * 0.55, fontSize * 3);
    const measuredHeight = fontSize * (node.lineHeight ?? 1.4);
    const width = node.w ?? measuredWidth;
    const height = node.h ?? measuredHeight;
    const textMode = node.textMode ?? (node.w === undefined ? 'point' : 'area');
    const textShape = {
      kind: 'text' as const,
      text,
      fontSize,
      fontFamily: node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
      fontWeight: node.fontWeight ?? 400,
      fontStyle: node.fontStyle ?? 'normal',
      textAlign: node.textAlign ?? 'left',
      x: 0,
      y: 0,
      w: width,
      h: height,
      letterSpacing: node.letterSpacing,
      tracking: node.tracking,
      lineHeight: node.lineHeight,
      textCase: node.textCase,
      textDecoration: node.textDecoration,
      textMode,
      pathTextSettings: node.pathTextSettings,
    };
    return {
      ...base,
      kind: 'text',
      shape: textShape as unknown as EngineNode['shape'],
      text,
      fontSize,
      fontFamily: node.fontFamily,
      fontWeight: node.fontWeight,
      fontStyle: node.fontStyle,
      textAlign: node.textAlign,
      textAlignVertical: node.textAlignVertical,
      letterSpacing: node.letterSpacing,
      tracking: node.tracking,
      lineHeight: node.lineHeight,
      paragraphSpacing: node.paragraphSpacing,
      textCase: node.textCase,
      textDecoration: node.textDecoration,
      textOverflow: node.textOverflow,
      listStyle: node.listStyle,
      richText: node.richText,
      variableAxes: node.variableAxes,
      openTypeFeatures: node.openTypeFeatures,
      textMode,
      pathTextSettings: node.pathTextSettings,
      direction: node.direction ?? 'auto',
      language: node.language,
      kerningMode: node.kerningMode,
      glyphAdjustments: node.glyphAdjustments,
      pairAdjustments: node.pairAdjustments,
      w: width,
      h: height,
    };
  }

  if (node.kind === 'path') {
    return {
      ...base,
      shape: {
        kind: 'path',
        points: node.points,
        closed: node.closed,
        tolerance: 4,
      },
    };
  }

  if (node.kind === 'table') {
    // V2.15+: native tables compile to a single engine item (ADR-0016 D3).
    return compileTableToEngineNode(node, { width: node.w ?? 480, height: node.h ?? 240 });
  }

  if (node.kind === 'frame') {
    return {
      ...base,
      shape: { kind: 'rect', x: 0, y: 0, w: node.w, h: node.h },
      cornerRadius: node.cornerRadius,
      cornerSmoothing: node.cornerSmoothing !== undefined ? node.cornerSmoothing / 100 : undefined,
    };
  }

  if (node.kind === 'adjustment') {
    return {
      ...base,
      shape: { kind: 'rect', x: 0, y: 0, w: 0, h: 0 },
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      opacity: 0,
      filters: adjustmentsToFilters(node.adjustments ?? []),
    };
  }

  if (node.kind === 'rasterLayer') {
    const tiles: Record<string, { pixels: number[]; version: number }> = {};
    for (const [key, tile] of node.tiles) {
      tiles[key] = {
        pixels: Array.from(tile.pixels),
        version: tile.version,
      };
    }
    return {
      ...base,
      kind: 'rasterLayer',
      shape: { kind: 'rect', x: 0, y: 0, w: node.width, h: node.height },
      w: node.width,
      h: node.height,
      rasterLayerData: {
        width: node.width,
        height: node.height,
        pixelMode: node.pixelMode,
        tiles,
      },
    };
  }

  return { ...base, shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 160 } };
}

export interface FlattenedEngineScene {
  ids: NodeId[];
  nodes: EngineNode[];
}

/** Resolve document semantics and flatten visible roots in stable paint order. */
export function flattenSceneToEngine(
  document: Document,
  rootIds: readonly NodeId[],
  options: SceneNodeConversionOptions = {},
): FlattenedEngineScene {
  const variantCaches = buildAllVariantCaches(document);
  const variableStore = document.variableStore ?? createVariableStore();
  const resolvedStyles = resolveAllStyles(document);
  const ids: NodeId[] = [];
  const nodes: EngineNode[] = [];

  const visit = (id: NodeId): void => {
    const raw = document.nodes[id];
    if (!raw || raw.visible === false) return;

    let effective = getEffectiveNode(document, id, variantCaches) ?? raw;
    effective = applyBindingsToNode(effective, variableStore);

    if (effective.kind !== 'group') {
      let engineNode = sceneNodeToEngineNode(effective, options, document);
      engineNode = { ...engineNode, transform: nodeWorldTransform(document, id) };
      const styleOverrides = resolvedStyles.get(id);
      if (styleOverrides) engineNode = applyStyleOverrides(engineNode, styleOverrides);

      if (
        engineNode.pathTextSettings?.pathNodeId &&
        (engineNode.shape as { kind?: string } | undefined)?.kind === 'text'
      ) {
        const pathNode = document.nodes[engineNode.pathTextSettings.pathNodeId];
        if (pathNode?.kind === 'shape') {
          (engineNode.shape as unknown as Record<string, unknown>).pathShape = pathNode.shape;
        }
      }

      ids.push(id);
      nodes.push(engineNode);
    }

    if ('children' in raw) {
      for (const childId of raw.children) visit(childId);
    }
  };

  for (const rootId of rootIds) visit(rootId);
  return { ids, nodes };
}
