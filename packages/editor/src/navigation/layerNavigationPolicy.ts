import type { LayerSelectionNavigationMode } from '../settings';

export type LayerActivationKind = 'single' | 'modifier' | 'range' | 'focus';

/**
 * Automatic camera navigation is reserved for an intentional, unmodified
 * Layers activation. Focus movement and selection assembly must not move the
 * canvas under the user's cursor.
 */
export function automaticNavigationForLayerActivation(
  mode: LayerSelectionNavigationMode,
  activation: LayerActivationKind,
): Exclude<LayerSelectionNavigationMode, 'select-only'> | null {
  if (activation !== 'single' || mode === 'select-only') return null;
  return mode;
}
