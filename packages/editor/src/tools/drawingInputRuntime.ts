/**
 * Runtime mirror of the persisted drawing-input preferences.
 *
 * The settings store remains the single source of truth. This tiny cache keeps
 * pointermove/tool-context construction off localStorage while allowing a new
 * pointerdown to observe a setting changed in the dialog without remounting the
 * editor or creating a second settings store.
 */

import {
  DEFAULT_DRAWING_INPUT_SETTINGS,
  type DrawingInputSettingsStore,
  loadSettings,
} from '../settings';

let cachedSettings: DrawingInputSettingsStore | null = null;

export function refreshDrawingInputSettings(): DrawingInputSettingsStore {
  cachedSettings = { ...loadSettings().drawingInput };
  return cachedSettings;
}

export function getDrawingInputSettings(): DrawingInputSettingsStore {
  return cachedSettings ?? refreshDrawingInputSettings();
}

export function pressureForDrawingInput(
  pressure: number,
  enabled: boolean = getDrawingInputSettings().pressureEnabled,
  curve: number = getDrawingInputSettings().pressureCurve,
): number {
  if (!enabled) return 0.5;
  const value = Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : 0.5;
  const exponent = Number.isFinite(curve) ? Math.max(0.25, Math.min(4, curve)) : 1;
  return value ** exponent;
}

export function resetDrawingInputRuntime(): void {
  cachedSettings = { ...DEFAULT_DRAWING_INPUT_SETTINGS };
}
