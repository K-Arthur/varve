/**
 * Color blindness simulation via LMS cone response matrices.
 *
 * Uses the Machado, Oliveira, Fernandes (2009) simulation matrices for
 * protanopia, deuteranopia, and tritanopia. Transforms sRGB through
 * linear sRGB → LMS → simulation → linear sRGB.
 *
 * Research basis: Machado et al. "A Physiologically-based Model for
 * Simulation of Color Vision Deficiency" (2009), Brettel et al. (1997).
 */
import { linearToSrgb, rgbToLinearRgb } from './colorConversion';

export type ColorBlindnessType = 'protanopia' | 'deuteranopia' | 'tritanopia';

type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

function mul3x3Vec(m: Mat3, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** sRGB → LMS (Hunt-Pointer-Estevez adapted, Machado 2009). */
const RGB_TO_LMS: Mat3 = [
  0.4002, 0.7075, -0.0807, -0.228, 1.15, 0.0612, 0.0, 0.0, 0.9182,
];

/** LMS → sRGB (inverse). */
const LMS_TO_RGB: Mat3 = [
  1.968, -1.285, 0.317, 0.391, 0.688, -0.079, 0.0, 0.0, 1.079,
];

/** Simulation matrices in LMS space (Machado 2009, severity=1). */
const SIMULATION: Record<ColorBlindnessType, Mat3> = {
  protanopia: [
    0.0, 1.05118294, -0.05116099, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0,
  ],
  deuteranopia: [
    1.0, 0.0, 0.0, 0.945708, 0.0, 0.054992, 0.0, 0.0, 1.0,
  ],
  tritanopia: [
    1.0, 0.0, 0.0, 0.0, 1.0, 0.0, -0.867447, 1.867447, 0.0,
  ],
};

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Simulate color blindness on an sRGB color.
 * Returns [r, g, b] in 0-255.
 */
export function simulateColorBlindness(
  r: number,
  g: number,
  b: number,
  type: ColorBlindnessType,
): [number, number, number] {
  const linear = rgbToLinearRgb([r, g, b]).map((c) => c) as [number, number, number];
  const lms = mul3x3Vec(RGB_TO_LMS, linear);
  const simLms = mul3x3Vec(SIMULATION[type], lms);
  const outLinear = mul3x3Vec(LMS_TO_RGB, simLms);
  return [
    clamp255(linearToSrgb(Math.max(0, outLinear[0]))),
    clamp255(linearToSrgb(Math.max(0, outLinear[1]))),
    clamp255(linearToSrgb(Math.max(0, outLinear[2]))),
  ];
}

/**
 * Simulate color blindness on a hex or rgba string.
 * Returns CSS rgba() string.
 */
export function simulateColorBlindnessCss(color: string, type: ColorBlindnessType): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  const [sr, sg, sb] = simulateColorBlindness(r, g, b, type);
  return `rgb(${sr},${sg},${sb})`;
}
