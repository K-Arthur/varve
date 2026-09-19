/**
 * Small string helpers shared across packages. Keep this module free of
 * domain concepts; anything that knows about documents belongs in scene.
 */

/** Escape a string for safe literal use inside a `RegExp`. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Uppercase the first character, leaving the remainder untouched. */
export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
