/**
 * Transform Pixels operates on a temporary floating buffer, not the selected
 * node's transform. One pointer drag sets a live document-space transform;
 * the immutable source is resampled only when the gesture commits.
 */
import { computeImagePlacement, floatingTransformBounds, liftSelectedPixels } from '@varve/engine';
import { buildParentIndexMap, getImageFill, isImageShape } from '@varve/scene';
import { type Affine, identity, multiplyAffine, rotateRad, translate } from '@varve/shared';
import { visibleImageSourceMapping } from '../floatingRaster/imagePlacement';
import { nodeLocalBounds, nodeWorldTransform } from '../scene/world';
import { BaseTool } from './BaseTool';
import { decodeRasterMaskDataUrl } from './selectionMask';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

type TransformMode = 'move' | 'rotate' | 'scale';

export class FloatingTransformTool extends BaseTool {
  id = 'floatingTransform' as const;

  private mode: TransformMode = 'move';
  private start = { x: 0, y: 0 };
  private initialTransform: Affine = identity;
  private initialAngle = 0;
  private initialDistance = 1;
  private hasGesture = false;

  cursor(_state: ToolCursorState): CursorSpec {
    return this.mode === 'rotate'
      ? { css: 'grab', fallback: 'default' }
      : this.mode === 'scale'
        ? { css: 'nwse-resize', fallback: 'default' }
        : { css: 'move', fallback: 'default' };
  }

  override onActivate(ctx: ToolContext): void {
    if (!ctx.getFloatingRaster?.()) void this.liftFromActiveTarget(ctx);
  }

  /** Switching away cancels: the source was never mutated during preview. */
  override onDeactivate(ctx: ToolContext): void {
    if (ctx.getFloatingRaster?.()) {
      ctx.cancelFloatingRaster?.();
      ctx.announce('Pixel transform cancelled');
    }
  }

  override onPointerDown(event: PointerEvent, ctx: ToolContext): GestureResult {
    const floating = ctx.getFloatingRaster?.();
    if (!floating) {
      ctx.announce('Preparing selected pixels');
      return { consumed: true };
    }
    this.start = ctx.canvasToWorld(event.clientX, event.clientY);
    this.initialTransform = [...floating.transform] as Affine;
    this.mode = event.altKey ? 'rotate' : event.shiftKey ? 'scale' : 'move';
    this.hasGesture = false;
    return super.onPointerDown(event, ctx);
  }

  override onDragStart(ctx: ToolContext): void {
    const floating = ctx.getFloatingRaster?.();
    if (!floating) return;
    const bounds = floatingTransformBounds(floating);
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    this.initialAngle = Math.atan2(this.start.y - cy, this.start.x - cx);
    this.initialDistance = Math.max(0.0001, Math.hypot(this.start.x - cx, this.start.y - cy));
  }

  override onDragMove(ctx: ToolContext): void {
    const floating = ctx.getFloatingRaster?.();
    const event = ctx.lastPointerEvent;
    if (!floating || !event) return;
    const pointer = ctx.canvasToWorld(event.clientX, event.clientY);
    const bounds = floatingTransformBounds(floating);
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    let transform: Affine;
    if (this.mode === 'move') {
      transform = multiplyAffine(
        translate(pointer.x - this.start.x, pointer.y - this.start.y),
        this.initialTransform,
      );
    } else if (this.mode === 'rotate') {
      const angle = Math.atan2(pointer.y - cy, pointer.x - cx);
      transform = multiplyAffine(
        multiplyAffine(translate(cx, cy), rotateRad(angle - this.initialAngle)),
        multiplyAffine(translate(-cx, -cy), this.initialTransform),
      );
    } else {
      const distance = Math.hypot(pointer.x - cx, pointer.y - cy);
      const factor = distance / this.initialDistance;
      transform = multiplyAffine(
        multiplyAffine(translate(cx, cy), [factor, 0, 0, factor, 0, 0]),
        multiplyAffine(translate(-cx, -cy), this.initialTransform),
      );
    }
    this.hasGesture = true;
    ctx.updateFloatingTransform?.(transform);
  }

  override onDragEnd(ctx: ToolContext): void {
    // Pointer up is also delivered for a click used to focus the selection.
    // Do not create a copy-on-write image/history entry unless a real drag
    // changed the temporary transform; Enter remains the explicit commit key.
    if (this.hasGesture) ctx.commitFloatingRaster?.();
    this.hasGesture = false;
  }

  override onDragCancel(ctx: ToolContext): void {
    this.hasGesture = false;
    ctx.cancelFloatingRaster?.();
  }

  override onKeyDown(event: KeyboardEvent, ctx: ToolContext): boolean {
    if (event.key === 'Escape') {
      this.hasGesture = false;
      ctx.cancelFloatingRaster?.();
      ctx.setTool('select');
      return true;
    }
    if (event.key === 'Enter') {
      ctx.commitFloatingRaster?.();
      return true;
    }
    return false;
  }

  private async liftFromActiveTarget(ctx: ToolContext): Promise<void> {
    const selection = ctx.areaSelection;
    const targetId = ctx.selection[0];
    if (!selection || !targetId) {
      ctx.announce('Select an image and create a pixel selection first');
      ctx.setTool('select');
      return;
    }
    const node = ctx.document.nodes[targetId];
    if (node?.kind !== 'shape' || !isImageShape(node)) {
      ctx.announce('Transform Pixels currently supports one image target');
      ctx.setTool('select');
      return;
    }
    const image = getImageFill(node)?.image;
    const source = image?.assetId
      ? (ctx.document.assets?.[image.assetId]?.dataUrl ?? image.src)
      : image?.src;
    if (!image || !source) {
      ctx.announce('The image source is unavailable');
      ctx.setTool('select');
      return;
    }
    const decoded = await decodeRasterMaskDataUrl(source);
    if (!decoded) {
      ctx.announce('The image could not be decoded');
      ctx.setTool('select');
      return;
    }
    const bounds = nodeLocalBounds(node, ctx.document);
    const parentIndex = buildParentIndexMap(ctx.document);
    const worldTransform = nodeWorldTransform(ctx.document, targetId, parentIndex);
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
    if (!mapping) {
      ctx.announce('Transform Pixels cannot edit tiled or unmappable image placement');
      ctx.setTool('select');
      return;
    }
    const floating = liftSelectedPixels(
      selection,
      decoded.data,
      decoded.width,
      decoded.height,
      0,
      0,
      {
        targetNodeId: targetId,
        sourceToDocument: mapping.sourceToDocument,
        visibleSourceRect: mapping.visibleSourceRect,
        interpolation: 'bilinear',
        isMove: true,
      },
    );
    if (!floating) {
      ctx.announce('No editable pixels are covered by the selection');
      ctx.setTool('select');
      return;
    }
    ctx.setFloatingRaster?.(floating);
    ctx.announce('Transforming selected pixels. Drag to move; Shift scales; Alt rotates.');
  }
}
