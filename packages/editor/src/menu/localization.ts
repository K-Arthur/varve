/**
 * Localization adapter boundary for menu labels.
 *
 * The menu model uses `labelKey` values like 'menu.file.new' that need to be
 * resolved to display strings. This module provides the resolution boundary:
 *
 * - `formatLabel(key)` — resolves a label key to a display string
 * - `formatLabelWithValues(key, values)` — resolves with interpolation
 * - `reportMissingKey(key)` — development diagnostics for missing keys
 *
 * The current implementation uses identity fallback (returns the key itself)
 * which matches the existing behavior. A real i18n framework can be plugged in
 * by replacing the resolver without touching the menu model.
 */

const MISSING_KEYS = new Set<string>();

/**
 * Resolve a label key to a display string.
 *
 * Current implementation: identity fallback (key is already human-readable).
 * Future: replace with i18n framework lookup (e.g. i18next.t(key)).
 */
export function formatLabel(key: string): string {
  return key;
}

/**
 * Resolve a label key with interpolated values.
 *
 * Example: formatLabelWithValues('menu.edit.undoN', { n: 3 }) → 'Undo 3 Items'
 */
export function formatLabelWithValues(
  key: string,
  values: Record<string, string | number>,
): string {
  let result = key;
  for (const [k, v] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return result;
}

/**
 * Report a missing key for development diagnostics.
 * In development, logs a warning once per missing key.
 */
export function reportMissingKey(key: string): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    if (!MISSING_KEYS.has(key)) {
      MISSING_KEYS.add(key);
      console.warn(`[i18n] Missing label key: ${key}`);
    }
  }
}

/** Get the set of missing keys encountered (for tests). */
export function getMissingKeys(): Set<string> {
  return new Set(MISSING_KEYS);
}

/** Clear missing key tracking (for tests). */
export function clearMissingKeys(): void {
  MISSING_KEYS.clear();
}
