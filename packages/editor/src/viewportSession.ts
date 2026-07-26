/**
 * Per-tab viewport snapshot helpers.
 *
 * Inactive editor tabs store a full viewport snapshot (camera + view prefs)
 * in memory via sessionStoreRef. Application-level view defaults load from
 * localStorage on first mount via settings.ts.
 */

import type { GridOverlayMode, RulerMode } from './context/types';

/** Camera + view preferences captured when leaving a tab. */
export interface SavedViewport {
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  snapEnabled: boolean;
  pixelGridEnabled: boolean;
  rulerMode: RulerMode;
  gridOverlayMode: GridOverlayMode;
  unitType: 'px' | 'pt' | 'cm' | 'mm' | 'in' | '%';
  guidesVisible: boolean;
  snapGrid: number;
  gridVisible: boolean;
}

export const DEFAULT_SAVED_VIEWPORT: SavedViewport = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  cameraRotation: 0,
  snapEnabled: true,
  pixelGridEnabled: false,
  rulerMode: 'artboard',
  gridOverlayMode: 'none',
  unitType: 'px',
  guidesVisible: true,
  snapGrid: 8,
  gridVisible: false,
};

export interface ViewportCaptureSource {
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  snapEnabled: boolean;
  pixelGridEnabled: boolean;
  rulerMode: RulerMode;
  gridOverlayMode: GridOverlayMode;
  unitType: SavedViewport['unitType'];
  guidesVisible: boolean;
  snapGrid: number;
  gridVisible: boolean;
}

export function captureViewport(s: ViewportCaptureSource): SavedViewport {
  return {
    zoom: s.zoom,
    pan: { ...s.pan },
    cameraRotation: s.cameraRotation,
    snapEnabled: s.snapEnabled,
    pixelGridEnabled: s.pixelGridEnabled,
    rulerMode: s.rulerMode,
    gridOverlayMode: s.gridOverlayMode,
    unitType: s.unitType,
    guidesVisible: s.guidesVisible,
    snapGrid: s.snapGrid,
    gridVisible: s.gridVisible,
  };
}

/** Merge a stored snapshot with defaults for legacy zoom/pan-only entries. */
export function normalizeSavedViewport(raw: Partial<SavedViewport> | undefined): SavedViewport {
  if (!raw) return { ...DEFAULT_SAVED_VIEWPORT };
  return {
    zoom: raw.zoom ?? DEFAULT_SAVED_VIEWPORT.zoom,
    pan: raw.pan ?? { ...DEFAULT_SAVED_VIEWPORT.pan },
    cameraRotation: raw.cameraRotation ?? DEFAULT_SAVED_VIEWPORT.cameraRotation,
    snapEnabled: raw.snapEnabled ?? DEFAULT_SAVED_VIEWPORT.snapEnabled,
    pixelGridEnabled: raw.pixelGridEnabled ?? DEFAULT_SAVED_VIEWPORT.pixelGridEnabled,
    rulerMode: raw.rulerMode ?? DEFAULT_SAVED_VIEWPORT.rulerMode,
    gridOverlayMode: raw.gridOverlayMode ?? DEFAULT_SAVED_VIEWPORT.gridOverlayMode,
    unitType: raw.unitType ?? DEFAULT_SAVED_VIEWPORT.unitType,
    guidesVisible: raw.guidesVisible ?? DEFAULT_SAVED_VIEWPORT.guidesVisible,
    snapGrid: raw.snapGrid ?? DEFAULT_SAVED_VIEWPORT.snapGrid,
    gridVisible: raw.gridVisible ?? DEFAULT_SAVED_VIEWPORT.gridVisible,
  };
}
