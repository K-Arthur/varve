/**
 * Graph Editor — visual curve editor for animation easing and keyframe values.
 *
 * Renders a 2D canvas where the X axis is time (0–1 progress) and the Y axis is
 * the property value. Each property track becomes a colored curve, with draggable
 * keyframe handles and tangent control points.
 *
 * Research basis: After Effects Graph Editor, Cavalry Driven Graph, Figma
 * Smart Animate curves, CSS cubic-bezier editor patterns.
 */
import type { AnimationTrack, Timeline } from '@varve/scene';
import { getEasingFn } from '@varve/shared';
import { type FC, useCallback, useMemo, useRef, useState } from 'react';
import './GraphEditor.css';

/** Hit target radius for graph editor keyframe circles. */
const KEYFRAME_HIT_R = 8;

const KEYFRAME_VISUAL_R = 4;
const KEYFRAME_HOVER_R = 5;

export interface GraphEditorProps {
  timeline: Timeline;
  tracks: AnimationTrack[];
  selectedTrackIds: string[];
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  onMoveKeyframe?: (
    timelineId: string,
    trackId: string,
    oldProgress: number,
    newProgress: number,
  ) => void;
  onUpdateEasing?: (
    timelineId: string,
    trackId: string,
    progress: number,
    easing: import('@varve/shared').EasingDefinition,
  ) => void;
}

interface CurvePoint {
  x: number;
  y: number;
  keyframeIndex: number;
  trackId?: string;
}

