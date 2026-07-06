/**
 * Document-level grid overlays — baseline and isometric guides.
 */
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
  baselineStep?: number;
}

export function DocumentGridOverlay({
  mode,
  zoom,
  pan,
  cameraRotation,
  width,
  height,
  baselineStep = 24,
}: DocumentGridOverlayProps) {
  const lines = useMemo(() => {
    if (mode === 'none' || width <= 0 || height <= 0) return [];
    const result: Array<{ x1: number; y1: number; x2: number; y2: number; kind: string }> = [];
    const cos = Math.cos(cameraRotation);
    const sin = Math.sin(cameraRotation);
    const cx = width / 2;
    const cy = height / 2;

    const toScreen = (wx: number, wy: number): [number, number] => {
      const dx = wx * zoom;
      const dy = wy * zoom;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return [rx + pan.x + cx * (1 - cos) + cy * sin, ry + pan.y + cy * (1 - cos) - cx * sin];
    };

    if (mode === 'baseline') {
      const startY = Math.floor(-pan.y / zoom / baselineStep) * baselineStep - baselineStep * 2;
      const endY = startY + height / zoom + baselineStep * 4;
      for (let y = startY; y <= endY; y += baselineStep) {
        const [x1, y1] = toScreen(-10000, y);
        const [x2, y2] = toScreen(10000, y);
        result.push({ x1, y1, x2, y2, kind: 'baseline' });
      }
    }

    if (mode === 'isometric') {
      const step = baselineStep;
      const angles = [30, 150, 90];
      for (const deg of angles) {
        const rad = (deg * Math.PI) / 180;
        const nx = Math.cos(rad);
        const ny = Math.sin(rad);
        for (let d = -2000; d <= 2000; d += step) {
          const ox = nx * d;
          const oy = ny * d;
          const [x1, y1] = toScreen(ox - ny * 5000, oy + nx * 5000);
          const [x2, y2] = toScreen(ox + ny * 5000, oy - nx * 5000);
          result.push({ x1, y1, x2, y2, kind: 'isometric' });
        }
      }
    }

    return result;
  }, [mode, zoom, pan.x, pan.y, cameraRotation, width, height, baselineStep]);

  if (mode === 'none' || lines.length === 0) return null;

  return (
    <svg
      className="document-grid-overlay"
      aria-hidden
      width={width}
      height={height}
      style={{ width, height }}
    >
      {lines.map((line, i) => (
        <line
          key={`${line.kind}-${i}`}
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
