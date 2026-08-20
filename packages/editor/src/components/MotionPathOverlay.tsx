/**
 * Motion path overlay — visual path and keyframe editing for animated positions.
 *
 * Displays the trajectory of animated position/transform tracks as a visible
 * curve on the canvas, with draggable keyframe points and spatial tangent
 * handles (After Effects-style).
 *
 * Research basis: Adobe After Effects motion paths (ti/to handles),
 * Blender 3D Viewport motion path visualization, Figma Smart Animate.
 */
import type { AnimationKeyframe, AnimationTrack } from '@varve/scene';
import { getEasingFn } from '@varve/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { editorScreenToWorld } from '../canvas/cameraState';
import { useEditor } from '../context';

interface MotionPathPoint {
  x: number;
  y: number;
  timeMs: number;
  isKeyframe: boolean;
  keyframeIndex: number;
  spatialTangents?: AnimationKeyframe['spatialTangents'];
}

export interface MotionPathState {
  enabled: boolean;
  showKeyframes: boolean;
  showHandles: boolean;
  showVelocity: boolean;
  samplesPerSegment: number;
}

export const DEFAULT_MOTION_PATH: MotionPathState = {
  enabled: true,
  showKeyframes: true,
  showHandles: true,
  showVelocity: false,
  samplesPerSegment: 16,
};

interface MotionPathOverlayProps {
  canvasSize: { width: number; height: number };
  zoom: number;
  pan: { x: number; y: number };
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
  screenToWorld?: (sx: number, sy: number) => { x: number; y: number };
}

