import { useRef, useState } from 'react';

export interface SpatialFilterOverlayProps {
  label: string;
  center: { x: number; y: number };
  bounds: { x: number; y: number; w: number; h: number };
  canvasElement: HTMLCanvasElement | null;
  canvasToWorld: (x: number, y: number) => { x: number; y: number };
  worldToCanvas: (x: number, y: number) => { x: number; y: number };
  onChange: (center: { x: number; y: number }) => void;
}

/** Draggable, camera-aligned control for effects with a normalized origin. */
export function SpatialFilterOverlay({
  label,
  center,
  bounds,
  canvasElement,
  canvasToWorld,
  worldToCanvas,
  onChange,
}: SpatialFilterOverlayProps) {
  const [dragging, setDragging] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  const worldPoint = {
    x: bounds.x + center.x * bounds.w,
    y: bounds.y + center.y * bounds.h,
  };
  const screen = worldToCanvas(worldPoint.x, worldPoint.y);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const rect = canvasElement?.getBoundingClientRect();
    if (!rect || bounds.w <= 0 || bounds.h <= 0) return;
    const world = canvasToWorld(clientX - rect.left, clientY - rect.top);
    onChange({
      x: Math.max(0, Math.min(1, (world.x - bounds.x) / bounds.w)),
      y: Math.max(0, Math.min(1, (world.y - bounds.y) / bounds.h)),
    });
  };

  return (
    <button
      type="button"
      data-testid="spatial-filter-control"
      aria-label={`${label} position`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        pointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!dragging || pointerIdRef.current !== event.pointerId) return;
        updateFromPointer(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (pointerIdRef.current !== event.pointerId) return;
        updateFromPointer(event.clientX, event.clientY);
        pointerIdRef.current = null;
        setDragging(false);
      }}
      style={{
        position: 'absolute',
        left: screen.x,
        top: screen.y,
        transform: 'translate(-50%, -50%)',
        width: 24,
        height: 24,
        padding: 0,
        border: `2px solid ${dragging ? 'var(--color-interactive-default)' : 'var(--color-accent-primary)'}`,
        borderRadius: '50%',
        background: 'color-mix(in srgb, var(--color-accent-primary) 22%, transparent)',
        boxShadow:
          '0 0 0 1px var(--color-surface-sunken), 0 0 0 5px color-mix(in srgb, var(--color-accent-primary) 22%, transparent)',
        cursor: dragging ? 'grabbing' : 'grab',
        zIndex: 82,
        touchAction: 'none',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'block',
          width: 2,
          height: 12,
          background: 'currentColor',
          margin: 'auto',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          display: 'block',
          height: 2,
          width: 12,
          background: 'currentColor',
          margin: '-7px auto 0',
        }}
      />
    </button>
  );
}
