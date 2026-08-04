import type { Document, SceneNode } from '@varve/scene';
import { getImageFill, isImageShape } from '@varve/scene';
import { nodeWorldBounds } from '../scene/world';

export interface ImageCompareOverlayProps {
  active: boolean;
  /** Currently selected nodes; the overlay only applies to a single selected image. */
  selection: SceneNode[];
  document: Document;
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
}

/**
 * ImageCompareOverlay — "before" view for a single selected image.
 *
 * Draws the image's original source bytes (fill.image.src, unaffected by any
 * effects/adjustment layers stacked on or above it) directly over its current
 * on-canvas position, so toggling reveals the unedited original. Pure DOM
 * overlay — does not touch the render pipeline or mutate the document, same
 * approach as SoftProofOverlay.
 */
export function ImageCompareOverlay({
  active,
  selection,
  document,
  worldToCanvas,
}: ImageCompareOverlayProps) {
  if (!active || selection.length !== 1) return null;
  const node = selection[0]!;
  if (!isImageShape(node)) return null;
  const fill = getImageFill(node as import('@varve/scene').ShapeNode);
  const src = fill?.image?.src;
  if (!src) return null;

  const bounds = nodeWorldBounds(document, node.id);
  if (!bounds) return null;

  const topLeft = worldToCanvas(bounds.x, bounds.y);
  const bottomRight = worldToCanvas(bounds.x + bounds.w, bounds.y + bounds.h);
  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;
  if (width <= 0 || height <= 0) return null;

  return (
    <div
      className="image-compare-overlay"
      data-testid="image-compare-overlay"
      style={{
        position: 'absolute',
        left: topLeft.x,
        top: topLeft.y,
        width,
        height,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 15,
      }}
    >
      <img
        src={src}
        alt="Original, before edits"
        style={{
          width: '100%',
          height: '100%',
          objectFit: fill?.image?.fit === 'fit' ? 'contain' : 'fill',
          display: 'block',
        }}
      />
      <span className="image-compare-overlay__label">Before</span>
    </div>
  );
}
