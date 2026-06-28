/**
 * Token runtime + re-exports.
 *
 * Color values are the single source of truth in color.ts (audited). The CSS
 * custom properties in tokens.css (generated) are what the UI consumes. This
 * module exposes typed access to both, plus a small theme-application helper.
 */
import type { Theme } from './color';

export * from './color';
export * from './contrast';

/** Apply a theme by setting [data-theme] on the document root.
 * Light is the default when no attribute is present. */
export function setTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export function getTheme(): Theme | null {
  if (typeof document === 'undefined') return null;
  return (document.documentElement.dataset.theme as Theme | undefined) ?? null;
}
