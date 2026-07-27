import type { IsometricAxis, IsometricGrid } from '@strata/scene';
import { normaliseAngle } from '@strata/scene';
import { useMemo } from 'react';
import { editorWorldToScreen } from '../../canvas/cameraState';
import type { GridOverlayMode } from '../../context/types';
import './DocumentGridOverlay.css';

interface DocumentGridOverlayProps {
  mode: GridOverlayMode;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  width: number;
  height: number;
  baselineStep?: number;
  isometricGrid?: IsometricGrid | null;
}

const HORIZONTAL_SPAN = 10000;

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
  baselineStep = 24,
  isometricGrid,
}: DocumentGridOverlayProps) {
  const camState = useMemo(() => ({ zoom, pan, cameraRotation }), [zoom, pan, cameraRotation]);
  const viewport = useMemo(() => ({ width, height }), [width, height]);

  const lines = useMemo(() => {
    if (mode === 'none' || width <= 0 || height <= 0) return [];
    const result: Array<{ x1: number; y1: number; x2: number; y2: number; kind: string }> = [];

    if (mode === 'baseline' && baselineStep > 0) {
      const startY = Math.floor(-pan.y / zoom / baselineStep) * baselineStep - baselineStep * 2;
      const endY = startY + height / zoom + baselineStep * 4;
      for (let y = startY; y <= endY; y += baselineStep) {
        const [x1, y1] = editorWorldToScreen(camState, -HORIZONTAL_SPAN, y, viewport);
        const [x2, y2] = editorWorldToScreen(camState, HORIZONTAL_SPAN, y, viewport);
        result.push({ x1, y1, x2, y2, kind: 'baseline' });
      }
    }

    if (mode === 'isometric' && baselineStep > 0) {
      const effectiveSpacing = getIsometricSpacing(isometricGrid, baselineStep);
      const step = Math.max(
        effectiveSpacing,
        effectiveSpacing * Math.ceil(6 / (effectiveSpacing * zoom)),
      );
      const extent = 2000;
      const perpSpan = 5000;
      const angles = getIsometricAngles(isometricGrid);

      for (const deg of angles) {
        const rad = (deg * Math.PI) / 180;
        const nx = Math.cos(rad);
        const ny = Math.sin(rad);
        for (let d = -extent; d <= extent; d += step) {
          const ox = nx * d;
          const oy = ny * d;
          const [x1, y1] = editorWorldToScreen(
            camState,
            ox - ny * perpSpan,
            oy + nx * perpSpan,
            viewport,
          );
          const [x2, y2] = editorWorldToScreen(
            camState,
            ox + ny * perpSpan,
            oy - nx * perpSpan,
            viewport,
          );
          result.push({ x1, y1, x2, y2, kind: 'isometric' });
        }
      }
    }

    return result;
  }, [
    mode,
    zoom,
    pan.x,
    pan.y,
    cameraRotation,
    width,
    height,
    baselineStep,
    camState,
    viewport,
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
