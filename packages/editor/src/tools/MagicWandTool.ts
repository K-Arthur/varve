/**
 * Interactive, perceptual Magic Wand.
 *
 * It samples the clicked target image, creates a bounded OKLab coverage mask,
 * clips it to the image's visible crop, and combines it into AreaSelection.
 * Node selection remains completely separate.
 */
import {
  type AreaSelection,
  type AreaSelectionOperation,
  areaSelectionFromColorRange,
  combineAreaSelections,
  computeImagePlacement,
  createAreaSelection,
  localToSourcePixel,
  refineAreaSelection,
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
import { sampleVisibleArtwork } from './artworkSampling';
import { BaseTool } from './BaseTool';
import { closeMagicWandGaps } from './magicWandGapClosure';
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

  private selectionRequestSequence = 0;
  private artworkRequest: AbortController | null = null;

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair', fallback: 'crosshair' };
  }

  override onPointerDown(event: PointerEvent, ctx: ToolContext): GestureResult {
    // Image-backed selections decode asynchronously. Every new pointer action
    // supersedes that work, including a click on an unsupported target.
    const requestSequence = ++this.selectionRequestSequence;
    this.artworkRequest?.abort();
    this.artworkRequest = null;
    const world = ctx.canvasToWorld(event.clientX, event.clientY);
    const settings = { ...(ctx.magicWandSettings ?? DEFAULT_MAGIC_WAND_SETTINGS) };
    const operation =
      event.shiftKey || event.altKey ? selectionOperationFromModifiers(event) : settings.operation;
    if (settings.sampleSource === 'visibleArtwork') {
      const controller = new AbortController();
      this.artworkRequest = controller;
      void this.selectVisibleArtwork(ctx, requestSequence, world, operation, settings, controller);
      return { consumed: true };
    }

    const hit = ctx.hitTest(world);
    if (hit?.node.kind === 'rasterLayer') {
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
    void this.select(
      ctx,
      requestSequence,
      hit.nodeId,
      hit.node,
      image,
      source,
      world,
      operation,
      settings,
    );
    return { consumed: true };
  }

  override onDeactivate(): void {
    this.selectionRequestSequence += 1;
    this.artworkRequest?.abort();
    this.artworkRequest = null;
  }

  private async selectVisibleArtwork(
    ctx: ToolContext,
    requestSequence: number,
    click: { x: number; y: number },
    operation: AreaSelectionOperation,
    settings: NonNullable<ToolContext['magicWandSettings']>,
    controller: AbortController,
  ): Promise<void> {
    const clearRequest = () => {
      if (this.artworkRequest === controller) this.artworkRequest = null;
    };
    if (!ctx.setAreaSelection) {
      clearRequest();
      ctx.announce('Pixel selection is unavailable in this editor surface');
      return;
    }
    const sourceDocument = ctx.document;
    const sourceSelection = ctx.areaSelection ?? null;
    const rootIds = ctx.rootNodes().map((node) => node.id);
    const sampled = await sampleVisibleArtwork({
      document: sourceDocument,
      rootIds,
      signal: controller.signal,
    });
    if (requestSequence !== this.selectionRequestSequence || controller.signal.aborted) {
      clearRequest();
      return;
    }
    if (sampled.status !== 'ready') {
      clearRequest();
      ctx.announce(sampled.reason);
      return;
    }
    const currentDocument = ctx.getCurrentDocument?.();
    if (
      sampled.document !== sourceDocument ||
      (currentDocument !== undefined && currentDocument !== sourceDocument)
    ) {
      clearRequest();
      ctx.announce('The artwork changed before Magic Wand could finish; click it again');
      return;
    }
    const currentRootIds = ctx.rootNodes().map((node) => node.id);
    if (
      currentRootIds.length !== rootIds.length ||
      currentRootIds.some((id, index) => id !== rootIds[index])
    ) {
      clearRequest();
      ctx.announce('The active artwork changed before Magic Wand could finish; click it again');
      return;
    }
    const liveSelection = ctx.getCurrentAreaSelection
      ? ctx.getCurrentAreaSelection()
      : (ctx.areaSelection ?? null);
    if (liveSelection !== sourceSelection) {
      clearRequest();
      ctx.announce('The pixel selection changed before Magic Wand could finish; click again');
      return;
    }

    const { bounds, imageData } = sampled;
    const sampleX = Math.floor(click.x - bounds.x);
    const sampleY = Math.floor(click.y - bounds.y);
    if (sampleX < 0 || sampleY < 0 || sampleX >= bounds.width || sampleY >= bounds.height) {
      clearRequest();
      ctx.announce('Click within the visible artwork to sample it');
      return;
    }
    const offset = (sampleY * bounds.width + sampleX) * 4;
    const target = {
      r: imageData.data[offset]!,
      g: imageData.data[offset + 1]!,
      b: imageData.data[offset + 2]!,
    };
    if (settings.mode === 'contiguous' && settings.gapClosure > 0) {
      const gapResult = await closeMagicWandGaps(imageData, {
        target,
        reach: toleranceToOklab(settings.tolerance) + featherToOklab(settings.edgeFeather),
        radius: settings.gapClosure,
        signal: controller.signal,
      });
      if (
        gapResult === 'cancelled' ||
        requestSequence !== this.selectionRequestSequence ||
        controller.signal.aborted
      ) {
        clearRequest();
        return;
      }
      const currentDocumentAfterClose = ctx.getCurrentDocument?.();
      const currentRootsAfterClose = ctx.rootNodes().map((node) => node.id);
      const currentSelectionAfterClose = ctx.getCurrentAreaSelection
        ? ctx.getCurrentAreaSelection()
        : (ctx.areaSelection ?? null);
      if (
        (currentDocumentAfterClose !== undefined && currentDocumentAfterClose !== sourceDocument) ||
        currentRootsAfterClose.length !== rootIds.length ||
        currentRootsAfterClose.some((id, index) => id !== rootIds[index]) ||
        currentSelectionAfterClose !== sourceSelection
      ) {
        clearRequest();
        ctx.announce('The artwork changed before Magic Wand could finish; click again');
        return;
      }
    }
    const sourceSelectionMask = areaSelectionFromColorRange(
      { data: imageData.data, width: bounds.width, height: bounds.height },
      target,
      {
        tolerance: toleranceToOklab(settings.tolerance),
        feather: featherToOklab(settings.edgeFeather),
        mode: settings.mode,
        seed: settings.mode === 'contiguous' ? { x: sampleX, y: sampleY } : undefined,
      },
    );
    const expandedSelectionMask = this.expandSelection(sourceSelectionMask, settings.edgeExpansion);
    const documentSelection = expandedSelectionMask
      ? transformAreaSelection(expandedSelectionMask, [1, 0, 0, 1, bounds.x, bounds.y])
      : null;
    if (!documentSelection) {
      clearRequest();
      ctx.announce('No matching visible artwork was found');
      return;
    }
    const next = combineAreaSelections(
      sourceSelection,
      documentSelection,
      operation,
      (sourceSelection?.generation ?? 0) + 1,
    );
    if (!next) {
      clearRequest();
      ctx.announce(
        operation === 'intersect'
          ? 'Nothing to intersect with — make a selection first'
          : 'Nothing to subtract from — make a selection first',
      );
      return;
    }
    ctx.setAreaSelection(next);
    clearRequest();
    ctx.announce(
      settings.mode === 'contiguous'
        ? 'Contiguous visible-artwork Magic Wand selection created'
        : 'Global visible-artwork Magic Wand selection created',
    );
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
      edgeExpansion: settings.edgeExpansion,
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
    requestSequence: number,
    nodeId: string,
    node: import('@varve/scene').SceneNode,
    image: ImageFillData,
    source: string,
    click: { x: number; y: number },
    operation: AreaSelectionOperation,
    settings: NonNullable<ToolContext['magicWandSettings']>,
  ): Promise<void> {
    const decoded = await decodeRasterMaskDataUrl(source);
    if (requestSequence !== this.selectionRequestSequence) return;
    if (!decoded || !ctx.setAreaSelection) {
      ctx.announce('The image could not be decoded for selection');
      return;
    }
    const currentNode = ctx.getNode(nodeId);
    const currentImage =
      currentNode?.kind === 'shape' && isImageShape(currentNode)
        ? getImageFill(currentNode)?.image
        : undefined;
    if (
      currentNode !== node ||
      !currentImage ||
      currentImage.src !== image.src ||
      currentImage.assetId !== image.assetId
    ) {
      ctx.announce('The image changed before Magic Wand could finish; click it again');
      return;
    }
    const bounds = nodeLocalBounds(currentNode, ctx.document);
    const worldTransform =
      ctx.getWorldTransform?.(nodeId) ??
      nodeWorldTransform(ctx.document, nodeId, buildParentIndexMap(ctx.document));
    const placement =
      bounds &&
      computeImagePlacement({
        fit: currentImage.fit,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        bounds,
        x: currentImage.x,
        y: currentImage.y,
        scale: currentImage.scale,
        sourceCrop: currentImage.crop,
        rotation: currentImage.rotation,
        flipH: currentImage.flipH,
        flipV: currentImage.flipV,
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
    const expandedSourceSelection = this.expandSelection(sourceSelection, settings.edgeExpansion);
    const crop = createAreaSelection({
      kind: 'rectangle',
      ...mapping.visibleSourceRect,
      feather: 0,
      antialias: false,
    });
    const documentSelection = expandedSourceSelection
      ? transformAreaSelection(expandedSourceSelection, mapping.sourceToDocument)
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

  private expandSelection(
    selection: AreaSelection | null,
    edgeExpansion: number,
  ): AreaSelection | null {
    if (!selection) return null;
    const amount = Number.isFinite(edgeExpansion)
      ? Math.max(0, Math.min(8, Math.round(edgeExpansion)))
      : 0;
    return amount > 0
      ? refineAreaSelection(selection, 'grow', { amount }, selection.generation)
      : selection;
  }
}
