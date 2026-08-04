/**
 * Codegen flattening bridge — connects the DesignIR flattening analysis
 * with the editor's rendering engine to produce raster assets for
 * unsupported subtrees during code generation.
 *
 * Uses the existing compositor infrastructure but scoped to the
 * codegen-specific flattening needs: only nodes that the codegen
 * analysis identifies as needing raster fallback are rendered.
 *
 * Non-rasterized nodes remain in the IR for native code output.
 */

import type { FlattenInfo, IRDocument, RasterAsset } from '@varve/codegen';
import type { Engine } from '@varve/engine';
import { createRasterSurface, encodeRasterSurface } from '@varve/engine';
import type { Document, SceneNode } from '@varve/scene';
import { nodeWorldBounds } from '../scene/world';

export interface CodegenFlattenOptions {
  /** Export scale factor (1 = 100%). */
  scale: number;
  /** DPI for rasterization (default 96). */
  dpi?: number;
  /** Background colour [r, g, b, a] 0-255. */
  background?: readonly [number, number, number, number];
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Render engine (required for accurate flattened output). */
  engine: Engine;
  /** Progress callback. */
  onProgress?: (phase: string, current: number, total: number) => void;
}

/**
 * Flatten unsupported nodes in an IR document by rendering them to
 * raster assets. Mutates the IR's FlattenInfo in place, setting
 * `flattenedImageUrl`, `flattenedWidth`, `flattenedHeight`.
 *
 * Only nodes with `mustFlatten: true` and `emitAs !== 'native'` are
 * rendered — native-emittable nodes pass through unchanged.
 */
export async function flattenIrForCodegen(
  ir: IRDocument,
  doc: Document,
  sceneNodes: Map<string, SceneNode>,
  opts: CodegenFlattenOptions,
): Promise<RasterAsset[]> {
  const assets: RasterAsset[] = [];
  const nodesToFlatten: Array<{
    nodeId: string;
    irNodeId: string;
    sceneNode: SceneNode;
    flattenInfo: FlattenInfo;
  }> = [];

  // Collect all IR nodes that need rasterization
  function collectFlattenTargets(irNodeId: string) {
    const irNode = ir.nodes[irNodeId];
    if (!irNode) return;
    if (irNode.flattening?.mustFlatten && irNode.flattening.emitAs !== 'native') {
      const sceneNodeId = irNode.metadata.sourceNodeId;
      const sceneNode = sceneNodes.get(sceneNodeId);
      if (sceneNode) {
        nodesToFlatten.push({
          nodeId: sceneNodeId,
          irNodeId,
          sceneNode,
          flattenInfo: irNode.flattening,
        });
      }
    }
    for (const child of irNode.children) {
      collectFlattenTargets(child.id);
    }
  }

  for (const rootId of ir.rootIds) {
    collectFlattenTargets(rootId);
  }

  if (nodesToFlatten.length === 0) return [];

  const total = nodesToFlatten.length;
  const scale = opts.scale ?? 1;
  const dpi = opts.dpi ?? 96;
  const signal = opts.signal;
  const engine = opts.engine;
  const bg = opts.background;

  for (let i = 0; i < nodesToFlatten.length; i++) {
    if (signal?.aborted) break;

    const target = nodesToFlatten[i]!;
    opts.onProgress?.('flattening', i + 1, total);

    // Compute world bounds
    const bounds = nodeWorldBounds(doc, target.nodeId);
    if (!bounds) continue;

    const pixelWidth = Math.ceil(bounds.w * scale);
    const pixelHeight = Math.ceil(bounds.h * scale);

    if (pixelWidth <= 0 || pixelHeight <= 0) continue;
    if (pixelWidth > 16384 || pixelHeight > 16384) continue;

    // Create raster surface at export resolution
    const surface = createRasterSurface(pixelWidth, pixelHeight);
    if (!surface) continue;

    const ctx = surface.context;
    ctx.scale(scale, scale);

    // Optional background
    if (bg) {
      ctx.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${(bg[3] / 255).toFixed(3)})`;
      ctx.fillRect(0, 0, bounds.w, bounds.h);
    }

    // Build IR for just this node and its subtree
    try {
      const scene = { nodes: [target.sceneNode] };
      const irResult = await engine.buildIr(scene);

      // Replay IR to surface
      if (irResult && irResult.length > 0) {
        const replayFn = (
          engine as unknown as {
            replayIr?: (
              target: import('@varve/engine').ReplayTarget,
              ir: import('@varve/engine').RenderItem[],
            ) => void;
          }
        ).replayIr;
        if (replayFn) {
          replayFn(surface as unknown as import('@varve/engine').ReplayTarget, irResult);
        }
      }
    } catch {
      // Fallback: simple rect placeholder
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(0, 0, bounds.w, bounds.h);
      ctx.fillStyle = '#999';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Flattened content', bounds.w / 2, bounds.h / 2);
    }

    // Encode to PNG
    const blob = await encodeRasterSurface(surface, 'image/png');
    if (!blob) continue;

    const dataUrl = URL.createObjectURL(blob);

    // Update IR flatten info
    const irNode = ir.nodes[target.irNodeId];
    if (irNode?.flattening) {
      irNode.flattening.flattenedImageUrl = dataUrl;
      irNode.flattening.flattenedWidth = bounds.w;
      irNode.flattening.flattenedHeight = bounds.h;
    }

    assets.push({
      nodeId: target.nodeId,
      dataUrl,
      pixelWidth,
      pixelHeight,
      cssWidth: bounds.w,
      cssHeight: bounds.h,
      dpi,
    });
  }

  return assets;
}
