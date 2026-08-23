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

export type CropAspectLabel = 'free' | 'original' | '1:1' | '4:3' | '3:2' | '16:9' | 'custom';

export interface CropAspectPreset {
  label: CropAspectLabel;
  ratio: number | null;
}

export const CROP_ASPECT_PRESETS: readonly CropAspectPreset[] = [
  { label: 'free', ratio: null },
  { label: 'original', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
  { label: 'custom', ratio: null },
] as const;

export type CropGuideMode = 'none' | 'thirds' | 'golden' | 'diagonals';

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
  /** Explicit aspect ratio (w/h). When set, overrides the dynamic ratio from start.w/start.h. */
  aspectRatio?: number;
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
    const aspect = options.aspectRatio ?? start.w / start.h;
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

/** Render composition guide lines inside the crop window. */
function CropGuides({
  mode,
  width,
  height,
}: {
  mode: CropGuideMode;
  width: number;
  height: number;
}) {
  if (mode === 'none' || width < 2 || height < 2) return null;

  const stroke = 'rgba(255,255,255,0.45)';
  const sw = 1;
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];

  if (mode === 'thirds') {
    for (let i = 1; i <= 2; i++) {
      const fx = (i / 3) * width;
      lines.push({ x1: fx, y1: 0, x2: fx, y2: height });
      const fy = (i / 3) * height;
      lines.push({ x1: 0, y1: fy, x2: width, y2: fy });
    }
  } else if (mode === 'golden') {
    const phi = 1.618033988749895;
    const gx1 = width / phi;
    const gx2 = width - gx1;
    const gy1 = height / phi;
    const gy2 = height - gy1;
    lines.push({ x1: gx1, y1: 0, x2: gx1, y2: height });
    lines.push({ x1: gx2, y1: 0, x2: gx2, y2: height });
    lines.push({ x1: 0, y1: gy1, x2: width, y2: gy1 });
    lines.push({ x1: 0, y1: gy2, x2: width, y2: gy2 });
  } else if (mode === 'diagonals') {
    lines.push({ x1: 0, y1: 0, x2: width, y2: height });
    lines.push({ x1: width, y1: 0, x2: 0, y2: height });
  }

  return (
    <svg
      className="crop-overlay__guides"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height }}
      aria-hidden
    >
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={stroke} strokeWidth={sw} />
      ))}
    </svg>
  );
}

/** Toolbar for crop aspect ratio and guide controls. */
function CropToolbar({
  activeRatio,
  onRatioChange,
  guideMode,
  onGuideChange,
  originalRatio,
  straightenAngle,
  onStraightenChange,
}: {
  activeRatio: CropAspectLabel;
  onRatioChange: (preset: CropAspectPreset) => void;
  guideMode: CropGuideMode;
  onGuideChange: (mode: CropGuideMode) => void;
  originalRatio: number;
  straightenAngle: number;
  onStraightenChange: (angle: number) => void;
}) {
  void originalRatio;
  return (
    <div className="crop-toolbar" role="toolbar" aria-label="Crop options">
      <div className="crop-toolbar__group" role="radiogroup" aria-label="Aspect ratio">
        {CROP_ASPECT_PRESETS.map((preset) => {
          const label =
            preset.label === 'original'
              ? 'Original'
              : preset.label === 'free'
                ? 'Free'
                : preset.label;
          return (
            <button
              key={preset.label}
              type="button"
              role="radio"
              aria-checked={activeRatio === preset.label}
              className={`crop-toolbar__btn ${activeRatio === preset.label ? 'crop-toolbar__btn--active' : ''}`}
              onClick={() => onRatioChange(preset)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="crop-toolbar__separator" />
      <div className="crop-toolbar__group" role="radiogroup" aria-label="Guides">
        {(['none', 'thirds', 'golden', 'diagonals'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={guideMode === mode}
            className={`crop-toolbar__btn ${guideMode === mode ? 'crop-toolbar__btn--active' : ''}`}
            onClick={() => onGuideChange(mode)}
          >
            {mode === 'none'
              ? 'No guides'
              : mode === 'thirds'
                ? 'Thirds'
                : mode === 'golden'
                  ? 'Golden'
                  : 'Diags'}
          </button>
        ))}
      </div>
      <div className="crop-toolbar__separator" />
      <div className="crop-toolbar__group">
        <label className="crop-toolbar__label" htmlFor="crop-straighten">
          Straighten
        </label>
        <input
          id="crop-straighten"
          type="range"
          min={-45}
          max={45}
          step={0.1}
          value={straightenAngle}
          onChange={(e) => onStraightenChange(Number.parseFloat(e.target.value))}
          className="crop-toolbar__range"
          aria-label="Straighten angle"
        />
        <span className="crop-toolbar__value">
          {straightenAngle === 0
            ? '0'
            : `${straightenAngle > 0 ? '+' : ''}${straightenAngle.toFixed(1)}°`}
        </span>
      </div>
    </div>
  );
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

  const [aspectLabel, setAspectLabel] = useState<CropAspectLabel>('free');
  const [lockedRatio, setLockedRatio] = useState<number | null>(null);
  const [guideMode, setGuideMode] = useState<CropGuideMode>('none');
  const [straightenAngle, setStraightenAngle] = useState(0);

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

  const originalRatio = nodeSize.w / nodeSize.h;

  const handleRatioChange = (preset: CropAspectPreset) => {
    setAspectLabel(preset.label);
    if (preset.label === 'original') {
      setLockedRatio(nodeSize.w / nodeSize.h);
    } else if (preset.label === 'custom' || preset.ratio === null) {
      setLockedRatio(null);
    } else {
      setLockedRatio(preset.ratio);
    }
  };

  const handleStraightenChange = (angle: number) => {
    setStraightenAngle(angle);
    tool.setStraightenAngle(angle);
  };

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
    const effectiveRatio = lockedRatio ?? (e.shiftKey ? drag.startCrop.w / drag.startCrop.h : null);
    tool.setCropRect(
      computeCropResize(drag.startCrop, drag.handle, dx, dy, nodeSize, {
        preserveAspect: effectiveRatio !== null,
        centered: e.altKey,
        aspectRatio: effectiveRatio ?? undefined,
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
    const effectiveRatio = lockedRatio ?? (e.shiftKey ? crop.w / crop.h : null);
    tool.setCropRect(
      computeCropResize(crop, handle, dx, dy, nodeSize, {
        preserveAspect: effectiveRatio !== null,
        centered: e.altKey,
        aspectRatio: effectiveRatio ?? undefined,
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
      <CropToolbar
        activeRatio={aspectLabel}
        onRatioChange={handleRatioChange}
        guideMode={guideMode}
        onGuideChange={setGuideMode}
        originalRatio={originalRatio}
        straightenAngle={straightenAngle}
        onStraightenChange={handleStraightenChange}
      />
      <div
        className="crop-overlay__window"
        style={{ left, top, width, height }}
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <CropGuides mode={guideMode} width={width} height={height} />
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
