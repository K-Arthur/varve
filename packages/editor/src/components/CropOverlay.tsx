/**
 * CropOverlay — dim outside crop window + resize handles for CropTool.
 */
import { type PointerEvent as ReactPointerEvent, useEffect, useReducer, useRef } from 'react';
import type { LocalCropRect } from '../imageCrop';
import type { CropTool } from '../tools/CropTool';
import './CropOverlay.css';

export interface CropOverlayProps {
  tool: CropTool;
  /** Screen bounds of the full image node (canvas-local). */
  screenBounds: { x: number; y: number; w: number; h: number };
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

export function CropOverlay({ tool, screenBounds, onDone, onCancel }: CropOverlayProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const dragRef = useRef<{
    handle: Handle;
    startCrop: LocalCropRect;
    startX: number;
    startY: number;
  } | null>(null);

  useEffect(() => tool.subscribe(() => bump()), [tool]);

  const crop = tool.getCropRect();
  const nodeSize = tool.getNodeSize();
  if (!crop || !nodeSize || screenBounds.w <= 0 || screenBounds.h <= 0) return null;

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

  const handles: Handle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];

  return (
    <div className="crop-overlay" data-testid="crop-overlay">
      {/* Dim full image */}
      <div
        className="crop-overlay__dim"
        style={{
          left: screenBounds.x,
          top: screenBounds.y,
          width: screenBounds.w,
          height: screenBounds.h,
        }}
      />
      {/* Clear crop window (cut hole via box-shadow trick on window) */}
      <div
        className="crop-overlay__window"
        style={{ left, top, width, height }}
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
