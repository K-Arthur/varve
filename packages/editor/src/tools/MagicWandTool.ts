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
import {
  buildParentIndexMap,
  getImageFill,
  type ImageFillData,
  isImageShape,
  type RasterLayerNode,
} from '@varve/scene';
import { applyAffine, tryInvertAffine } from '@varve/shared';
import { visibleImageSourceMapping } from '../floatingRaster/imagePlacement';
import { nodeLocalBounds, nodeWorldTransform } from '../scene/world';
import { BaseTool } from './BaseTool';
import { DEFAULT_MAGIC_WAND_SETTINGS } from './magicWandSettings';
import { rasterColorSelectionAt } from './rasterColorSelection';
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
    if (hit?.node.kind === 'rasterLayer') {
      const settings = ctx.magicWandSettings ?? DEFAULT_MAGIC_WAND_SETTINGS;
      const operation =
        event.shiftKey || event.altKey
          ? selectionOperationFromModifiers(event)
          : settings.operation;
      this.selectRaster(ctx, hit.nodeId, hit.node, world, operation);
      return { consumed: true };
    }
    // Some raster layers intentionally do not participate in alpha hit
    // testing at transparent or transformed edges. When the artist has
    // explicitly selected one, use that target as the sampling surface rather
    // than making a valid painted layer appear unsupported.
    const selectedRaster =
      ctx.selection.length === 1 ? ctx.document.nodes[ctx.selection[0]!] : undefined;
    if (
      selectedRaster?.kind === 'rasterLayer' &&
      (hit === null || hit.node.kind !== 'shape' || !isImageShape(hit.node))
    ) {
      const settings = ctx.magicWandSettings ?? DEFAULT_MAGIC_WAND_SETTINGS;
      const operation =
        event.shiftKey || event.altKey
          ? selectionOperationFromModifiers(event)
          : settings.operation;
      this.selectRaster(ctx, selectedRaster.id, selectedRaster, world, operation);
      return { consumed: true };
    }
    if (hit?.node.kind !== 'shape' || !isImageShape(hit.node)) {
      ctx.announce('Click an image or pixel layer to use Magic Wand');
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

  private selectRaster(
    ctx: ToolContext,
    nodeId: string,
    node: RasterLayerNode,
    click: { x: number; y: number },
    operation: AreaSelectionOperation,
  ): void {
    if (!ctx.setAreaSelection) {
      ctx.announce('Pixel selection is unavailable in this editor surface');
      return;
    }
    const settings = ctx.magicWandSettings ?? DEFAULT_MAGIC_WAND_SETTINGS;
    // Match PaintTool's raster-local mapping when the live canvas context
    // provides it. The scene helper remains the deterministic fallback for
    // lightweight callers and unit contexts.
    const worldTransform =
      ctx.getWorldTransform?.(nodeId) ??
      nodeWorldTransform(ctx.document, nodeId, buildParentIndexMap(ctx.document));
    const inverseWorld = tryInvertAffine(worldTransform);
    if (!inverseWorld) {
      ctx.announce('Magic Wand cannot sample a singular pixel-layer transform');
      return;
    }
    const [localX, localY] = applyAffine(inverseWorld, [click.x, click.y]);
    const localPoint = { x: localX, y: localY };
    const localSelection = rasterColorSelectionAt(node, localPoint, {
      tolerance: toleranceToOklab(settings.tolerance),
      feather: featherToOklab(settings.edgeFeather),
      mode: settings.mode,
    });
    const documentSelection = localSelection
      ? transformAreaSelection(localSelection, worldTransform)
      : null;
    if (!documentSelection) {
      ctx.announce('No matching opaque pixel was found on this layer');
      return;
    }
    const next = combineAreaSelections(
      ctx.areaSelection ?? null,
      documentSelection,
      operation,
      (ctx.areaSelection?.generation ?? 0) + 1,
    );
    if (!next) {
      ctx.announce(
        operation === 'intersect'
          ? 'Nothing to intersect with — make a selection first'
          : 'Nothing to subtract from — make a selection first',
      );
      return;
    }
    ctx.setAreaSelection(next);
    ctx.announce(
      settings.mode === 'contiguous'
        ? 'Contiguous pixel-layer Magic Wand selection created'
        : 'Global pixel-layer Magic Wand selection created',
    );
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
    if (!next) {
      ctx.announce(
        operation === 'intersect'
          ? 'Nothing to intersect with — make a selection first'
          : 'Nothing to subtract from — make a selection first',
      );
      return;
    }
    ctx.setAreaSelection(next);
    ctx.announce(
      settings.mode === 'contiguous'
        ? 'Contiguous Magic Wand selection created'
        : 'Global Magic Wand selection created',
    );
  }
}