export const GraphEditor: FC<GraphEditorProps> = ({
  timeline,
  tracks,
  selectedTrackIds,
  currentTime,
  duration,
  onSeek,
  onMoveKeyframe,
  onUpdateEasing,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<CurvePoint | null>(null);
  const [focusedPoint, setFocusedPoint] = useState<CurvePoint | null>(null);
  const [dragging, setDragging] = useState<{
    trackId: string;
    keyframeIndex: number;
    startProgress: number;
  } | null>(null);

  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const width = 800;
  const height = 200;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const visibleTracks = useMemo(() => {
    if (selectedTrackIds.length > 0) {
      return tracks.filter((t) => selectedTrackIds.includes(t.id));
    }
    return tracks.filter((t) => t.enabled !== false);
  }, [tracks, selectedTrackIds]);

  const valueRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const track of visibleTracks) {
      for (const kf of track.keyframes) {
        const v = typeof kf.value === 'number' ? kf.value : 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) {
      min = 0;
      max = 1;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.1;
    return { min: min - pad, max: max + pad };
  }, [visibleTracks]);

  const progressToX = useCallback(
    (progress: number) => padding.left + progress * plotWidth,
    [plotWidth],
  );

  const valueToY = useCallback(
    (value: number) => {
      const { min, max } = valueRange;
      return padding.top + (1 - (value - min) / (max - min)) * plotHeight;
    },
    [valueRange, plotHeight],
  );

  const xToProgress = useCallback(
    (x: number) => Math.max(0, Math.min(1, (x - padding.left) / plotWidth)),
    [plotWidth],
  );

  const generateCurvePath = useCallback(
    (track: AnimationTrack): string => {
      const kfs = [...track.keyframes].sort((a, b) => a.progress - b.progress);
      if (kfs.length === 0) return '';
      if (kfs.length === 1) {
        const x = progressToX(kfs[0]!.progress);
        const y = valueToY(typeof kfs[0]!.value === 'number' ? kfs[0]!.value : 0);
        return `M ${x} ${y}`;
      }

      const points: string[] = [];
      const steps = Math.max(20, kfs.length * 10);

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        let value = 0;

        // Find which segment we're in
        let segStart = 0;
        let segEnd = kfs.length - 1;
        for (let s = 0; s < kfs.length - 1; s++) {
          if (t >= kfs[s]!.progress && t <= kfs[s + 1]!.progress) {
            segStart = s;
            segEnd = s + 1;
            break;
          }
        }

        const from = kfs[segStart]!;
        const to = kfs[segEnd]!;
        const segDuration = to.progress - from.progress;
        const localT = segDuration > 0 ? (t - from.progress) / segDuration : 0;

        const fromVal = typeof from.value === 'number' ? from.value : 0;
        const toVal = typeof to.value === 'number' ? to.value : 0;

        if (from.easing) {
          const fn = getEasingFn(from.easing);
          const easedT = fn(localT);
          value = fromVal + (toVal - fromVal) * easedT;
        } else {
          value = fromVal + (toVal - fromVal) * localT;
        }

        const x = progressToX(t);
        const y = valueToY(value);
        points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
      }

      return points.join(' ');
    },
    [progressToX, valueToY],
  );

  const playheadX = duration > 0 ? progressToX(currentTime / duration) : padding.left;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * width;
      const progress = xToProgress(x);

      // Click on the ruler area = seek
      if (e.clientY - rect.top < padding.top) {
        onSeek(progress * duration);
        return;
      }

      // Check if clicking near a keyframe
      for (const track of visibleTracks) {
        for (let i = 0; i < track.keyframes.length; i++) {
          const kf = track.keyframes[i]!;
          const kx = progressToX(kf.progress);
          const ky = valueToY(typeof kf.value === 'number' ? kf.value : 0);
          const dist = Math.hypot(x - kx, e.clientY - rect.top - ky);
          if (dist < 8) {
            // Shift+click cycles easing
            if (e.shiftKey && onUpdateEasing) {
              const easings = ['linear', 'ease', 'easeIn', 'easeOut', 'easeInOut'] as const;
              const currentIdx = easings.indexOf(
                (kf.easing?.kind ?? 'linear') as (typeof easings)[number],
              );
              const nextEasing = easings[(currentIdx + 1) % easings.length]!;
              onUpdateEasing(timeline.id, track.id, kf.progress, { kind: nextEasing });
              return;
            }
            setDragging({ trackId: track.id, keyframeIndex: i, startProgress: kf.progress });
            return;
          }
        }
      }
    },
    [
      visibleTracks,
      xToProgress,
      progressToX,
      valueToY,
      onSeek,
      duration,
      width,
      padding.top,
      onUpdateEasing,
      timeline.id,
    ],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!dragging || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * width;
      const newProgress = xToProgress(x);

      if (onMoveKeyframe) {
        const track = visibleTracks.find((t) => t.id === dragging.trackId);
        if (track) {
          const oldKf = track.keyframes[dragging.keyframeIndex]!;
          if (oldKf) {
            onMoveKeyframe(timeline.id, dragging.trackId, oldKf.progress, newProgress);
          }
        }
      }
    },
    [dragging, visibleTracks, timeline.id, xToProgress, onMoveKeyframe, width],
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  return (
    <div className="graph-editor" role="application" aria-label="Graph editor">
      <div className="graph-editor__header">
        <span className="graph-editor__title">Graph Editor</span>
        {visibleTracks.length > 0 && (
          <span className="graph-editor__info">
            {visibleTracks.length} track{visibleTracks.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <svg
        ref={svgRef}
        className="graph-editor__svg"
        viewBox={`0 0 ${width} ${height}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        role="img"
        aria-label="Animation curve graph editor"
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <line
            key={`vg-${p}`}
            x1={progressToX(p)}
            y1={padding.top}
            x2={progressToX(p)}
            y2={padding.top + plotHeight}
            className="graph-editor__grid-line"
          />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const val = valueRange.min + (valueRange.max - valueRange.min) * p;
          return (
            <line
              key={`hg-${p}`}
              x1={padding.left}
              y1={valueToY(val)}
              x2={padding.left + plotWidth}
              y2={valueToY(val)}
              className="graph-editor__grid-line"
            />
          );
        })}

        {/* Axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <text
            key={`xl-${p}`}
            x={progressToX(p)}
            y={height - 5}
            className="graph-editor__axis-label"
            textAnchor="middle"
          >
            {(p * 100).toFixed(0)}%
          </text>
        ))}
        {[0, 0.5, 1].map((p) => {
          const val = valueRange.min + (valueRange.max - valueRange.min) * p;
          return (
            <text
              key={`yl-${p}`}
              x={padding.left - 5}
              y={valueToY(val) + 4}
              className="graph-editor__axis-label"
              textAnchor="end"
            >
              {val.toFixed(1)}
            </text>
          );
        })}

        {/* Curves */}
        {visibleTracks.map((track, ti) => {
          const path = generateCurvePath(track);
          if (!path) return null;
          const trackTone = `t${ti % 8}`;
          return (
            <g key={track.id}>
              <path d={path} className={`graph-editor__curve graph-editor__curve--${trackTone}`} />
              {/* Keyframe dots */}
              {track.keyframes.map((kf, ki) => {
                const x = progressToX(kf.progress);
                const y = valueToY(typeof kf.value === 'number' ? kf.value : 0);
                const isHovered =
                  hoveredPoint?.trackId === track.id && hoveredPoint?.keyframeIndex === ki;
                const isFocused =
                  focusedPoint?.trackId === track.id && focusedPoint?.keyframeIndex === ki;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: keyframes move during drag; index is the stable identity within the track (no model id)
                  <g key={ki}>
                    {/* Transparent HTML button overlaid for accessible keyframe interaction */}
                    <foreignObject
                      x={x - KEYFRAME_HIT_R}
                      y={y - KEYFRAME_HIT_R}
                      width={KEYFRAME_HIT_R * 2}
                      height={KEYFRAME_HIT_R * 2}
                    >
                      <button
                        type="button"
                        style={{
                          width: '100%',
                          height: '100%',
                          opacity: 0,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                        aria-label={`Keyframe at ${(kf.progress * 100).toFixed(0)}%, value ${typeof kf.value === 'number' ? kf.value.toFixed(2) : 'auto'}`}
                        onFocus={() =>
                          setFocusedPoint({
                            x,
                            y,
                            keyframeIndex: ki,
                            trackId: track.id,
                          } as CurvePoint & { trackId: string })
                        }
                        onBlur={() => setFocusedPoint(null)}
                        onKeyDown={(e) => {
                          const step = e.shiftKey ? 0.1 : 0.02;
                          let newProgress = kf.progress;
                          if (e.key === 'ArrowLeft') newProgress = Math.max(0, kf.progress - step);
                          else if (e.key === 'ArrowRight')
                            newProgress = Math.min(1, kf.progress + step);
                          else if (e.key === 'Delete' || e.key === 'Backspace') {
                            if (onMoveKeyframe) {
                              // Move to -1 progress as a delete signal — caller interprets
                              onMoveKeyframe(timeline.id, track.id, kf.progress, -1);
                            }
                            e.preventDefault();
                            return;
                          }
                          if (newProgress !== kf.progress && onMoveKeyframe) {
                            onMoveKeyframe(timeline.id, track.id, kf.progress, newProgress);
                            e.preventDefault();
                          }
                        }}
                      />
                    </foreignObject>
                    <circle
                      cx={x}
                      cy={y}
                      r={isHovered || isFocused ? KEYFRAME_HOVER_R : KEYFRAME_VISUAL_R}
                      className={`graph-editor__keyframe-dot graph-editor__keyframe-dot--${trackTone}${isFocused ? ' graph-editor__keyframe-dot--focused' : ''}`}
                      tabIndex={-1}
                      aria-hidden
                      onMouseEnter={() =>
                        setHoveredPoint({
                          x,
                          y,
                          keyframeIndex: ki,
                          trackId: track.id,
                        } as CurvePoint & { trackId: string })
                      }
                      onMouseLeave={() => setHoveredPoint(null)}
                    />
                    {(isHovered || isFocused) && kf.spatialTangents && (
                      <>
                        {/* Tangent-in arm */}
                        <line
                          x1={x}
                          y1={y}
                          x2={x + kf.spatialTangents.ti[0] * plotWidth}
                          y2={y - kf.spatialTangents.ti[1] * plotHeight * 0.1}
                          stroke="var(--color-accent-primary, #39d0c6)"
                          strokeWidth={1}
                          opacity={0.5}
                          aria-hidden
                        />
                        <circle
                          cx={x + kf.spatialTangents.ti[0] * plotWidth}
                          cy={y - kf.spatialTangents.ti[1] * plotHeight * 0.1}
                          r={3}
                          fill="var(--color-accent-primary, #39d0c6)"
                          style={{ cursor: 'grab', pointerEvents: 'auto' }}
                          aria-hidden
                        />
                        {/* Tangent-out arm */}
                        <line
                          x1={x}
                          y1={y}
                          x2={x + kf.spatialTangents.to[0] * plotWidth}
                          y2={y - kf.spatialTangents.to[1] * plotHeight * 0.1}
                          stroke="var(--color-accent-primary, #39d0c6)"
                          strokeWidth={1}
                          opacity={0.5}
                          aria-hidden
                        />
                        <circle
                          cx={x + kf.spatialTangents.to[0] * plotWidth}
                          cy={y - kf.spatialTangents.to[1] * plotHeight * 0.1}
                          r={3}
                          fill="var(--color-accent-primary, #39d0c6)"
                          style={{ cursor: 'grab', pointerEvents: 'auto' }}
                          aria-hidden
                        />
                      </>
                    )}
                    {(isHovered || isFocused) && (
                      <title>
                        {track.nodeId}.{track.property} ={' '}
                        {(typeof kf.value === 'number' ? kf.value : 0).toFixed(2)}
                      </title>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Playhead */}
        <line
          x1={playheadX}
          y1={padding.top}
          x2={playheadX}
          y2={padding.top + plotHeight}
          className="graph-editor__playhead"
        />
      </svg>
    </div>
  );
};