export function MotionPathOverlay({
  canvasSize,
  zoom,
  pan: _pan,
  worldToCanvas,
  screenToWorld: _screenToWorld,
}: MotionPathOverlayProps) {
  const editor = useEditor();
  const { state } = editor;
  const isMotionWorkspace = state.workspaceMode === 'motion';
  const timelineId = state.motion.activeTimelineId;
  const timeline = timelineId ? state.document.timelines?.[timelineId] : null;

  const dragRef = useRef<{
    trackId: string;
    keyframeIndex: number;
    startProgress: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const positionTracks = useMemo(() => {
    if (!timeline) return [];
    return timeline.tracks.filter(
      (t) =>
        t.property === 'transform' ||
        t.property.startsWith('transform[') ||
        t.property === 'position' ||
        t.property === 'x' ||
        t.property === 'y',
    );
  }, [timeline]);

  const sampledPath = useMemo(() => {
    if (!timeline || positionTracks.length === 0) return null;

    const samples: { x: number; y: number; time: number }[] = [];
    const numSamples = Math.max(50, Math.floor(timeline.duration / 10));

    for (let i = 0; i <= numSamples; i++) {
      const t = timeline.duration * (i / numSamples);
      const sample = interpolateTrackPositions(positionTracks, t, timeline.duration);
      if (sample) {
        samples.push({ ...sample, time: t });
      }
    }

    return samples;
  }, [timeline, positionTracks]);

  const keyframePoints = useMemo(() => {
    if (!timeline) return [];
    const points: MotionPathPoint[] = [];

    for (const track of positionTracks) {
      for (let i = 0; i < track.keyframes.length; i++) {
        const kf = track.keyframes[i]!;
        const value = getKeyframePositionValue(kf);
        if (value) {
          points.push({
            x: value.x,
            y: value.y,
            timeMs: kf.progress * timeline.duration,
            isKeyframe: true,
            keyframeIndex: i,
            spatialTangents: kf.spatialTangents,
          });
        }
      }
    }

    return points;
  }, [timeline, positionTracks]);

  const handleKeyframeDragStart = useCallback(
    (trackId: string, keyframeIndex: number, startProgress: number) => {
      dragRef.current = { trackId, keyframeIndex, startProgress };
      setDragging(true);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current || !timeline || !canvasSize.width) return;
      const vp = canvasSize;
      const cam = { zoom: state.zoom, pan: state.pan, cameraRotation: state.cameraRotation ?? 0 };
      const world = editorScreenToWorld(cam, e.clientX, e.clientY, vp);
      const track = timeline.tracks.find((t) => t.id === dragRef.current!.trackId);
      if (!track) return;
      const kf = track.keyframes[dragRef.current!.keyframeIndex];
      if (!kf) return;
      const newProgress = Math.max(0, Math.min(1, world[0] / Math.max(1, vp.width)));
      if (Math.abs(newProgress - kf.progress) > 0.001) {
        editor.moveKeyframe(timeline.id, track.id, kf.progress, newProgress);
      }
    },
    [timeline, canvasSize, state.zoom, state.pan, state.cameraRotation, editor],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      handlePointerMove(e as unknown as React.PointerEvent);
    };
    const onUp = () => handlePointerUp();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, handlePointerMove, handlePointerUp]);

  if (!isMotionWorkspace || !timeline || positionTracks.length === 0 || !sampledPath) {
    return null;
  }

  const pathD = sampledPath
    .map((p, i) => {
      const sp = worldToCanvas(p.x, p.y);
      return `${i === 0 ? 'M' : 'L'}${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      className="motion-path-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        width: canvasSize.width,
        height: canvasSize.height,
        pointerEvents: 'none',
        zIndex: 6,
        overflow: 'visible',
      }}
      aria-hidden="true"
    >
      <path
        d={pathD}
        fill="none"
        stroke="var(--color-accent-primary, #39d0c6)"
        strokeWidth={2 / zoom}
        strokeDasharray={`${4 / zoom}, ${4 / zoom}`}
        opacity={0.7}
      />

      {keyframePoints.map((kp, _i) => {
        const sp = worldToCanvas(kp.x, kp.y);
        const isCurrent = Math.abs(kp.timeMs - state.motion.currentTime) < 8;

        return (
          <g
            key={`kf-${kp.timeMs}-${kp.keyframeIndex}`}
            style={{ pointerEvents: 'auto', cursor: dragging ? 'grabbing' : 'grab' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              if (timeline) {
                const track = positionTracks.find((t) =>
                  t.keyframes.some((_, ki) => ki === kp.keyframeIndex),
                );
                if (track) {
                  handleKeyframeDragStart(
                    track.id,
                    kp.keyframeIndex,
                    kp.timeMs / timeline.duration,
                  );
                }
              }
            }}
          >
            <circle
              cx={sp.x}
              cy={sp.y}
              r={isCurrent ? 6 / zoom : 4 / zoom}
              fill={isCurrent ? 'var(--color-accent-primary)' : 'var(--color-surface-raised)'}
              stroke="var(--color-accent-primary)"
              strokeWidth={1.5 / zoom}
            />
          </g>
        );
      })}
    </svg>
  );
}

function getKeyframePositionValue(kf: AnimationKeyframe): { x: number; y: number } | null {
  const v = kf.value;
  if (typeof v === 'number') return { x: v, y: 0 };
  if (Array.isArray(v)) {
    if (v.length >= 6) return { x: v[4] as number, y: v[5] as number };
    if (v.length >= 2) return { x: v[0] as number, y: v[1] as number };
  }
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.x === 'number' && typeof obj.y === 'number') {
      return { x: obj.x, y: obj.y };
    }
  }
  return null;
}

function interpolateTrackPositions(
  tracks: AnimationTrack[],
  timeMs: number,
  duration: number,
): { x: number; y: number } | null {
  const results: Record<string, number> = {};

  for (const track of tracks) {
    const kfs = track.keyframes;
    if (kfs.length === 0) continue;

    const progress = duration > 0 ? timeMs / duration : 0;

    if (kfs.length === 1) {
      const val = getKeyframePositionValue(kfs[0]!);
      if (val) {
        if (track.property === 'x' || track.property.endsWith('.x')) results.x = val.x;
        if (track.property === 'y' || track.property.endsWith('.y')) results.y = val.y;
        if (track.property === 'transform' || track.property === 'position') {
          results.x = val.x;
          results.y = val.y;
        }
      }
      continue;
    }

    let before = kfs[0]!;
    let after = kfs[kfs.length - 1]!;

    for (let i = 0; i < kfs.length - 1; i++) {
      if (progress >= kfs[i]!.progress && progress <= kfs[i + 1]!.progress) {
        before = kfs[i]!;
        after = kfs[i + 1]!;
        break;
      }
    }

    const segmentDuration = after.progress - before.progress;
    const localT = segmentDuration > 0 ? (progress - before.progress) / segmentDuration : 0;

    const easing = before.easing ?? { kind: 'linear' };
    const easedT = getEasingFn(easing)(localT);

    const beforeVal = getKeyframePositionValue(before);
    const afterVal = getKeyframePositionValue(after);

    if (beforeVal && afterVal) {
      if (track.property === 'x' || track.property.endsWith('.x')) {
        results.x = beforeVal.x + (afterVal.x - beforeVal.x) * easedT;
      } else if (track.property === 'y' || track.property.endsWith('.y')) {
        results.y = beforeVal.y + (afterVal.y - beforeVal.y) * easedT;
      } else {
        results.x = beforeVal.x + (afterVal.x - beforeVal.x) * easedT;
        results.y = beforeVal.y + (afterVal.y - beforeVal.y) * easedT;
      }
    }
  }

  if (results.x !== undefined || results.y !== undefined) {
    return { x: results.x ?? 0, y: results.y ?? 0 };
  }

  return null;
}
