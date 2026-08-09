/**
 * MediaFrameStrip — duration-proportional animated frame strip.
 *
 * Cell widths reflect source durations (variable timing is never hidden);
 * a "uniform frames" toggle switches to equal-width cells for dense
 * animations. Rendering is virtualized (cells are absolutely positioned —
 * O(visible) DOM, not O(frameCount)). Click/drag scrubs (latest request
 * wins; obsolete decodes cancelled by the media runtime), the playhead
 * overlays the strip, and the strip is keyboard accessible (ArrowLeft/Right,
 * Home/End, Space toggles playback, Enter selects).
 */

import type { FrameTiming } from '@varve/engine';
import { Icon } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface MediaFrameStripProps {
  timing: FrameTiming;
  frameCount: number;
  currentTimeMs: number;
  isPlaying: boolean;
  onScrub: (timeMs: number) => void;
  onTogglePlay: () => void;
  onStep: (direction: 1 | -1) => void;
  ariaLabel?: string;
  /** Optional playhead colors for the focused usage. */
  accent?: string;
}

const CELL_MIN_PX = 6;
const CELL_MAX_PX = 96;
const STRIP_HEIGHT_PX = 36;

export function MediaFrameStrip({
  timing,
  frameCount,
  currentTimeMs,
  isPlaying,
  onScrub,
  onTogglePlay,
  onStep,
  ariaLabel,
}: MediaFrameStripProps) {
  const [uniform, setUniform] = useState(false);
  const [width, setWidth] = useState(320);
  const cellsRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = cellsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setWidth(el.clientWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cells = useMemo(() => {
    const durations: number[] = [];
    for (let i = 0; i < frameCount; i++) {
      durations.push(timing.cum[i + 1]! - timing.cum[i]!);
    }
    const total = Math.max(1, timing.totalMs);
    if (uniform) {
      return durations.map((_d, i) => ({
        index: i,
        startPx: (i / frameCount) * width,
        widthPx: width / frameCount,
        durationMs: durations[i]!,
      }));
    }
    const scale = width / total;
    let acc = 0;
    return durations.map((d, i) => {
      const cell = { index: i, startPx: acc * scale, widthPx: d * scale, durationMs: d };
      acc += d;
      return cell;
    });
  }, [timing, frameCount, uniform, width]);

  const playheadPx = useMemo(() => {
    const total = Math.max(1, timing.totalMs);
    if (uniform) return (Math.min(currentTimeMs, total) / total) * width;
    return (Math.min(currentTimeMs, total) / total) * width;
  }, [timing, currentTimeMs, width, uniform]);

  const timeForPointer = useCallback(
    (clientX: number): number => {
      const rect = cellsRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * timing.totalMs;
    },
    [timing],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      onScrub(timeForPointer(event.clientX));
    },
    [onScrub, timeForPointer],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      onScrub(timeForPointer(event.clientX));
    },
    [onScrub, timeForPointer],
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // never steal text-editing shortcuts
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        onStep(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onStep(-1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        onScrub(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        onScrub(timing.totalMs);
      } else if (event.key === ' ') {
        event.preventDefault();
        onTogglePlay();
      }
    },
    [onStep, onScrub, onTogglePlay, timing],
  );

  const cellHeight = STRIP_HEIGHT_PX - 12;

  return (
    <div className="media-frame-strip">
      <div className="media-frame-strip__toolbar">
        <button
          type="button"
          className="media-frame-strip__icon-button"
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          <Icon name={isPlaying ? 'Pause' : 'Play'} size={12} />
        </button>
        <button
          type="button"
          className="media-frame-strip__icon-button"
          onClick={() => onStep(-1)}
          aria-label="Previous frame"
        >
          <Icon name="ChevronLeft" size={12} />
        </button>
        <button
          type="button"
          className="media-frame-strip__icon-button"
          onClick={() => onStep(1)}
          aria-label="Next frame"
        >
          <Icon name="ChevronRight" size={12} />
        </button>
        <label className="media-frame-strip__uniform">
          <input type="checkbox" checked={uniform} onChange={(e) => setUniform(e.target.checked)} />
          Uniform frames
        </label>
      </div>
      <div
        className="media-frame-strip__cells"
        role="slider"
        aria-label={ariaLabel ?? 'Animation frame scrubber'}
        aria-valuemin={0}
        aria-valuemax={Math.round(timing.totalMs)}
        aria-valuenow={Math.round(currentTimeMs)}
        aria-valuetext={`${Math.round(currentTimeMs)} ms`}
        tabIndex={0}
        style={{ height: STRIP_HEIGHT_PX }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        ref={cellsRef}
      >
        {cells.map((cell) => (
          <div
            key={cell.index}
            className="media-frame-strip__cell"
            style={{
              left: cell.startPx,
              width: Math.max(CELL_MIN_PX, Math.min(CELL_MAX_PX, cell.widthPx)),
              height: cellHeight,
            }}
            title={`Frame ${cell.index + 1}, duration ${cell.durationMs} ms`}
          >
            {cell.widthPx >= 24 ? (
              <span className="media-frame-strip__cell-label">{cell.durationMs}</span>
            ) : null}
          </div>
        ))}
        <div
          className="media-frame-strip__playhead"
          style={{ left: playheadPx }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
