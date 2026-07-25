/**
 * CropOverlay — dim outside crop window + resize handles for CropTool.
 *
 * Design: the overlay provides interaction chrome (dim, crop window,
 * resize handles, action buttons). The image preview is rendered on a
 * dedicated canvas element using the same computeImagePlacement() and
 * traceOutline() logic as the authoritative CanvasArea renderer,
 * ensuring pixel parity between the interactive preview and the
 * committed canvas output.
 *
 * For non-rectangular shapes (ellipse, circle, polygon, star, path),
 * the preview canvas clips to the shape outline before drawing the
 * image, matching the final composited result.
 *
 * Research basis: Figma image crop, Canva crop handle pattern.
 */
import { computeImagePlacement } from '@strata/engine';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import type { LocalCropRect } from '../imageCrop';
import type { CropTool } from '../tools/CropTool';
import './CropOverlay.css';

export interface CropOverlayProps {
  tool: CropTool;
  /** Screen bounds of the full image node (canvas-local). */
  screenBounds: { x: number; y: number; w: number; h: number };
  /** Image source URL for the preview overlay. */
  imageSrc?: string;
  /** Natural image width in pixels (from fill metadata). */
  imageWidth?: number;
  /** Natural image height in pixels (from fill metadata). */
  imageHeight?: number;
  /** Shape kind for non-rectangular clipping (rect if omitted). */
  shapeKind?: string;
  /** Shape-specific parameters for traceOutline. */
  shapeParams?: Record<string, unknown>;
  onDone: () => void;
  onCancel: () => void;
}

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

function clampCrop(rect: LocalCropRect, maxW: number, maxH: number): LocalCropRect {
  let { x, y, w, h } = rect;
  w = Math.max(8, w);
  h = Math.max(8, h);
  x = Math.max(0, Math.min(x, maxW - w));
  y = Math.max(0, Math.min(y, maxH - h));
  w = Math.min(w, maxW - x);
  h = Math.min(h, maxH - y);
  return { x, y, w, h };
}

