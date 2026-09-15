/**
 * Read-only E2E inspection hook for the isometric grid workflow.
 *
 * Gated behind `?isoTest=1` and never installed otherwise, following the
 * existing `?perf=1` convention. It exists so visual tests can assert on the
 * committed *artwork* (node transforms/shape geometry) instead of only on the
 * guide overlay — the two must agree, and this is how the test proves it.
 */

import type { Shape } from '@varve/engine';
import type { IsometricGrid } from '@varve/scene';
import {
  buildParentIndexMap,
  constructionPlaneFromGeometry,
  resolveActiveIsometricGrid,
  resolveIsometricGeometry,
} from '@varve/scene';
import { screenToWorld, worldToScreen } from '@varve/shared';
import type { EditorState } from '../context';
import { nodeWorldTransform } from '../scene/world';

export interface IsoTestHooks {
  getGridOverlayMode: () => string;
  /** Project a document-space point to canvas-area CSS pixels. */
  worldToScreen: (x: number, y: number) => { x: number; y: number };
  /** Unproject canvas-area CSS pixels to document space. */
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  getGrid: () => {
    id: string;
    visible: boolean;
    snapEnabled: boolean;
    activePlaneId: string;
    spacing: number;
    origin: [number, number];
    basis: [number, number, number, number];
    families: Array<{ index: number; angleDeg: number; offsetStep: number; role: string }>;
    planeBasis: [number, number, number, number] | null;
  } | null;
  getSelection: () => string[];
  getSelectionGeometry: () => Array<{
    id: string;
    kind: string;
    localTransform: number[];
    worldTransform: number[];
    shape: Shape | null;
  }>;
  getNodeCount: () => number;
  isDirty: () => boolean;
}

function summarizeGrid(grid: IsometricGrid) {
  const geometry = resolveIsometricGeometry({
    originX: grid.originX,
    originY: grid.originY,
    spacing: grid.spacing,
    rotation: grid.rotation,
    axes: grid.axes,
  });
  if (!geometry) return null;
  const plane =
    grid.activePlaneId && grid.activePlaneId !== 'none'
      ? constructionPlaneFromGeometry(geometry, grid.activePlaneId)
      : null;
  return {
    id: grid.id,
    visible: grid.visible,
    snapEnabled: grid.snapEnabled,
    activePlaneId: grid.activePlaneId ?? 'top',
    spacing: geometry.spacing,
    origin: [geometry.origin[0], geometry.origin[1]] as [number, number],
    basis: [geometry.basis[0], geometry.basis[1], geometry.basis[2], geometry.basis[3]] as [
      number,
      number,
      number,
      number,
    ],
    families: geometry.families.map((family) => ({
      index: family.index,
      angleDeg: family.angleDeg,
      offsetStep: family.offsetStep,
      role: family.role,
    })),
    planeBasis: plane
      ? ([plane.basis[0], plane.basis[1], plane.basis[2], plane.basis[3]] as [
          number,
          number,
          number,
          number,
        ])
      : null,
  };
}

export function installIsoTestHooks(getState: () => EditorState): void {
  if (typeof window === 'undefined') return;
  if (!window.location.search.includes('isoTest=1')) return;
  const target = window as unknown as { __varveIsoTest?: IsoTestHooks };
  const viewport = () => {
    const el = document.querySelector<HTMLElement>('.editor-canvas');
    return {
      width: el?.clientWidth && el.clientWidth > 0 ? el.clientWidth : window.innerWidth,
      height: el?.clientHeight && el.clientHeight > 0 ? el.clientHeight : window.innerHeight,
    };
  };
  target.__varveIsoTest = {
    getGridOverlayMode: () => getState().gridOverlayMode,
    worldToScreen: (x, y) => {
      const state = getState();
      const [sx, sy] = worldToScreen(
        { zoom: state.zoom, pan: state.pan, rotation: state.cameraRotation },
        x,
        y,
        viewport(),
      );
      return { x: sx, y: sy };
    },
    screenToWorld: (x, y) => {
      const state = getState();
      const [wx, wy] = screenToWorld(
        { zoom: state.zoom, pan: state.pan, rotation: state.cameraRotation },
        x,
        y,
        viewport(),
      );
      return { x: wx, y: wy };
    },
    getGrid: () => {
      const grid = resolveActiveIsometricGrid(getState().document);
      return grid ? summarizeGrid(grid) : null;
    },
    getSelection: () => [...getState().selection],
    getSelectionGeometry: () => {
      const state = getState();
      const parentIndex = buildParentIndexMap(state.document);
      return state.selection.flatMap((id) => {
        const node = state.document.nodes[id];
        if (!node) return [];
        const world = nodeWorldTransform(state.document, id, parentIndex);
        return [
          {
            id,
            kind: node.kind ?? 'shape',
            localTransform: [...node.transform],
            worldTransform: [world[0], world[1], world[2], world[3], world[4], world[5]],
            shape: node.kind === 'shape' ? node.shape : null,
          },
        ];
      });
    },
    getNodeCount: () => Object.keys(getState().document.nodes).length,
    isDirty: () => {
      const state = getState();
      const session = state.sessions?.find((entry) => entry.id === state.activeId);
      return session?.dirty ?? false;
    },
  };
}
