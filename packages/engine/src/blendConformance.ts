/**
 * W3C partial-alpha blend conformance vectors.
 *
 * Research basis: W3C Compositing and Blending Level 1, general source-over
 * formula. Blend functions receive straight backdrop/source colors and only
 * affect the overlap term of the premultiplied composite equation.
 */

export const BLEND_CONFORMANCE_CASES = Object.freeze([
  Object.freeze({
    name: 'multiply keeps uncovered source and backdrop contributions',
    backdrop: Object.freeze([1, 0, 0, 0.5] as const),
    source: Object.freeze([0, 0, 1, 0.5] as const),
    mode: 'multiply',
    opacity: 1,
    expected: Object.freeze([1 / 3, 0, 1 / 3, 0.75] as const),
  }),
  Object.freeze({
    name: 'transparent backdrop returns the straight source color',
    backdrop: Object.freeze([0.8, 0.2, 0.1, 0] as const),
    source: Object.freeze([0.2, 0.4, 0.6, 0.25] as const),
    mode: 'screen',
    opacity: 1,
    expected: Object.freeze([0.2, 0.4, 0.6, 0.25] as const),
  }),
  Object.freeze({
    name: 'screen composes asymmetric partial alpha with source opacity',
    backdrop: Object.freeze([0.8, 0.2, 0.4, 0.25] as const),
    source: Object.freeze([0.1, 0.9, 0.3, 0.6] as const),
    mode: 'screen',
    opacity: 0.5,
    expected: Object.freeze([0.224 / 0.475, 0.3065 / 0.475, 0.181 / 0.475, 0.475] as const),
  }),
] as const);
