/**
 * Token runtime + re-exports.
 *
 * Color values are the single source of truth in color.ts (audited). The CSS
 * custom properties in tokens.css (generated) are what the UI consumes. This
 * module exposes typed access to both, plus a small theme-application helper.
 */
export * from './color';
export * from './contrast';
export * from './dtcg';
export * from './themeRuntime';