/** Trace a shape outline path on a canvas context (mirrors traceOutline from replay.ts). */
function traceShapeOutline(
  ctx: CanvasRenderingContext2D,
  kind: string,
  params: Record<string, unknown>,
  offsetX: number,
  offsetY: number,
): void {
  const TAU = Math.PI * 2;
  ctx.beginPath();
  switch (kind) {
    case 'rect': {
      const x = (params.x as number) ?? 0;
      const y = (params.y as number) ?? 0;
      const w = (params.w as number) ?? 200;
      const h = (params.h as number) ?? 160;
      ctx.rect(offsetX + x, offsetY + y, w, h);
      break;
    }
    case 'ellipse': {
      const cx = offsetX + ((params.cx as number) ?? 0);
      const cy = offsetY + ((params.cy as number) ?? 0);
      const rx = (params.rx as number) ?? 100;
      const ry = (params.ry as number) ?? 80;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      break;
    }
    case 'circle': {
      const cx = offsetX + ((params.cx as number) ?? 0);
      const cy = offsetY + ((params.cy as number) ?? 0);
      const r = (params.r as number) ?? 100;
      ctx.arc(cx, cy, r, 0, TAU);
      break;
    }
    case 'polygon': {
      const cx = offsetX + ((params.cx as number) ?? 0);
      const cy = offsetY + ((params.cy as number) ?? 0);
      const radius = (params.radius as number) ?? 100;
      const sides = (params.sides as number) ?? 6;
      const rotation = (params.rotation as number) ?? 0;
      for (let i = 0; i < sides; i++) {
        const a = (TAU * i) / sides - Math.PI / 2 + rotation;
        const px = cx + radius * Math.cos(a);
        const py = cy + radius * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'star': {
      const cx = offsetX + ((params.cx as number) ?? 0);
      const cy = offsetY + ((params.cy as number) ?? 0);
      const outerR = (params.outerRadius as number) ?? 100;
      const innerR = (params.innerRadius as number) ?? 50;
      const points = (params.points as number) ?? 5;
      const rotation = (params.rotation as number) ?? 0;
      for (let i = 0; i < points * 2; i++) {
        const a = (Math.PI * i) / points - Math.PI / 2 + rotation;
        const r = i % 2 === 0 ? outerR : innerR;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default:
      ctx.rect(offsetX, offsetY, (params.w as number) ?? 200, (params.h as number) ?? 160);
      break;
  }
}

export function CropOverlay({
  tool,
  screenBounds,
  imageSrc,
  imageWidth,
  imageHeight,
  shapeKind = 'rect',
  shapeParams = {},
  onDone,
  onCancel,
}: CropOverlayProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const dragRef = useRef<{
    handle: Handle;
    startCrop: LocalCropRect;
    startX: number;
    startY: number;
  } | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<CanvasImageSource | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => tool.subscribe(() => bump()), [tool]);

  useEffect(() => {
    if (!imageSrc) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!cancelled) {
        imageRef.current = img;
        setImageLoaded(true);
      }
    };
    img.onerror = () => {
      if (!cancelled) setImageLoaded(false);
    };
    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  // Draw preview canvas whenever state changes
  useEffect(() => {
    const canvas = previewRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !imageSrc) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cropState = tool.getCropState();
    const nodeSize = tool.getNodeSize();
    if (!cropState || !nodeSize) return;

    const fillScale = cropState.fillScale ?? 1;
    const fillOffX = cropState.fillOffsetX ?? 0;
    const fillOffY = cropState.fillOffsetY ?? 0;
    const fillFit = cropState.fillFit ?? 'crop';
    const srcW = imageWidth ?? nodeSize.w;
    const srcH = imageHeight ?? nodeSize.h;

    const placement = computeImagePlacement({
      fit: fillFit,
      sourceWidth: srcW,
      sourceHeight: srcH,
      bounds: { x: 0, y: 0, w: nodeSize.w, h: nodeSize.h },
      x: fillOffX,
      y: fillOffY,
      scale: fillScale,
    });

    canvas.width = Math.ceil(screenBounds.w);
    canvas.height = Math.ceil(screenBounds.h);

    const sx = screenBounds.w / nodeSize.w;
    const sy = screenBounds.h / nodeSize.h;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (placement) {
      ctx.save();
      // Scale from node-local to screen space
      ctx.scale(sx, sy);

      // Clip to shape outline for non-rect shapes
      if (shapeKind !== 'rect') {
        traceShapeOutline(ctx, shapeKind, shapeParams, 0, 0);
        ctx.clip();
      }

      // Draw the image at the placement position
      ctx.drawImage(
        img,
        placement.drawRect.x,
        placement.drawRect.y,
        placement.drawRect.w,
        placement.drawRect.h,
      );

      ctx.restore();
    }

    // Apply dim to regions outside the crop window
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    // Left of crop
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clear crop window (reveal the image)
    const left = cropState.viewport.x * sx;
    const top = cropState.viewport.y * sy;
    const cw = cropState.viewport.w * sx;
    const ch = cropState.viewport.h * sy;
    ctx.clearRect(left, top, cw, ch);
    ctx.restore();
  }, [tool, screenBounds, imageSrc, imageWidth, imageHeight, shapeKind, shapeParams, imageLoaded]);

  const cropState = tool.getCropState();
  const crop = tool.getCropRect();
  const nodeSize = tool.getNodeSize();
  if (!cropState || !crop || !nodeSize || screenBounds.w <= 0 || screenBounds.h <= 0) return null;

  const sx = screenBounds.w / nodeSize.w;
  const sy = screenBounds.h / nodeSize.h;
  const left = screenBounds.x + crop.x * sx;
  const top = screenBounds.y + crop.y * sy;
  const width = crop.w * sx;
  const height = crop.h * sy;

  const onPointerDown = (handle: Handle) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      handle,
      startCrop: { ...crop },
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / sx;
    const dy = (e.clientY - drag.startY) / sy;
    const next = { ...drag.startCrop };
    const h = drag.handle;
    if (h === 'move') {
      next.x += dx;
      next.y += dy;
    } else {
      if (h.includes('e')) next.w = drag.startCrop.w + dx;
      if (h.includes('s')) next.h = drag.startCrop.h + dy;
      if (h.includes('w')) {
        next.x = drag.startCrop.x + dx;
        next.w = drag.startCrop.w - dx;
      }
      if (h.includes('n')) {
        next.y = drag.startCrop.y + dy;
        next.h = drag.startCrop.h - dy;
      }
    }
    tool.setCropRect(clampCrop(next, nodeSize.w, nodeSize.h));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const current = cropState.fillScale ?? 1;
    tool.setFillScale(current * delta);
  };

  const handles: Handle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];

  return (
    <div className="crop-overlay" data-testid="crop-overlay">
      {/* Canvas preview — renders image through same placement math as main renderer */}
      <canvas
        ref={previewRef}
        className="crop-overlay__preview"
        style={{
          position: 'absolute',
          left: screenBounds.x,
          top: screenBounds.y,
          width: screenBounds.w,
          height: screenBounds.h,
          pointerEvents: 'none',
        }}
      />
      {/* Clear crop window — handles + badge */}
      <div
        className="crop-overlay__window"
        style={{ left, top, width, height, overflow: 'hidden' }}
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {handles.map((h) => (
          <button
            key={h}
            type="button"
            className={`crop-overlay__handle crop-overlay__handle--${h}`}
            aria-label={`Resize crop ${h}`}
            onPointerDown={onPointerDown(h)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        ))}
        {/* Fit-mode badge */}
        <div className="crop-overlay__badge">{cropState.fillFit ?? 'crop'}</div>
      </div>
      <div
        className="crop-overlay__actions"
        style={{ left: left + width / 2, top: top + height + 8 }}
      >
        <button type="button" className="crop-overlay__btn" onClick={onDone}>
          Done
        </button>
        <button
          type="button"
          className="crop-overlay__btn crop-overlay__btn--ghost"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function useReducer(reducer: (n: number) => number, initial: number): [number, () => void] {
  const [state, dispatch] = useState(initial);
  const dispatchAction = () => dispatch(reducer);
  return [state, dispatchAction];
}
