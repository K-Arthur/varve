import type { SpatialBlurEffect } from '@varve/engine';
import type { NodeId } from '@varve/scene';
import type { Affine, Point, Rect } from '@varve/shared';
import { applyAffine, tryInvertAffine } from '@varve/shared';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';

type SpatialAuthoringEffect = Exclude<
  SpatialBlurEffect,
  Extract<SpatialBlurEffect, { type: 'gaussianBlur' }>
>;
type HandleKind =
  | 'field-pin'
  | 'iris-center'
  | 'iris-radius'
  | 'iris-rotation'
  | 'tilt-center'
  | 'tilt-angle'
  | 'tilt-feather'
  | 'path-point'
  | 'spin-center'
  | 'spin-pivot'
  | 'spin-radius'
  | 'spin-angle';

interface DragTarget {
  kind: HandleKind;
  index: number;
  secondaryIndex?: number;
}

interface BlurGalleryOverlayProps {
  nodeId: NodeId;
  effect: SpatialAuthoringEffect;
  bounds: Rect;
  worldTransform: Affine;
  canvasToWorld: (x: number, y: number) => { x: number; y: number };
  worldToCanvas: (x: number, y: number) => { x: number; y: number };
  onChange: (effect: SpatialAuthoringEffect) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  onEditCancel?: () => void;
}

const HANDLE_RADIUS = 7;
const MAX_NORMALIZED_POSITION = 1.5;
const MIN_NORMALIZED_POSITION = -0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rotate(point: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos];
}

function localPoint(bounds: Rect, x: number, y: number): Point {
  return [bounds.x + x * bounds.w, bounds.y + y * bounds.h];
}

function normalizedPoint(bounds: Rect, point: Point): { x: number; y: number } {
  return {
    x: clamp(
      (point[0] - bounds.x) / Math.max(1e-6, bounds.w),
      MIN_NORMALIZED_POSITION,
      MAX_NORMALIZED_POSITION,
    ),
    y: clamp(
      (point[1] - bounds.y) / Math.max(1e-6, bounds.h),
      MIN_NORMALIZED_POSITION,
      MAX_NORMALIZED_POSITION,
    ),
  };
}

function lineEndpoints(center: Point, direction: Point, extent: number): [Point, Point] {
  return [
    [center[0] - direction[0] * extent, center[1] - direction[1] * extent],
    [center[0] + direction[0] * extent, center[1] + direction[1] * extent],
  ];
}

function pointsToPath(points: readonly { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function sampleEllipse(center: Point, radii: Point, rotation: number, count = 48): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const theta = (index / count) * Math.PI * 2;
    const rotated = rotate([radii[0] * Math.cos(theta), radii[1] * Math.sin(theta)], rotation);
    return [rotated[0] + center[0], rotated[1] + center[1]];
  });
}

function pointForTiltHandle(
  bounds: Rect,
  center: { x: number; y: number },
  angle: number,
  offsetPixels: number,
): Point {
  const normal: Point = [-Math.sin(angle), Math.cos(angle)];
  return localPoint(
    bounds,
    center.x + (normal[0] * offsetPixels) / Math.max(1, bounds.w),
    center.y + (normal[1] * offsetPixels) / Math.max(1, bounds.h),
  );
}

function ownerToScreen(
  local: Point,
  worldTransform: Affine,
  worldToCanvas: (x: number, y: number) => { x: number; y: number },
): { x: number; y: number } {
  const world = applyAffine(worldTransform, local);
  return worldToCanvas(world[0], world[1]);
}

function eventToLocal(
  event: PointerEvent,
  svg: SVGSVGElement,
  worldTransform: Affine,
  canvasToWorld: (x: number, y: number) => { x: number; y: number },
): Point | null {
  const rect = svg.getBoundingClientRect();
  const world = canvasToWorld(event.clientX - rect.left, event.clientY - rect.top);
  const inverse = tryInvertAffine(worldTransform);
  if (!inverse) return null;
  return applyAffine(inverse, [world.x, world.y]);
}

