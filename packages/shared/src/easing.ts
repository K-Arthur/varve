/**
 * Easing and spring physics math — single source of truth for animation
 * timing functions used by the prototype animation engine.
 *
 * Supports: linear, ease-in/out/in-out, cubic bezier, spring physics,
 * and step easing (CSS steps() equivalent).
 *
 * Research basis: CSS Easing Functions Level 1 & 2 (cubic-bezier, steps,
 * linear()), Web Animations API timing model, Facebook Rebound / Framer
 * Motion spring physics (mass-spring-damper), Robert Penner's easing
 * functions.
 */

/**
 * Easing definition types for use across shared and prototype packages.
 * Defined here to avoid circular dependency (shared → prototype → shared).
 */

export type EasingKind =
  | 'linear'
  | 'ease'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'cubicBezier'
  | 'spring'
  | 'steps';

export interface CubicBezierEasingDef {
  kind: 'cubicBezier';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SpringPhysicsParams {
  mass: number;
  stiffness: number;
  damping: number;
  velocity?: number;
}

export type SpringEasingDef = SpringPhysicsParams & {
  kind: 'spring';
};

export interface StepsEasingDef {
  kind: 'steps';
  count: number;
  position?: 'start' | 'end';
}

export type EasingDefinition =
  | { kind: 'linear' }
  | { kind: 'ease' }
  | { kind: 'easeIn' }
  | { kind: 'easeOut' }
  | { kind: 'easeInOut' }
  | CubicBezierEasingDef
  | SpringEasingDef
  | StepsEasingDef;

export type EasingFn = (t: number) => number;

/**
 * Linear easing — identity function.
 */
export function linear(t: number): number {
  return t;
}

/**
 * Quadratic ease-in: t^2.
 */
export function easeIn(t: number): number {
  return t * t;
}

/**
 * Quadratic ease-out: 1 - (1-t)^2.
 */
export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Quadratic ease-in-out.
 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Create a cubic bezier easing function.
 * Uses Newton-Raphson iteration for X→T mapping,
 * then evaluates the cubic Bezier at T to get Y.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  const ZERO_LIMIT = 1e-6;

  function sampleCurveDerivativeX(t: number): number {
    const u = 1 - t;
    return 3 * u * u * (x1 - 0) + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2);
  }

  function sampleCurveX(t: number): number {
    const u = 1 - t;
    return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
  }

  function sampleCurveY(t: number): number {
    const u = 1 - t;
    return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
  }

  function solveCurveX(x: number): number {
    let t2 = x;
    for (let i = 0; i < 8; i++) {
      const x2 = sampleCurveX(t2) - x;
      if (Math.abs(x2) < ZERO_LIMIT) return t2;
      const d2 = sampleCurveDerivativeX(t2);
      if (Math.abs(d2) < ZERO_LIMIT) break;
      t2 -= x2 / d2;
    }

    let t0 = 0;
    let t1 = 1;
    t2 = x;
    while (t0 < t1) {
      const x2 = sampleCurveX(t2);
      if (Math.abs(x2 - x) < ZERO_LIMIT) return t2;
      if (x > x2) t0 = t2;
      else t1 = t2;
      t2 = (t1 - t0) / 2 + t0;
    }
    return t2;
  }

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleCurveY(solveCurveX(t));
  };
}

/**
 * Create a spring-physics easing function using mass-spring-damper model.
 * Simulates a damped harmonic oscillator over normalized time [0,1].
 */
export function springPhysics(params: SpringPhysicsParams): EasingFn {
  const { mass, stiffness, damping, velocity = 0 } = params;

  // Angular frequency
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;

    // Underdamped
    if (zeta < 1) {
      const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
      const A = 1;
      const B = (velocity + zeta * omega0) / omegaD;
      const envelope = Math.exp(-zeta * omega0 * t * 5);
      return 1 - envelope * (A * Math.cos(omegaD * t * 5) + B * Math.sin(omegaD * t * 5));
    }
    // Critically damped
    if (zeta === 1) {
      const envelope = Math.exp(-omega0 * t * 5);
      return 1 - envelope * (1 + omega0 * t * 5);
    }
    // Overdamped
    const r1 = -omega0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const r2 = -omega0 * (zeta + Math.sqrt(zeta * zeta - 1));
    const c2 = (velocity - r1) / (r2 - r1);
    const c1 = 1 - c2;
    return 1 - (c1 * Math.exp(r1 * t * 5) + c2 * Math.exp(r2 * t * 5));
  };
}

/**
 * Create a step-based easing function (CSS steps() equivalent).
 *
 * steps(N, start): divides into N intervals, first jump at t=0.
 * steps(N, end):   divides into N intervals, first jump at t=1/N.
 */
export function steps(count: number, position: 'start' | 'end' = 'end'): EasingFn {
  return (t: number): number => {
    if (t >= 1) return 1;
    if (position === 'start') {
      // With 'start', at t=0 the value is already at the first step
      return Math.ceil(Math.max(0, t + 1e-10) * count) / count;
    }
    // With 'end', at t=0 the value is 0, first step at 1/count
    if (t <= 0) return 0;
    return Math.floor(t * count) / count;
  };
}

/**
 * Get an easing function from an EasingDefinition.
 */
export function getEasingFn(easing: EasingDefinition): EasingFn {
  switch (easing.kind) {
    case 'linear':
      return linear;
    case 'ease':
      return cubicBezier(0.25, 0.1, 0.25, 1);
    case 'easeIn':
      return cubicBezier(0.42, 0, 1, 1);
    case 'easeOut':
      return cubicBezier(0, 0, 0.58, 1);
    case 'easeInOut':
      return cubicBezier(0.42, 0, 0.58, 1);
    case 'cubicBezier':
      return cubicBezier(easing.x1, easing.y1, easing.x2, easing.y2);
    case 'spring':
      return springPhysics(easing);
    case 'steps':
      return steps(easing.count, easing.position);
    default:
      return linear;
  }
}

/**
 * Sample an easing function at N evenly spaced points.
 */
export function sampleEasing(easing: EasingDefinition, samples: number): number[] {
  const fn = getEasingFn(easing);
  const result: number[] = [];
  for (let i = 0; i < samples; i++) {
    result.push(fn(i / (samples - 1)));
  }
  return result;
}
