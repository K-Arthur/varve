/**
 * Document-level layer color tags.
 *
 * These values are stable metadata identifiers. Their visual appearance is
 * resolved by the UI theme; no CSS color or rendered paint belongs in the
 * document model.
 */

export const LAYER_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;

export type LayerColorName = (typeof LAYER_COLORS)[number];
/** A tag name, or null for an explicitly untagged node. */
export type LayerColor = LayerColorName | null;

export const LAYER_COLOR_LABELS: Readonly<Record<LayerColorName, string>> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  gray: 'Gray',
};

export function isLayerColor(value: unknown): value is LayerColorName {
  return typeof value === 'string' && (LAYER_COLORS as readonly string[]).includes(value);
}

/**
 * Normalize a value arriving from a document or another external boundary.
 * Missing and invalid values are safely treated as untagged. Callers that
 * need to preserve an omitted optional field should check for property
 * presence before calling this helper.
 */
export function normalizeLayerColor(value: unknown): LayerColor {
  return isLayerColor(value) ? value : null;
}

export function layerColorLabel(color: LayerColor): string | null {
  return color ? `${LAYER_COLOR_LABELS[color]} color tag` : null;
}