function updateEffectAtPoint(
  effect: SpatialAuthoringEffect,
  target: DragTarget,
  bounds: Rect,
  local: Point,
): SpatialAuthoringEffect {
  const normalized = normalizedPoint(bounds, local);
  switch (effect.type) {
    case 'fieldBlur':
      return {
        ...effect,
        pins: effect.pins.map((pin, index) =>
          index === target.index ? { ...pin, x: normalized.x, y: normalized.y } : pin,
        ),
      };
    case 'irisBlur': {
      const region = effect.regions[target.index];
      if (!region) return effect;
      if (target.kind === 'iris-center') {
        return {
          ...effect,
          regions: effect.regions.map((candidate, index) =>
            index === target.index ? { ...candidate, center: normalized } : candidate,
          ),
        };
      }
      const center = localPoint(bounds, region.center.x, region.center.y);
      const delta: Point = [local[0] - center[0], local[1] - center[1]];
      if (target.kind === 'iris-rotation') {
        return {
          ...effect,
          regions: effect.regions.map((candidate, index) =>
            index === target.index
              ? { ...candidate, rotation: Math.atan2(delta[1], delta[0]) }
              : candidate,
          ),
        };
      }
      const unrotated = rotate(delta, -region.rotation);
      return {
        ...effect,
        regions: effect.regions.map((candidate, index) =>
          index === target.index
            ? {
                ...candidate,
                radii: {
                  ...candidate.radii,
                  x: clamp(Math.abs(unrotated[0]) / Math.max(1, bounds.w), 0.01, 2),
                },
              }
            : candidate,
        ),
      };
    }
    case 'tiltShiftBlur': {
      const region = effect.regions[target.index];
      if (!region) return effect;
      if (target.kind === 'tilt-center') {
        return {
          ...effect,
          regions: effect.regions.map((candidate, index) =>
            index === target.index ? { ...candidate, center: normalized } : candidate,
          ),
        };
      }
      const center = localPoint(bounds, region.center.x, region.center.y);
      const delta: Point = [local[0] - center[0], local[1] - center[1]];
      if (target.kind === 'tilt-angle') {
        return {
          ...effect,
          regions: effect.regions.map((candidate, index) =>
            index === target.index
              ? { ...candidate, angle: Math.atan2(delta[1], delta[0]) }
              : candidate,
          ),
        };
      }
      const normal: Point = [-Math.sin(region.angle), Math.cos(region.angle)];
      const offset = Math.abs(delta[0] * normal[0] + delta[1] * normal[1]);
      return {
        ...effect,
        regions: effect.regions.map((candidate, index) =>
          index === target.index
            ? {
                ...candidate,
                feather: Math.max(
                  0,
                  offset / Math.max(Math.abs(normal[0]), Math.abs(normal[1]), 1e-6),
                ),
              }
            : candidate,
        ),
      };
    }
    case 'pathBlur':
      return {
        ...effect,
        paths: effect.paths.map((path, pathIndex) =>
          pathIndex !== target.index
            ? path
            : {
                ...path,
                points: path.points.map((point, pointIndex) =>
                  pointIndex === target.secondaryIndex
                    ? { ...point, x: normalized.x, y: normalized.y }
                    : point,
                ),
              },
        ),
      };
    case 'spinBlur': {
      if (target.kind === 'spin-center' || target.kind === 'spin-pivot') {
        const key = target.kind === 'spin-center' ? 'center' : 'pivot';
        return { ...effect, [key]: normalized } as SpatialAuthoringEffect;
      }
      if (target.kind === 'spin-angle') {
        const center = localPoint(bounds, effect.center.x, effect.center.y);
        return { ...effect, angle: Math.atan2(local[1] - center[1], local[0] - center[0]) };
      }
      const center = localPoint(bounds, effect.center.x, effect.center.y);
      const delta: Point = [local[0] - center[0], local[1] - center[1]];
      const unrotated = rotate(delta, -effect.rotation);
      return {
        ...effect,
        radii: {
          x: clamp(Math.abs(unrotated[0]) / Math.max(1, bounds.w), 0.01, 2),
          y: effect.radii.y,
        },
      };
    }
  }
}

