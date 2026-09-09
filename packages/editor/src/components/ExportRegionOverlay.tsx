/**
 * ExportRegionOverlay — dashed boundary and badge for Export Regions.
 *
 * Export Regions are stored as frames so transforms, resize, clipboard and the
 * document codec keep working unchanged, but they are not artwork: the
 * renderer paints nothing for them (see sceneToEngine). Their outline lives
 * here instead, in the overlay layer, so a region never covers the artwork it
 * describes and never reads as an opaque frame — which is exactly what the
 * old Slice tool looked like it was doing.
 *
 * Corners are projected through the region's full world transform, so rotated,
 * scaled and nested regions trace their real edges rather than an AABB.
 *
 * Research basis: Figma slice overlays, Sketch export-slice chrome.
 */
import {
  assertOccurrencesInScope,
  type Document,
  isExportRegion,
  type ResolvedEditorSceneScope,
} from '@varve/scene';
import { applyAffine, type Viewport } from '@varve/shared';
import { useMemo } from 'react';
import { editorWorldToScreen } from '../canvas/cameraState';
import { nodeWorldTransform } from '../scene/world';

export interface ExportRegionOverlayProps {
  doc: Document;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  selection: readonly string[];
  scope: ResolvedEditorSceneScope;
  viewport: Viewport;
}

interface RegionOutline {
  id: string;
  name: string;
  points: string;
  labelX: number;
  labelY: number;
  selected: boolean;
}

export function ExportRegionOverlay({
  doc,
  zoom,
  pan,
  cameraRotation,
  selection,
  scope,
  viewport,
}: ExportRegionOverlayProps) {
  const selected = useMemo(() => new Set(selection), [selection]);

  const outlines = useMemo<RegionOutline[]>(() => {
    const camState = { zoom, pan, cameraRotation };
    const result: RegionOutline[] = [];
    for (const occurrence of scope.occurrences) {
      const id = occurrence.nodeId;
      const node = doc.nodes[id];
      if (node?.kind !== 'frame') continue;
      if (!isExportRegion(node)) continue;
      const world = nodeWorldTransform(doc, id);
      const corners: Array<[number, number]> = [
        [0, 0],
        [node.w, 0],
        [node.w, node.h],
        [0, node.h],
      ];
      const screen = corners.map((corner) => {
        let [wx, wy] = applyAffine(world, corner);
        if (occurrence.masterPlacement) {
          wx += occurrence.masterPlacement.x;
          wy += occurrence.masterPlacement.y;
        }
        return editorWorldToScreen(camState, wx, wy, viewport);
      });
      if (screen.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) continue;
      const topLeft = screen[0] ?? [0, 0];
      result.push({
        id: occurrence.instanceId,
        name: node.name,
        points: screen.map(([x, y]) => `${x},${y}`).join(' '),
        labelX: topLeft[0],
        labelY: topLeft[1] - 6,
        selected: selected.has(id),
      });
    }
    assertOccurrencesInScope(
      scope,
      result.map((outline) => outline.id),
    );
    return result;
  }, [cameraRotation, doc, pan, scope, selected, viewport, zoom]);

  if (outlines.length === 0) return null;

  return (
    <svg
      role="presentation"
      aria-hidden
      className="export-region-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 3,
      }}
    >
      {outlines.map((outline) => (
        <g key={outline.id} data-instance-id={outline.id} data-surface-key={scope.surfaceKey}>
          <polygon
            points={outline.points}
            fill="none"
            stroke="var(--color-accent, #2f6f62)"
            strokeWidth={outline.selected ? 2 : 1}
            strokeDasharray="6 4"
            opacity={outline.selected ? 1 : 0.75}
          />
          <text
            x={outline.labelX}
            y={outline.labelY}
            fill="var(--color-accent, #2f6f62)"
            fontSize={10}
            fontFamily="var(--font-body, system-ui, sans-serif)"
            fontWeight={600}
          >
            {outline.name}
          </text>
        </g>
      ))}
    </svg>
  );
}
