import type { IsometricGrid, IsometricPlaneId } from '@varve/scene';
import { screenToWorld, worldToScreen } from '@varve/shared';
import { useMemo, useRef } from 'react';
import {
  computeIsometricOverlayLines,
  groupIsometricOverlayPaths,
} from '../../canvas/isometricOverlayGeometry';
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
  activePlaneId?: IsometricPlaneId | 'none';
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
  activePlaneId,
}: DocumentGridOverlayProps) {
  // Display density hysteresis is retained across renders per grid identity;
  // it never writes back to the authored spacing.
  const displayStepRef = useRef(1);
  const gridKeyRef = useRef('');
  const gridKey = isometricGrid
    ? `${isometricGrid.id}:${isometricGrid.spacing}:${isometricGrid.rotation}`
    : 'none';
  if (gridKeyRef.current !== gridKey) {
    gridKeyRef.current = gridKey;
    displayStepRef.current = 1;
  }

  const baselineLines = useMemo(() => {
    if (!visible || mode !== 'baseline' || width <= 0 || height <= 0 || !(baselineStep > 0)) {
      return [];
    }
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
    const firstLine = Math.floor((minY - offset) / baselineStep) * baselineStep + offset;
    const startY = firstLine - baselineStep * 2;
    const endY = maxY + baselineStep * 2;
    const result: Array<{ key: string; x1: number; y1: number; x2: number; y2: number }> = [];
    for (let y = startY; y <= endY; y += baselineStep) {
      const [x1, y1] = toScreen(minX - baselineStep * 2, y);
      const [x2, y2] = toScreen(maxX + baselineStep * 2, y);
      result.push({ key: `baseline-${y.toFixed(3)}`, x1, y1, x2, y2 });
    }
    return result;
  }, [mode, visible, zoom, pan.x, pan.y, cameraRotation, width, height, baselineStep, offset]);

  const isometric = useMemo(() => {
    if (!visible || mode !== 'isometric' || width <= 0 || height <= 0 || !isometricGrid) {
      return { paths: [], displayStep: displayStepRef.current };
    }
    const result = computeIsometricOverlayLines({
      grid: isometricGrid,
      camera: { zoom, pan, rotation: cameraRotation },
      viewport: { width, height },
      activePlaneId,
      previousDisplayStep: displayStepRef.current,
    });
    displayStepRef.current = result.displayStep;
    return { paths: groupIsometricOverlayPaths(result.lines), displayStep: result.displayStep };
  }, [
    mode,
    visible,
    zoom,
    pan.x,
    pan.y,
    cameraRotation,
    width,
    height,
    isometricGrid,
    activePlaneId,
  ]);

  if (mode === 'none') return null;
  if (mode === 'baseline' && baselineLines.length === 0) return null;
  if (mode === 'isometric' && isometric.paths.length === 0) return null;

  return (
    <svg
      className="document-grid-overlay"
      aria-hidden
      role="presentation"
      width={width}
      height={height}
      style={{ width, height }}
    >
      {baselineLines.map((line) => (
        <line
          key={line.key}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          className="document-grid-overlay__line document-grid-overlay__line--baseline"
        />
      ))}
      {isometric.paths.map((path) => (
        <path
          key={path.key}
          d={path.d}
          className={[
            'document-grid-overlay__path--isometric',
            path.major
              ? 'document-grid-overlay__path--major'
              : 'document-grid-overlay__path--minor',
            path.active ? 'document-grid-overlay__path--active' : '',
            path.role === 'guide' ? 'document-grid-overlay__path--guide' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={
            path.color || path.opacity !== 1
              ? {
                  ...(path.color ? { stroke: path.color } : {}),
                  ...(path.opacity !== 1 ? { strokeOpacity: path.opacity } : {}),
                }
              : undefined
          }
        />
      ))}
    </svg>
  );
}
