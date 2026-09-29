import type { Point } from '@varve/shared';
import { useCallback, useRef } from 'react';
import {
  type EditorCameraState,
  editorScreenToWorld,
  editorWorldToScreen,
  getEditorViewport,
} from '../../canvas/cameraState';

export interface PerspectiveSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PerspectiveSegments {
  leftRays: PerspectiveSegment[];
  rightRays: PerspectiveSegment[];
  verticals: PerspectiveSegment[];
}

const MAX_RAYS_PER_POINT = 9;
const MAX_VERTICALS = 9;

function boundedLineCount(value: number, maximum: number): number {
  return Math.max(2, Math.min(maximum, Math.floor(Number.isFinite(value) ? value : 2)));
}

/** Build a small, fixed-cost perspective grid clipped by its SVG viewport. */
export function createTwoPointPerspectiveSegments(
  width: number,
  height: number,
  left: { x: number; y: number },
  right: { x: number; y: number },
  rayCount = 7,
  verticalCount = 7,
): PerspectiveSegments {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    ![left.x, left.y, right.x, right.y].every(Number.isFinite)
  ) {
    return { leftRays: [], rightRays: [], verticals: [] };
  }

  const rays = boundedLineCount(rayCount, MAX_RAYS_PER_POINT);
  const verticals = boundedLineCount(verticalCount, MAX_VERTICALS);
  const leftRays: PerspectiveSegment[] = [];
  const rightRays: PerspectiveSegment[] = [];
  for (let index = 0; index < rays; index += 1) {
    const ratio = index / (rays - 1);
    const targetY = height * (ratio * 1.5 - 0.25);
    leftRays.push({ x1: left.x, y1: left.y, x2: width, y2: targetY });
    rightRays.push({ x1: right.x, y1: right.y, x2: 0, y2: targetY });
  }

  const verticalLines = Array.from({ length: verticals }, (_, index) => {
    const x = (width * index) / (verticals - 1);
    return { x1: x, y1: 0, x2: x, y2: height };
  });
  return { leftRays, rightRays, verticals: verticalLines };
}

type VanishingPointSide = 'left' | 'right';

interface PerspectiveGuideOverlayProps {
  camera: EditorCameraState;
  left: Point;
  right: Point;
  onMovePoint: (side: VanishingPointSide, point: Point) => void;
}

export function PerspectiveGuideOverlay({
  camera,
  left,
  right,
  onMovePoint,
}: PerspectiveGuideOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<{ side: VanishingPointSide; pointerId: number } | null>(null);
  const viewport = getEditorViewport();
  const leftScreen = editorWorldToScreen(camera, left[0], left[1], viewport);
  const rightScreen = editorWorldToScreen(camera, right[0], right[1], viewport);
  const segments = createTwoPointPerspectiveSegments(
    viewport.width,
    viewport.height,
    { x: leftScreen[0], y: leftScreen[1] },
    { x: rightScreen[0], y: rightScreen[1] },
  );

  const movePointAtScreen = useCallback(
    (side: VanishingPointSide, x: number, y: number) => {
      const screenX = Math.max(-viewport.width, Math.min(viewport.width * 2, x));
      const screenY = Math.max(-viewport.height, Math.min(viewport.height * 2, y));
      onMovePoint(side, editorScreenToWorld(camera, screenX, screenY, viewport));
    },
    [camera, onMovePoint, viewport],
  );

  const handlePointerDown = useCallback(
    (side: VanishingPointSide, event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      draggingRef.current = { side, pointerId: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (side: VanishingPointSide, event: React.PointerEvent<HTMLButtonElement>) => {
      if (draggingRef.current?.side !== side || draggingRef.current.pointerId !== event.pointerId) {
        return;
      }
      const bounds = svgRef.current?.getBoundingClientRect();
      if (!bounds) return;
      movePointAtScreen(side, event.clientX - bounds.left, event.clientY - bounds.top);
    },
    [movePointAtScreen],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (draggingRef.current?.pointerId === event.pointerId) draggingRef.current = null;
  }, []);

  const handleKeyDown = useCallback(
    (side: VanishingPointSide, point: Point, event: React.KeyboardEvent<HTMLButtonElement>) => {
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key];
      if (!direction) return;
      event.preventDefault();
      const screen = editorWorldToScreen(camera, point[0], point[1], viewport);
      const step = event.shiftKey ? 32 : 8;
      movePointAtScreen(side, screen[0] + direction[0]! * step, screen[1] + direction[1]! * step);
    },
    [camera, movePointAtScreen, viewport],
  );

  if (viewport.width < 1 || viewport.height < 1) return null;

  const renderLines = (lines: PerspectiveSegment[], className: string) =>
    lines.map((line) => (
      <line
        key={`${className}-${line.x1}-${line.y1}-${line.x2}-${line.y2}`}
        className={className}
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        vectorEffect="non-scaling-stroke"
      />
    ));

  const renderHandle = (side: VanishingPointSide, point: Point, screen: Point) => (
    <button
      key={side}
      className="perspective-guide-overlay__handle"
      data-testid={`perspective-guide-${side}-vanishing-point`}
      data-screen-x={screen[0]}
      type="button"
      aria-label={`${side === 'left' ? 'Left' : 'Right'} vanishing point`}
      style={{
        position: 'absolute',
        left: screen[0],
        top: screen[1],
        transform: 'translate(-50%, -50%)',
        width: 18,
        height: 18,
        padding: 0,
        border: '2px solid var(--color-canvas-guide)',
        borderRadius: '50%',
        background: 'var(--color-surface-app)',
        boxShadow: '0 0 0 1px var(--color-surface-app)',
        pointerEvents: 'auto',
        cursor: 'move',
        touchAction: 'none',
      }}
      onPointerDown={(event) => handlePointerDown(side, event)}
      onPointerMove={(event) => handlePointerMove(side, event)}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={(event) => handleKeyDown(side, point, event)}
    />
  );

  return (
    <div
      className="perspective-guide-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      <svg
        ref={svgRef}
        className="perspective-guide-overlay__svg"
        width={viewport.width}
        height={viewport.height}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <g
          className="perspective-guide-overlay__grid"
          fill="none"
          stroke="var(--color-canvas-guide)"
          strokeOpacity={0.56}
          strokeWidth={1}
          strokeDasharray="5 5"
          pointerEvents="none"
        >
          {renderLines(segments.leftRays, 'perspective-guide-overlay__ray')}
          {renderLines(segments.rightRays, 'perspective-guide-overlay__ray')}
          {renderLines(segments.verticals, 'perspective-guide-overlay__vertical')}
        </g>
      </svg>
      {renderHandle('left', left, leftScreen)}
      {renderHandle('right', right, rightScreen)}
    </div>
  );
}
