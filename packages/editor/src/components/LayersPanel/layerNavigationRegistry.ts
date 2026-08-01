import type { LayerNavigationCommands } from './layerNavigationCommands';

export type LayerNavigationGetter = () => LayerNavigationCommands | null;

let layerNavigationGetter: LayerNavigationGetter | null = null;

export function setLayerNavigationGetter(fn: LayerNavigationGetter | null): void {
  layerNavigationGetter = fn;
}

export function getLayerNavigationCommands(): LayerNavigationCommands | null {
  return layerNavigationGetter?.() ?? null;
}
