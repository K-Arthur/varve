import { computeImagePlacement } from '@varve/engine';
import { type Document, nodeLocalBounds, type ShapeNode } from '@varve/scene';

export interface GenerativeSourceFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GenerativeOverlayPlacement extends GenerativeSourceFrame {
  /** Node-local offset used by the image-fill renderer. */
  localX: number;
  localY: number;
  /** Uniform node-local scale for the transparent patch asset. */
  scale: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.01 * Math.max(1, Math.abs(left), Math.abs(right));
}

/**
 * Convert a source-pixel patch frame into the image-fill geometry used by
 * replay. The overlay fill is a crop-mode image, so its local placement must
 * be derived from the same fit/crop/rotation/flip transform as the immutable
 * source fill. Unsupported mappings fail closed because a plausible-looking
 * but displaced patch is worse than asking the user to flatten or recrop.
 */
export function placeGenerativeOverlay(
  doc: Document,
  node: ShapeNode,
  sourceWidth: number,
  sourceHeight: number,
  patchWidth: number,
  patchHeight: number,
  frame: GenerativeSourceFrame,
): GenerativeOverlayPlacement {
  if (
    !finitePositive(sourceWidth) ||
    !finitePositive(sourceHeight) ||
    !Number.isSafeInteger(patchWidth) ||
    !Number.isSafeInteger(patchHeight) ||
    !finitePositive(patchWidth) ||
    !finitePositive(patchHeight) ||
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    !finitePositive(frame.width) ||
    !finitePositive(frame.height) ||
    frame.x < 0 ||
    frame.y < 0 ||
    frame.x + frame.width > sourceWidth ||
    frame.y + frame.height > sourceHeight
  ) {
    throw new Error('Generative patch source frame is invalid');
  }

  const sourceFill = (node.fills ?? []).find(
    (fill) => fill.type === 'image' && fill.image && !fill.image.generativeEditOverlay,
  );
  const image = sourceFill?.type === 'image' ? sourceFill.image : undefined;
  if (!image) throw new Error('Source image placement is unavailable');
  if (image.perspective) {
    throw new Error(
      'Generative patches cannot be placed on perspective-warped image fills yet. Flatten or remove the perspective transform first.',
    );
  }
  if (image.fit === 'tile') {
    throw new Error(
      'Generative patches cannot be placed on tiled image fills. Flatten or change the image fit first.',
    );
  }

  const declaredWidth = image.imageWidth ?? sourceWidth;
  const declaredHeight = image.imageHeight ?? sourceHeight;
  if (!nearlyEqual(declaredWidth, sourceWidth) || !nearlyEqual(declaredHeight, sourceHeight)) {
    throw new Error('Generative patch source dimensions do not match the image placement');
  }

  const bounds = nodeLocalBounds(node, doc);
  if (!bounds) throw new Error('Source image bounds are unavailable');
  const placement = computeImagePlacement({
    fit: image.fit,
    sourceWidth,
    sourceHeight,
    bounds,
    x: image.x,
    y: image.y,
    scale: image.scale,
    sourceCrop: image.crop,
    rotation: image.rotation,
    flipH: image.flipH,
    flipV: image.flipV,
  });
  if (!placement) throw new Error('Source image placement is invalid');

  const sourceRight = frame.x + frame.width;
  const sourceBottom = frame.y + frame.height;
  if (
    frame.x < placement.sourceRect.x ||
    frame.y < placement.sourceRect.y ||
    sourceRight > placement.sourceRect.x + placement.sourceRect.w ||
    sourceBottom > placement.sourceRect.y + placement.sourceRect.h
  ) {
    throw new Error(
      'The generated patch extends outside the visible image crop. Expand the crop or paint a smaller mask.',
    );
  }

  const destination = {
    x: placement.drawRect.x + (frame.x / sourceWidth) * placement.drawRect.w,
    y: placement.drawRect.y + (frame.y / sourceHeight) * placement.drawRect.h,
    width: (frame.width / sourceWidth) * placement.drawRect.w,
    height: (frame.height / sourceHeight) * placement.drawRect.h,
  };
  const scaleX = destination.width / patchWidth;
  const scaleY = destination.height / patchHeight;
  if (!finitePositive(scaleX) || !finitePositive(scaleY) || !nearlyEqual(scaleX, scaleY)) {
    throw new Error(
      'The image placement scales the patch non-uniformly. Flatten or use a uniform image placement first.',
    );
  }

  return {
    ...frame,
    localX: destination.x - bounds.x,
    localY: destination.y - bounds.y,
    scale: (scaleX + scaleY) / 2,
    ...(placement.rotation !== 0 ? { rotation: placement.rotation } : {}),
    ...(placement.flipH ? { flipH: true } : {}),
    ...(placement.flipV ? { flipV: true } : {}),
  };
}
