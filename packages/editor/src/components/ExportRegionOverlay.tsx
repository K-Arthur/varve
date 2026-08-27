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
import { activePageNodes, type Document, isContainer, isExportRegion } from '@varve/scene';
import { applyAffine } from '@varve/shared';
import { useMemo } from 'react';
import { editorWorldToScreen, getEditorViewport } from '../canvas/cameraState';
import { nodeWorldTransform } from '../scene/world';

export interface ExportRegionOverlayProps {
  doc: Document;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  selection: readonly string[];
}

interface RegionOutline {
  id: string;
  name: string;
  points: string;
  labelX: number;
  labelY: number;
  selected: boolean;
}

/** Every Export Region reachable on the active page, deepest last. */
function collectExportRegions(doc: Document): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = doc.nodes[id];
    if (!node || node.visible === false) return;
    if (isExportRegion(node)) {
      out.push(id);
      return;
    }
    if (isContainer(node)) for (const childId of node.children) visit(childId);
  };
  for (const id of activePageNodes(doc)) visit(id);
  return out;
}

export function ExportRegionOverlay({
  doc,
  zoom,
  pan,
  cameraRotation,
  selection,
}: ExportRegionOverlayProps) {
  const viewport = getEditorViewport();
  const selected = useMemo(() => new Set(selection), [selection]);

  const outlines = useMemo<RegionOutline[]>(() => {
    const camState = { zoom, pan, cameraRotation };
    const result: RegionOutline[] = [];
    for (const id of collectExportRegions(doc)) {
      const node = doc.nodes[id];
      if (!node || node.kind !== 'frame') continue;
      const world = nodeWorldTransform(doc, id);
      const corners: Array<[number, number]> = [
        [0, 0],
        [node.w, 0],
        [node.w, node.h],
        [0, node.h],
      ];
      const screen = corners.map((corner) => {
        const [wx, wy] = applyAffine(world, corner);
        return editorWorldToScreen(camState, wx, wy, viewport);
      });
      if (screen.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) continue;
      const topLeft = screen[0] ?? [0, 0];
      result.push({
        id,
        name: node.name,
        points: screen.map(([x, y]) => `${x},${y}`).join(' '),
        labelX: topLeft[0],
        labelY: topLeft[1] - 6,
        selected: selected.has(id),
      });
    }
    return result;
  }, [doc, zoom, pan, cameraRotation, viewport.width, viewport.height, selected]);

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
        <g key={outline.id}>
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
