import type { IsometricAxis, IsometricGrid } from '@varve/scene';
import { normaliseAngle } from '@varve/scene';
import { screenToWorld, worldToScreen } from '@varve/shared';
import { useMemo } from 'react';
import type { GridOverlayMode } from '../../context/types';
import './DocumentGridOverlay.css';

interface DocumentGridOverlayProps {
  mode: GridOverlayMode;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  width: number;
  height: number;
  visible?: boolean;
  baselineStep?: number;
  offset?: number;
  isometricGrid?: IsometricGrid | null;
}

function defaultIsometricAngles(): number[] {
  return [30, 150, 90];
}

function getIsometricAngles(grid: IsometricGrid | null | undefined): number[] {
  if (grid?.axes && grid.axes.length >= 2) {
    return grid.axes
      .filter((a: IsometricAxis) => a.visible !== false)
      .map((a: IsometricAxis) => normaliseAngle(a.angle));
  }
  return defaultIsometricAngles();
}

function getIsometricSpacing(grid: IsometricGrid | null | undefined, fallback: number): number {
  return grid?.spacing && grid.spacing > 0 ? grid.spacing : fallback;
}

export function DocumentGridOverlay({
  mode,
  zoom,
  pan,
  cameraRotation,
  width,
  height,
  visible = true,
  baselineStep = 24,
  offset = 0,
  isometricGrid,
}: DocumentGridOverlayProps) {
  const lines = useMemo(() => {
    if (!visible || mode === 'none' || width <= 0 || height <= 0) return [];
    const result: Array<{ x1: number; y1: number; x2: number; y2: number; kind: string }> = [];
    const camera = { zoom, pan, rotation: cameraRotation };
    const viewport = { width, height };
    const corners = [
      screenToWorld(camera, 0, 0, viewport),
      screenToWorld(camera, width, 0, viewport),
      screenToWorld(camera, 0, height, viewport),
      screenToWorld(camera, width, height, viewport),
    ];
    const minX = Math.min(...corners.map(([x]) => x));
    const maxX = Math.max(...corners.map(([x]) => x));
    const minY = Math.min(...corners.map(([, y]) => y));
    const maxY = Math.max(...corners.map(([, y]) => y));
    const toScreen = (wx: number, wy: number) => worldToScreen(camera, wx, wy, viewport);

    if (mode === 'baseline' && baselineStep > 0) {
      const firstLine = Math.floor((minY - offset) / baselineStep) * baselineStep + offset;
      const startY = firstLine - baselineStep * 2;
      const endY = maxY + baselineStep * 2;
      for (let y = startY; y <= endY; y += baselineStep) {
        const [x1, y1] = toScreen(minX - baselineStep * 2, y);
        const [x2, y2] = toScreen(maxX + baselineStep * 2, y);
        result.push({ x1, y1, x2, y2, kind: 'baseline' });
      }
    }

    if (mode === 'isometric' && baselineStep > 0) {
      const effectiveSpacing = getIsometricSpacing(isometricGrid, baselineStep);
      const step = Math.max(
        effectiveSpacing,
        effectiveSpacing * Math.ceil(6 / (effectiveSpacing * zoom)),
      );
      const span = Math.hypot(maxX - minX, maxY - minY) * 2 + effectiveSpacing * 4;
      const originX = isometricGrid?.originX ?? 0;
      const originY = isometricGrid?.originY ?? 0;
      const gridRotation = ((isometricGrid?.rotation ?? 0) * Math.PI) / 180;
      const angles = getIsometricAngles(isometricGrid).map(
        (deg) => (deg * Math.PI) / 180 + gridRotation,
      );

      for (const rad of angles) {
        const ux = Math.cos(rad);
        const uy = Math.sin(rad);
        const nx = -uy;
        const ny = ux;
        const projections = corners.map(([x, y]) => (x - originX) * nx + (y - originY) * ny);
        const start = Math.floor((Math.min(...projections) - step * 2) / step) * step;
        const end = Math.ceil((Math.max(...projections) + step * 2) / step) * step;
        let count = 0;
        for (let d = start; d <= end && count < 2048; d += step, count += 1) {
          const ox = originX + nx * d;
          const oy = originY + ny * d;
          const [x1, y1] = toScreen(ox - ux * span, oy - uy * span);
          const [x2, y2] = toScreen(ox + ux * span, oy + uy * span);
          result.push({ x1, y1, x2, y2, kind: 'isometric' });
        }
      }
    }

    return result;
  }, [
    mode,
    visible,
    zoom,
    pan.x,
    pan.y,
    cameraRotation,
    width,
    height,
    baselineStep,
    offset,
    isometricGrid,
  ]);

  if (mode === 'none' || lines.length === 0) return null;

  return (
    <svg
      className="document-grid-overlay"
      aria-hidden
      role="presentation"
      width={width}
      height={height}
      style={{ width, height }}
    >
      {lines.map((line) => (
        <line
          key={`${line.kind}-${line.x1}-${line.y1}`}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          className={`document-grid-overlay__line document-grid-overlay__line--${line.kind}`}
        />
      ))}
    </svg>
  );
}
