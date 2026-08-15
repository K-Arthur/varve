/**
 * CropOverlay — dim outside crop window + resize handles for CropTool.
 *
 * The authoritative canvas remains visible beneath this interaction-only
 * chrome. Crop mode must not introduce a second image decode or rendering
 * path that can diverge from committed output.
 *
 * Research basis: Figma image crop, Canva crop handle pattern.
 */
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import type { LocalCropRect } from '../imageCrop';
import type { CropTool } from '../tools/CropTool';
import './CropOverlay.css';

export interface CropOverlayProps {
  tool: CropTool;
  /** Screen bounds of the full image node (canvas-local). */
  screenBounds: { x: number; y: number; w: number; h: number };
  /** @deprecated Retained for compatibility; rendering stays on the authoritative canvas. */
  imageSrc?: string;
  /** @deprecated Interaction chrome does not decode image resources. */
  imageWidth?: number;
  /** @deprecated Interaction chrome does not decode image resources. */
  imageHeight?: number;
  /** @deprecated Shape clipping is owned by the authoritative renderer. */
  shapeKind?: string;
  /** @deprecated Shape clipping is owned by the authoritative renderer. */
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

interface CropResizeOptions {
  preserveAspect?: boolean;
  centered?: boolean;
}

export function computeCropResize(
  start: LocalCropRect,
  handle: Handle,
  dx: number,
  dy: number,
  bounds: { w: number; h: number },
  options: CropResizeOptions = {},
): LocalCropRect {
  if (handle === 'move') {
    return clampCrop({ ...start, x: start.x + dx, y: start.y + dy }, bounds.w, bounds.h);
  }

  const east = handle.includes('e');
  const west = handle.includes('w');
  const north = handle.includes('n');
  const south = handle.includes('s');
  let w = start.w + (east ? dx : 0) - (west ? dx : 0);
  let h = start.h + (south ? dy : 0) - (north ? dy : 0);
  if (options.centered) {
    w = start.w + (east ? 2 * dx : 0) - (west ? 2 * dx : 0);
    h = start.h + (south ? 2 * dy : 0) - (north ? 2 * dy : 0);
  }

  w = Math.max(8, w);
  h = Math.max(8, h);
  if (options.preserveAspect) {
    const aspect = start.w / start.h;
    const widthScale = w / start.w;
    const heightScale = h / start.h;
    if ((east || west) && !(north || south)) {
      h = w / aspect;
    } else if ((north || south) && !(east || west)) {
      w = h * aspect;
    } else if (Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)) {
      h = w / aspect;
    } else {
      w = h * aspect;
    }
  }

  const centerX = start.x + start.w / 2;
  const centerY = start.y + start.h / 2;
  const x = options.centered ? centerX - w / 2 : west ? start.x + start.w - w : start.x;
  const y = options.centered ? centerY - h / 2 : north ? start.y + start.h - h : start.y;
  return clampCrop({ x, y, w, h }, bounds.w, bounds.h);
}

export function CropOverlay({ tool, screenBounds, onDone, onCancel }: CropOverlayProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    handle: Handle;
    startCrop: LocalCropRect;
    startFillOffsetX: number;
    startFillOffsetY: number;
    startX: number;
    startY: number;
  } | null>(null);
  useEffect(() => tool.subscribe(() => bump()), [tool]);
  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

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
      startFillOffsetX: cropState.fillOffsetX ?? 0,
      startFillOffsetY: cropState.fillOffsetY ?? 0,
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / sx;
    const dy = (e.clientY - drag.startY) / sy;
    if (drag.handle === 'move') {
      tool.setFillOffset(drag.startFillOffsetX + dx, drag.startFillOffsetY + dy);
      return;
    }
    tool.setCropRect(
      computeCropResize(drag.startCrop, drag.handle, dx, dy, nodeSize, {
        preserveAspect: e.shiftKey,
        centered: e.altKey,
      }),
    );
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onDone();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handles: Handle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
  const onHandleKeyDown = (handle: Handle) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    tool.setCropRect(
      computeCropResize(crop, handle, dx, dy, nodeSize, {
        preserveAspect: e.shiftKey,
        centered: e.altKey,
      }),
    );
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-label="Crop image"
      className="crop-overlay"
      data-testid="crop-overlay"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <div
        className="crop-overlay__window"
        style={{ left, top, width, height }}
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
            onKeyDown={onHandleKeyDown(h)}
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
