/**
 * Interactive, perceptual Magic Wand.
 *
 * It samples the clicked target image, creates a bounded OKLab coverage mask,
 * clips it to the image's visible crop, and combines it into AreaSelection.
 * Node selection remains completely separate.
 */
import {
  type AreaSelectionOperation,
  areaSelectionFromColorRange,
  combineAreaSelections,
  computeImagePlacement,
  createAreaSelection,
  localToSourcePixel,
  transformAreaSelection,
} from '@varve/engine';
import { buildParentIndexMap, getImageFill, type ImageFillData, isImageShape } from '@varve/scene';
import { applyAffine, tryInvertAffine } from '@varve/shared';
import { visibleImageSourceMapping } from '../floatingRaster/imagePlacement';
import { nodeLocalBounds, nodeWorldTransform } from '../scene/world';
import { BaseTool } from './BaseTool';
import { DEFAULT_MAGIC_WAND_SETTINGS } from './magicWandSettings';
import { decodeRasterMaskDataUrl } from './selectionMask';
import { selectionOperationFromModifiers } from './selectionOperations';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

function toleranceToOklab(value: number): number {
  return Math.max(0.001, (Math.max(0, Math.min(100, value)) / 100) * 0.5);
}

function featherToOklab(value: number): number {
  return (Math.max(0, Math.min(100, value)) / 100) * 0.3;
}

export class MagicWandTool extends BaseTool {
  id = 'magicWand' as const;

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair', fallback: 'crosshair' };
  }

  override onPointerDown(event: PointerEvent, ctx: ToolContext): GestureResult {
    const world = ctx.canvasToWorld(event.clientX, event.clientY);
    const hit = ctx.hitTest(world);
    if (hit?.node.kind !== 'shape' || !isImageShape(hit.node)) {
      ctx.announce('Click an image to use Magic Wand');
      return { consumed: false };
    }
    const image = getImageFill(hit.node)?.image;
    const source = image?.assetId
      ? (ctx.document.assets?.[image.assetId]?.dataUrl ?? image.src)
      : image?.src;
    if (!image || !source) {
      ctx.announce('The image source is unavailable');
      return { consumed: true };
    }
    const settings = ctx.magicWandSettings ?? DEFAULT_MAGIC_WAND_SETTINGS;
    const operation =
      event.shiftKey || event.altKey ? selectionOperationFromModifiers(event) : settings.operation;
    void this.select(ctx, hit.nodeId, hit.node, image, source, world, operation);
    return { consumed: true };
  }

  private async select(
    ctx: ToolContext,
    nodeId: string,
    node: import('@varve/scene').SceneNode,
    image: ImageFillData,
    source: string,
    click: { x: number; y: number },
    operation: AreaSelectionOperation,
  ): Promise<void> {
    const decoded = await decodeRasterMaskDataUrl(source);
    if (!decoded || !ctx.setAreaSelection) {
      ctx.announce('The image could not be decoded for selection');
      return;
    }
    const bounds = nodeLocalBounds(node, ctx.document);
    const worldTransform = nodeWorldTransform(
      ctx.document,
      nodeId,
      buildParentIndexMap(ctx.document),
    );
    const placement =
      bounds &&
      computeImagePlacement({
        fit: image.fit,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        bounds,
        x: image.x,
        y: image.y,
        scale: image.scale,
        sourceCrop: image.crop,
        rotation: image.rotation,
        flipH: image.flipH,
        flipV: image.flipV,
      });
    const mapping = placement && visibleImageSourceMapping(placement, worldTransform);
    const inverseWorld = tryInvertAffine(worldTransform);
    if (!placement || !mapping || !inverseWorld) {
      ctx.announce('Magic Wand cannot sample tiled or unmappable image placement');
      return;
    }
    const [localX, localY] = applyAffine(inverseWorld, [click.x, click.y]);
    // The pointer is in node-local coordinates after inverting the node
    // transform, so use the placement's local → source direction. Reversing
    // this (source → local) samples the wrong texel whenever placement has
    // offsets, crop, scale, rotation, or flips.
    const sourcePoint = localToSourcePixel(placement, { x: localX, y: localY });
    if (!sourcePoint) {
      ctx.announce('The click is outside visible image pixels');
      return;
    }
    const sx = Math.floor(sourcePoint.x);
    const sy = Math.floor(sourcePoint.y);
    const offset = (sy * decoded.width + sx) * 4;
    if (decoded.data[offset + 3] === 0) {
      ctx.announce('Fully transparent pixels cannot seed Magic Wand');
      return;
    }
    const settings = ctx.magicWandSettings ?? DEFAULT_MAGIC_WAND_SETTINGS;
    const sourceSelection = areaSelectionFromColorRange(
      { data: decoded.data, width: decoded.width, height: decoded.height },
      { r: decoded.data[offset]!, g: decoded.data[offset + 1]!, b: decoded.data[offset + 2]! },
      {
        tolerance: toleranceToOklab(settings.tolerance),
        feather: featherToOklab(settings.edgeFeather),
        mode: settings.mode,
        seed: settings.mode === 'contiguous' ? sourcePoint : undefined,
      },
    );
    const crop = createAreaSelection({
      kind: 'rectangle',
      ...mapping.visibleSourceRect,
      feather: 0,
      antialias: false,
    });
    const documentSelection = sourceSelection
      ? transformAreaSelection(sourceSelection, mapping.sourceToDocument)
      : null;
    const visibleCrop = crop ? transformAreaSelection(crop, mapping.sourceToDocument) : null;
    if (!documentSelection || !visibleCrop) {
      ctx.announce('No matching pixels found');
      return;
    }
    const clipped = combineAreaSelections(
      visibleCrop,
      documentSelection,
      'intersect',
      (ctx.areaSelection?.generation ?? 0) + 1,
    );
    if (!clipped) {
      ctx.announce('No visible matching pixels found');
      return;
    }
    const next = combineAreaSelections(
      ctx.areaSelection ?? null,
      clipped,
      operation,
      (ctx.areaSelection?.generation ?? 0) + 1,
    );
    ctx.setAreaSelection(next);
    ctx.announce(
      settings.mode === 'contiguous'
        ? 'Contiguous Magic Wand selection created'
        : 'Global Magic Wand selection created',
    );
  }
}
