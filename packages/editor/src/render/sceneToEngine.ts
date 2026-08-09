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
  buildWarpEvaluation,
  createClusterMeasure,
  DEFAULT_WARP_QUALITY,
  type SceneNode as EngineNode,
  hasLiveWarps,
  registerImageResourceHandle,
  type WarpQualitySettings,
  warpShapeToPath,
  warpTextToClusterAdjustments,
} from '@varve/engine';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import {
  applyBindingsToNode,
  buildAllVariantCaches,
  createVariableStore,
  getEffectiveNode,
  nodeLocalBoundsSource,
  resolveAllStyles,
  resolveNodePaints,
  resolveRasterMaskAsset,
  warpsOnNode,
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
  /**
   * Evaluation quality for live warp modifiers. Defaults to the node's
   * warpSettings.quality (interactive). Export callers pass 'export'.
   */
  warpQuality?: WarpQualitySettings;
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

type AssetLookupDoc = Pick<Document, 'paints' | 'rasterMaskAssets' | 'nodes' | 'assets'>;

/**
 * Rewrite an image fill's render identity: canonical assets carry their
 * short content-addressed `assetId` as the render `src` (registered in the
 * engine resource registry so replay and worker collection can resolve it
 * to the loadable data URL), instead of materializing the multi-megabyte
 * payload into the IR. Legacy fills without an asset keep their raw src.
 */
function rewriteImageFillSource(
  fill: import('@varve/scene').Fill,
  doc: AssetLookupDoc | undefined,
): import('@varve/scene').Fill {
  if (fill.type !== 'image' || !fill.image) return fill;
  const assetId = fill.image.assetId;
  if (!assetId || !doc?.assets) return fill;
  const asset = doc.assets[assetId];
  if (!asset || asset.storage !== 'embedded') return fill;
  registerImageResourceHandle(assetId, asset.dataUrl);
  if (fill.image.src === assetId) return fill;
  return { ...fill, image: { ...fill.image, src: assetId, assetId } };
}

export function sceneNodeToEngineNode(
  node: SceneNode,
  options: SceneNodeConversionOptions = {},
  doc?: AssetLookupDoc,
): EngineNode {
  // Resolve paintRefs → paints → fills before converting
  const resolvedNode = resolvePaintRefs(node, doc);
  const base = {
    id: node.id,
    name: node.name,
    fill: resolvedNode.fill,
    fills: resolvedNode.fills
      ? resolvedNode.fills.map((f) => rewriteImageFillSource(f, doc))
      : resolvedNode.fills,
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
    // V2.16+: live non-destructive warp — evaluate the source geometry into
    // an exact path (source-local) once per node change; the object transform
    // is applied by the caller on top. Disabled/absent stacks pass through.
    const shape = evaluateShapeWarp(node, options);
    return {
      ...base,
      shape,
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
      ...deriveTextWarp(node, width, height, options),
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
    // Pass document context when available so scene-content cells render.
    const docNodes = (doc as { nodes?: Record<string, SceneNode> } | undefined)?.nodes;
    return compileTableToEngineNode(node, {
      width: node.w ?? 480,
      height: node.h ?? 240,
      ...(docNodes ? { nodes: docNodes } : {}),
    });
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

    if (effective.kind === 'table') {
      // Native tables compile with document context so rich scene-content
      // cells (images, components) resolve and render inside their cells.
      const contentToEngine = (contentNode: SceneNode): EngineNode =>
        sceneNodeToEngineNode(contentNode, options, document);
      const compiled = compileTableToEngineNode(effective, {
        width: effective.w ?? 480,
        height: effective.h ?? 240,
        nodes: document.nodes,
        toEngineNode: contentToEngine,
      });
      ids.push(id);
      nodes.push(compiled as unknown as EngineNode);
    } else if (effective.kind !== 'group') {
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

// ── live warp evaluation (leaves) ───────────────────────────────────────────

function warpQualityFor(node: SceneNode, options: SceneNodeConversionOptions): WarpQualitySettings {
  if (options.warpQuality) return options.warpQuality;
  const settings = (node as { warpSettings?: { quality?: WarpQualitySettings } }).warpSettings;
  return settings?.quality ?? DEFAULT_WARP_QUALITY;
}

/** Evaluate a shape node's warp stack into an exact path (source-local). */
function evaluateShapeWarp(
  node: Extract<SceneNode, { kind: 'shape' }>,
  options: SceneNodeConversionOptions,
): import('@varve/engine').Shape {
  const warps = warpsOnNode(node);
  if (!hasLiveWarps(warps)) return node.shape;
  const sourceBounds = nodeLocalBoundsSource(node);
  if (!sourceBounds) return node.shape;
  const { shape } = warpShapeToPath(node.shape, warps, sourceBounds, {
    settings: (node as { warpSettings?: import('@varve/engine').WarpSettings }).warpSettings,
    quality: warpQualityFor(node, options),
  });
  return shape;
}

/**
 * Derive per-cluster glyph adjustments for a text node's live warp (text
 * stays text). Returns `{ glyphAdjustments }` with the original adjustments
 * when there is no warp or the text cannot be warp-rendered.
 */
function deriveTextWarp(
  node: Extract<SceneNode, { kind: 'text' }>,
  width: number,
  height: number,
  _options: SceneNodeConversionOptions,
): { glyphAdjustments?: Record<number, import('@varve/engine').GlyphAdjustmentIR> } {
  const warps = warpsOnNode(node);
  if (!hasLiveWarps(warps)) {
    return node.glyphAdjustments ? { glyphAdjustments: node.glyphAdjustments } : {};
  }
  if (node.richText || node.textMode === 'path') {
    return node.glyphAdjustments ? { glyphAdjustments: node.glyphAdjustments } : {};
  }
  const sourceBounds = nodeLocalBoundsSource(node);
  if (!sourceBounds)
    return node.glyphAdjustments ? { glyphAdjustments: node.glyphAdjustments } : {};
  const settings = (node as { warpSettings?: import('@varve/engine').WarpSettings }).warpSettings;
  const evalWarp = buildWarpEvaluation(warps, sourceBounds, settings ? { settings } : {});
  const result = warpTextToClusterAdjustments(
    {
      text: node.text,
      fontSize: node.fontSize ?? 14,
      fontFamily: node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
      fontWeight: node.fontWeight,
      fontStyle: node.fontStyle,
      letterSpacing: node.letterSpacing,
      tracking: node.tracking,
      w: width,
      h: height,
      textAlign: node.textAlign,
      direction: node.direction,
      measure: createClusterMeasure(
        node.fontSize ?? 14,
        node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
      ),
    },
    evalWarp,
  );
  if (result.unsupported) {
    // Keep the text unwarped rather than silently mis-render it; the
    // Inspector surfaces the reason via `textWarpUnsupportedReason`.
    return node.glyphAdjustments ? { glyphAdjustments: node.glyphAdjustments } : {};
  }
  return Object.keys(result.adjustments).length > 0 ? { glyphAdjustments: result.adjustments } : {};
}
