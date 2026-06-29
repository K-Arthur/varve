/**
 * @strata/shared — framework-agnostic primitives shared across engine, scene,
 * and UI. Kept dependency-free so it can run in Rust-wasm bindings, web workers,
 * and React components alike.
 */

export { debounce, throttle } from './debounce';
export type { OrderKey } from './ordering';
export { generateKeyBetween, generateNKeysBetween, midPoint } from './ordering';
export type { SpecUnit } from './units';
export {
  convertPx,
  convertToPx,
  formatValue,
  percentToPx,
  ptToPx,
  pxToPercent,
  pxToPt,
  pxToRem,
  remToPx,
} from './units';

/** Semantic Strata package marker. */
export const PACKAGE = '@strata/shared' as const;
