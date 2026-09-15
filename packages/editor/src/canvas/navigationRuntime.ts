/**
 * Runtime mirror for persisted canvas-navigation preferences.
 *
 * Wheel and render hot paths must not parse localStorage for every input or
 * frame. Settings remain the source of truth; the settings UI calls the
 * refresh functions after a change, and the first consumer read lazily
 * initializes a safe snapshot.
 */

import {
  DEFAULT_VIEWPORT_SETTINGS,
  type InteractivePreviewMode,
  loadSettings,
  type WheelNavigationMode,
} from '../settings';

export interface NavigationRuntimeSettings {
  wheelMode: WheelNavigationMode;
  wheelSensitivity: number;
  wheelInertia: boolean;
}

let cachedNavigation: NavigationRuntimeSettings | null = null;
let cachedInteractivePreview: InteractivePreviewMode | null = null;

function readNavigation(): NavigationRuntimeSettings {
  const viewport = loadSettings().viewport;
  return {
    wheelMode: viewport.wheelMode,
    wheelSensitivity: viewport.wheelSensitivity,
    wheelInertia: viewport.wheelInertia,
  };
}

export function refreshNavigationSettings(): NavigationRuntimeSettings {
  cachedNavigation = readNavigation();
  return cachedNavigation;
}

export function getNavigationSettings(): NavigationRuntimeSettings {
  return cachedNavigation ?? refreshNavigationSettings();
}

export function refreshInteractivePreviewSettings(): InteractivePreviewMode {
  cachedInteractivePreview = loadSettings().render.interactivePreview;
  return cachedInteractivePreview;
}

export function getInteractivePreviewMode(): InteractivePreviewMode {
  return cachedInteractivePreview ?? refreshInteractivePreviewSettings();
}

export function resetNavigationRuntime(): void {
  cachedNavigation = {
    wheelMode: DEFAULT_VIEWPORT_SETTINGS.wheelMode,
    wheelSensitivity: DEFAULT_VIEWPORT_SETTINGS.wheelSensitivity,
    wheelInertia: DEFAULT_VIEWPORT_SETTINGS.wheelInertia,
  };
  cachedInteractivePreview = 'automatic';
}