function Handle({
  point,
  label,
  active,
  onPointerDown,
  onPointerUp,
  onKeyDown,
}: {
  point: { x: number; y: number };
  label: string;
  active: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGCircleElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGCircleElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<SVGCircleElement>) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG geometry is the visible hit target; a button cannot replace a transformed circle.
    <circle
      cx={point.x}
      cy={point.y}
      r={active ? HANDLE_RADIUS + 2 : HANDLE_RADIUS}
      fill="var(--color-accent-primary, #39d0c6)"
      stroke="var(--color-surface-raised, #fff)"
      strokeWidth={2}
      role="button"
      tabIndex={0}
      aria-label={label}
      style={{ pointerEvents: 'auto', cursor: active ? 'grabbing' : 'grab', outline: 'none' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}

export function BlurGalleryOverlay({
  nodeId,
  effect,
  bounds,
  worldTransform,
  canvasToWorld,
  worldToCanvas,
  onChange,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: BlurGalleryOverlayProps) {
  const [dragging, setDragging] = useState<DragTarget | null>(null);
  const dragRef = useRef<{ target: DragTarget; pointerId: number; svg: SVGSVGElement } | null>(
    null,
  );
  const cleanupRef = useRef<(() => void) | null>(null);
  const initialEffectRef = useRef<SpatialAuthoringEffect | null>(null);
  const finishDragRef = useRef<(outcome: 'commit' | 'cancel') => void>(() => undefined);

  const toScreen = useCallback(
    (point: Point) => ownerToScreen(point, worldTransform, worldToCanvas),
    [worldToCanvas, worldTransform],
  );

  const finishDrag = useCallback(
    (outcome: 'commit' | 'cancel') => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      dragRef.current = null;
      setDragging(null);
      if (outcome === 'cancel' && initialEffectRef.current) onChange(initialEffectRef.current);
      initialEffectRef.current = null;
      if (outcome === 'commit') onEditEnd?.();
      else onEditCancel?.();
    },
    [onChange, onEditCancel, onEditEnd],
  );

  useEffect(() => {
    finishDragRef.current = finishDrag;
  }, [finishDrag]);

  useEffect(
    () => () => {
      if (dragRef.current) finishDragRef.current('cancel');
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, target: DragTarget) => {
      if (event.button !== 0 || dragRef.current) return;
      const svg = event.currentTarget.ownerSVGElement;
      if (!svg) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = { target, pointerId: event.pointerId, svg };
      initialEffectRef.current = effect;
      setDragging(target);
      onEditStart?.();
      const onMove = (moveEvent: PointerEvent) => {
        const active = dragRef.current;
        if (!active || moveEvent.pointerId !== active.pointerId) return;
        const local = eventToLocal(moveEvent, active.svg, worldTransform, canvasToWorld);
        if (local) onChange(updateEffectAtPoint(effect, active.target, bounds, local));
      };
      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== activePointerId(target, dragRef.current)) return;
        const active = dragRef.current;
        const local = active && eventToLocal(upEvent, active.svg, worldTransform, canvasToWorld);
        if (active && local) onChange(updateEffectAtPoint(effect, active.target, bounds, local));
        finishDrag('commit');
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === activePointerId(target, dragRef.current))
          finishDrag('cancel');
      };
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [bounds, canvasToWorld, effect, finishDrag, onChange, onEditStart, worldTransform],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGCircleElement>, target: DragTarget) => {
      if (
        event.key !== 'ArrowLeft' &&
        event.key !== 'ArrowRight' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'ArrowDown'
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 0.02 : 0.005;
      const delta: Point = [
        event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
        event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
      ];
      const current = handleLocalPoint(effect, target, bounds);
      if (!current) return;
      onEditStart?.();
      onChange(
        updateEffectAtPoint(effect, target, bounds, [
          current[0] + delta[0] * bounds.w,
          current[1] + delta[1] * bounds.h,
        ]),
      );
      onEditEnd?.();
    },
    [bounds, effect, onChange, onEditEnd, onEditStart],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, target: DragTarget) => {
      const active = dragRef.current;
      if (!active || !sameTarget(active.target, target) || event.pointerId !== active.pointerId)
        return;
      const svg = event.currentTarget.ownerSVGElement;
      if (!svg) return;
      const local = eventToLocal(event.nativeEvent, svg, worldTransform, canvasToWorld);
      if (local) onChange(updateEffectAtPoint(effect, target, bounds, local));
      finishDrag('commit');
    },
    [bounds, canvasToWorld, effect, finishDrag, onChange, worldTransform],
  );

  if (bounds.w <= 0 || bounds.h <= 0) return null;

  const handle = (local: Point, target: DragTarget, label: string) => {
    const screen = toScreen(local);
    return (
      <Handle
        key={`${target.kind}-${target.index}-${target.secondaryIndex ?? ''}`}
        point={screen}
        label={`${label} for ${nodeId}`}
        active={
          dragging?.kind === target.kind &&
          dragging.index === target.index &&
          dragging.secondaryIndex === target.secondaryIndex
        }
        onPointerDown={(event) => handlePointerDown(event, target)}
        onPointerUp={(event) => handlePointerUp(event, target)}
        onKeyDown={(event) => handleKeyDown(event, target)}
      />
    );
  };

  const renderField = () => {
    if (effect.type !== 'fieldBlur') return null;
    const points = effect.pins.map((pin) => toScreen(localPoint(bounds, pin.x, pin.y)));
    return (
      <g data-blur-overlay="field">
        <path
          d={pointsToPath(points)}
          fill="none"
          stroke="var(--color-accent-primary, #39d0c6)"
          strokeDasharray="5 5"
          opacity={0.45}
        />
        {effect.pins.map((pin, index) =>
          handle(
            localPoint(bounds, pin.x, pin.y),
            { kind: 'field-pin', index },
            `Field blur pin ${index + 1}`,
          ),
        )}
      </g>
    );
  };

  const renderIris = () => {
    if (effect.type !== 'irisBlur') return null;
    return effect.regions.map((region, index) => {
      const center = localPoint(bounds, region.center.x, region.center.y);
      const radius = [region.radii.x * bounds.w, region.radii.y * bounds.h] as Point;
      const path = pointsToPath(
        sampleEllipse(center, radius, region.rotation).map((point) => toScreen(point)),
      );
      const radiusHandle = [
        center[0] + Math.cos(region.rotation) * radius[0],
        center[1] + Math.sin(region.rotation) * radius[0],
      ] as Point;
      const rotationHandle = [
        center[0] + Math.cos(region.rotation) * radius[0] * 0.65,
        center[1] + Math.sin(region.rotation) * radius[0] * 0.65,
      ] as Point;
      return (
        <g key={region.id} data-blur-overlay="iris">
          <path
            d={path}
            fill="none"
            stroke="var(--color-accent-primary, #39d0c6)"
            strokeWidth={2}
            strokeDasharray="6 4"
            opacity={0.8}
          />
          {handle(center, { kind: 'iris-center', index }, `Iris ${index + 1} center`)}
          {handle(radiusHandle, { kind: 'iris-radius', index }, `Iris ${index + 1} radius`)}
          {handle(rotationHandle, { kind: 'iris-rotation', index }, `Iris ${index + 1} rotation`)}
        </g>
      );
    });
  };

  const renderTilt = () => {
    if (effect.type !== 'tiltShiftBlur') return null;
    return effect.regions.map((region, index) => {
      const center = localPoint(bounds, region.center.x, region.center.y);
      const direction: Point = [
        Math.cos(region.angle) / Math.max(1, bounds.w),
        Math.sin(region.angle) / Math.max(1, bounds.h),
      ];
      const normal: Point = [
        -Math.sin(region.angle) / Math.max(1, bounds.w),
        Math.cos(region.angle) / Math.max(1, bounds.h),
      ];
      const extent = Math.hypot(bounds.w, bounds.h) * 1.5;
      const lines = [
        lineEndpoints(center, direction, extent),
        lineEndpoints(
          pointForTiltHandle(bounds, region.center, region.angle, region.sharpHalfWidth),
          direction,
          extent,
        ),
        lineEndpoints(
          pointForTiltHandle(bounds, region.center, region.angle, -region.sharpHalfWidth),
          direction,
          extent,
        ),
        lineEndpoints(
          pointForTiltHandle(
            bounds,
            region.center,
            region.angle,
            region.sharpHalfWidth + region.feather,
          ),
          direction,
          extent,
        ),
        lineEndpoints(
          pointForTiltHandle(
            bounds,
            region.center,
            region.angle,
            -region.sharpHalfWidth - region.feather,
          ),
          direction,
          extent,
        ),
      ];
      const lineLabels = [
        'center',
        'sharp-positive',
        'sharp-negative',
        'feather-positive',
        'feather-negative',
      ];
      const angleHandle: Point = [
        center[0] + normal[0] * Math.min(bounds.w, bounds.h) * 0.25,
        center[1] + normal[1] * Math.min(bounds.w, bounds.h) * 0.25,
      ];
      const featherHandle = pointForTiltHandle(
        bounds,
        region.center,
        region.angle,
        region.sharpHalfWidth + region.feather,
      );
      return (
        <g key={region.id} data-blur-overlay="tilt-shift">
          {lines.map((line, lineIndex) => {
            const start = toScreen(line[0]);
            const end = toScreen(line[1]);
            return (
              <line
                key={lineLabels[lineIndex]}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke="var(--color-accent-primary, #39d0c6)"
                strokeDasharray={lineIndex === 0 ? undefined : '6 4'}
                opacity={lineIndex === 0 ? 0.35 : lineIndex < 3 ? 0.8 : 0.45}
              />
            );
          })}
          {handle(center, { kind: 'tilt-center', index }, `Tilt-Shift ${index + 1} center`)}
          {handle(angleHandle, { kind: 'tilt-angle', index }, `Tilt-Shift ${index + 1} angle`)}
          {handle(
            featherHandle,
            { kind: 'tilt-feather', index },
            `Tilt-Shift ${index + 1} feather`,
          )}
        </g>
      );
    });
  };

  const renderPath = () => {
    if (effect.type !== 'pathBlur') return null;
    return effect.paths.map((path, pathIndex) => {
      const points = path.points.map((point) => toScreen(localPoint(bounds, point.x, point.y)));
      return (
        <g key={path.id} data-blur-overlay="path">
          <path
            d={pointsToPath(points)}
            fill="none"
            stroke="var(--color-accent-primary, #39d0c6)"
            strokeWidth={2}
            strokeDasharray="7 4"
            opacity={0.85}
          />
          {path.points.map((point, pointIndex) =>
            handle(
              localPoint(bounds, point.x, point.y),
              { kind: 'path-point', index: pathIndex, secondaryIndex: pointIndex },
              `Path ${pathIndex + 1} point ${pointIndex + 1}`,
            ),
          )}
        </g>
      );
    });
  };

  const renderSpin = () => {
    if (effect.type !== 'spinBlur') return null;
    const center = localPoint(bounds, effect.center.x, effect.center.y);
    const radius: Point = [effect.radii.x * bounds.w, effect.radii.y * bounds.h];
    const ellipse = pointsToPath(
      sampleEllipse(center, radius, effect.rotation).map((point) => toScreen(point)),
    );
    const angleHandle: Point = [
      center[0] + Math.cos(effect.angle) * radius[0],
      center[1] + Math.sin(effect.angle) * radius[0],
    ];
    const radiusHandle: Point = [
      center[0] + Math.cos(effect.rotation) * radius[0],
      center[1] + Math.sin(effect.rotation) * radius[0],
    ];
    return (
      <g data-blur-overlay="spin">
        <path
          d={ellipse}
          fill="none"
          stroke="var(--color-accent-primary, #39d0c6)"
          strokeWidth={2}
          strokeDasharray="6 4"
          opacity={0.8}
        />
        {handle(center, { kind: 'spin-center', index: 0 }, 'Spin blur region center')}
        {handle(
          localPoint(bounds, effect.pivot.x, effect.pivot.y),
          { kind: 'spin-pivot', index: 0 },
          'Spin blur pivot',
        )}
        {handle(radiusHandle, { kind: 'spin-radius', index: 0 }, 'Spin blur radius')}
        {handle(angleHandle, { kind: 'spin-angle', index: 0 }, 'Spin blur angle')}
      </g>
    );
  };

  return (
    <svg
      data-testid="blur-gallery-overlay"
      data-blur-type={effect.type}
      data-blur-dragging={dragging ? 'true' : 'false'}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX,
      }}
      aria-label={`${effect.type} authoring controls`}
    >
      <title>{`${effect.type} authoring controls`}</title>
      {renderField()}
      {renderIris()}
      {renderTilt()}
      {renderPath()}
      {renderSpin()}
    </svg>
  );
}

function handleLocalPoint(
  effect: SpatialAuthoringEffect,
  target: DragTarget,
  bounds: Rect,
): Point | null {
  switch (effect.type) {
    case 'fieldBlur': {
      const pin = effect.pins[target.index];
      return pin ? localPoint(bounds, pin.x, pin.y) : null;
    }
    case 'irisBlur': {
      const region = effect.regions[target.index];
      if (!region) return null;
      const center = localPoint(bounds, region.center.x, region.center.y);
      if (target.kind === 'iris-center') return center;
      const radius = region.radii.x * bounds.w;
      return [
        center[0] + Math.cos(region.rotation) * radius,
        center[1] + Math.sin(region.rotation) * radius,
      ];
    }
    case 'tiltShiftBlur': {
      const region = effect.regions[target.index];
      if (!region) return null;
      const center = localPoint(bounds, region.center.x, region.center.y);
      if (target.kind === 'tilt-center') return center;
      if (target.kind === 'tilt-angle') {
        return [
          center[0] - Math.sin(region.angle) * Math.min(bounds.w, bounds.h) * 0.25,
          center[1] + Math.cos(region.angle) * Math.min(bounds.w, bounds.h) * 0.25,
        ];
      }
      return pointForTiltHandle(
        bounds,
        region.center,
        region.angle,
        region.sharpHalfWidth + region.feather,
      );
    }
    case 'pathBlur': {
      const path = effect.paths[target.index];
      const point = path?.points[target.secondaryIndex ?? -1];
      return point ? localPoint(bounds, point.x, point.y) : null;
    }
    case 'spinBlur': {
      if (target.kind === 'spin-center')
        return localPoint(bounds, effect.center.x, effect.center.y);
      if (target.kind === 'spin-pivot') return localPoint(bounds, effect.pivot.x, effect.pivot.y);
      const center = localPoint(bounds, effect.center.x, effect.center.y);
      if (target.kind === 'spin-angle')
        return [
          center[0] + Math.cos(effect.angle) * effect.radii.x * bounds.w,
          center[1] + Math.sin(effect.angle) * effect.radii.x * bounds.w,
        ];
      return [
        center[0] + Math.cos(effect.rotation) * effect.radii.x * bounds.w,
        center[1] + Math.sin(effect.rotation) * effect.radii.x * bounds.w,
      ];
    }
  }
}

function activePointerId(
  target: DragTarget,
  session: { target: DragTarget; pointerId: number } | null,
): number | null {
  if (!session || !sameTarget(session.target, target)) return null;
  return session.pointerId;
}

function sameTarget(a: DragTarget, b: DragTarget): boolean {
  return a.kind === b.kind && a.index === b.index && a.secondaryIndex === b.secondaryIndex;
}
