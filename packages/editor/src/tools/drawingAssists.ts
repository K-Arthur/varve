/**
 * Drawing assists — modular, configurable stages that modify pointer input
 * before it reaches the brush/vector pipeline.
 *
 * Architecture:
 *   Raw pointer input → [Stabilizer] → [StraightLine] → [Mirror] → [Snap] → output
 *   Each stage is independently configurable and can be toggled or replaced.
 *
 * Research basis: Krita paint assistants, Procreate drawing guides,
 *   Adobe Fresco stabilization, LazyNexus stabilization algorithm.
 */

import type { BrushDab, StrokePoint } from '@strata/scene';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface StabilizerConfig {
  /** Enable stabilizer. */
  enabled: boolean;
  /**
   * Stabilization strength 0-1.
   * 0 = raw input, 0.3 = light smoothing, 0.7 = heavy smoothing, 1 = full lag.
   */
  strength: number;
  /**
   * When true, uses velocity-dependent window sizing.
   * Slow strokes get more smoothing; fast strokes respond immediately.
   */
  adaptive: boolean;
  /**
   * Maximum window size for the weighted moving average (in samples).
   * Higher = smoother but more lag.
   */
  maxWindowSize: number;
  /**
   * Finish mode: when true, the stabilizer continues to drain its buffer
   * after pointer up, producing a smooth tail.
   */
  finishMode: boolean;
}

export interface StraightLineConfig {
  /** Enable straight-line detection. */
  enabled: boolean;
  /**
   * After how many CSS pixels of drag should line detection activate.
   * Must be > the tool's drag threshold.
   */
  activationDistancePx: number;
  /**
   * Angle snap increments in radians (PI/4 = 45 degrees, PI/6 = 30 degrees).
   * 0 = no angle snapping.
   */
  angleSnapIncrement: number;
  /**
   * When true, the line locks to the detected direction after activation.
   * When false, the line can still deviate slightly.
   */
  lockAfterActivation: boolean;
}

export interface MirrorConfig {
  /** Enable mirror/symmetry drawing. */
  enabled: boolean;
  /** Mirror axis x-coordinate (world space). */
  axisX: number;
  /** Mirror axis y-coordinate (world space). */
  axisY: number;
  /** Mirror angle in radians (0 = vertical, PI/2 = horizontal). */
  angle: number;
  /** Number of symmetry lines (2 = basic mirror, 3 = triangle, 4 = cross, etc.). */
  radialSymmetry: number;
}

export interface DrawingAssistConfig {
  stabilizer: StabilizerConfig;
  straightLine: StraightLineConfig;
  mirror: MirrorConfig;
}

export const DEFAULT_ASSIST_CONFIG: DrawingAssistConfig = {
  stabilizer: {
    enabled: false,
    strength: 0.5,
    adaptive: true,
    maxWindowSize: 16,
    finishMode: true,
  },
  straightLine: {
    enabled: false,
    activationDistancePx: 20,
    angleSnapIncrement: Math.PI / 4,
    lockAfterActivation: true,
  },
  mirror: {
    enabled: false,
    axisX: 0,
    axisY: 0,
    angle: 0,
    radialSymmetry: 2,
  },
};

// ─── Stabilizer ──────────────────────────────────────────────────────────────

/**
 * Velocity-weighted moving average stabilizer.
 *
 * Maintains a history window of recent points and produces smoothed output
 * as a weighted average. At low velocity (slow strokes), the window is
 * larger, giving more smoothing. At high velocity (fast strokes), the
 * window shrinks for responsive tracking.
 *
 * Based on the LazyNexus stabilization algorithm used in Krita.
 */
export class Stabilizer {
  private history: StrokePoint[] = [];
  private config: StabilizerConfig;

  constructor(config: Partial<StabilizerConfig> = {}) {
    this.config = {
      enabled: false,
      strength: 0.5,
      adaptive: true,
      maxWindowSize: 16,
      finishMode: true,
      ...config,
    };
  }

  updateConfig(config: Partial<StabilizerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  reset(): void {
    this.history = [];
  }

  /**
   * Push a new input point and get the stabilized output.
   * Returns null until enough history has accumulated.
   */
  stabilize(point: StrokePoint): StrokePoint | null {
    if (!this.config.enabled || this.config.strength <= 0) {
      return point;
    }

    this.history.push(point);

    if (this.history.length < 2) {
      return null;
    }

    // Keep history within window
    const maxWindow = this.config.maxWindowSize;
    if (this.history.length > maxWindow) {
      this.history.shift();
    }

    // Compute velocity for adaptive window sizing
    let velocity = 0;
    if (this.config.adaptive && this.history.length >= 2) {
      const prev = this.history[this.history.length - 2]!;
      const curr = this.history[this.history.length - 1]!;
      const dt = curr.time - prev.time;
      if (dt > 0) {
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        velocity = Math.sqrt(dx * dx + dy * dy) / (dt / 1000);
      }
    }

    // Compute effective window size: inversely proportional to velocity
    let windowSize = this.config.maxWindowSize;
    if (this.config.adaptive) {
      const minWindow = 2;
      const velocityNorm = Math.min(1, velocity / 1000);
      windowSize = Math.round(
        minWindow +
          (this.config.maxWindowSize - minWindow) * (1 - velocityNorm) * this.config.strength,
      );
      windowSize = Math.max(minWindow, Math.min(this.config.maxWindowSize, windowSize));
    }

    // Weighted moving average — recent points have higher weight
    const startIdx = Math.max(0, this.history.length - windowSize);
    const window = this.history.slice(startIdx);
    let wx = 0;
    let wy = 0;
    let wp = 0;
    let wt = 0;

    for (let i = 0; i < window.length; i++) {
      // Linear weight: most recent = heaviest
      const weight = (i + 1) / window.length;
      const p = window[i]!;
      wx += p.x * weight;
      wy += p.y * weight;
      wp += (p.pressure ?? 0.5) * weight;
      wt += weight;
    }

    if (wt <= 0) return point;

    return {
      x: wx / wt,
      y: wy / wt,
      pressure: Math.max(0, Math.min(1, wp / wt)),
      tilt: point.tilt, // Pass through latest tilt
      direction: point.direction,
      speed: point.speed,
      time: point.time,
    };
  }

  /**
   * Drain remaining history for smooth finish.
   * Produces interpolated output points after pointer up.
   */
  drain(): StrokePoint[] {
    if (!this.config.enabled || !this.config.finishMode || this.history.length < 2) {
      return [];
    }

    const result: StrokePoint[] = [];
    const last = this.history[this.history.length - 1]!;

    // Emit remaining history with decaying interpolation
    const tail = this.history.slice(-8).reverse();
    for (let i = 1; i < tail.length; i++) {
      const p = tail[i]!;
      const t = i / tail.length;
      result.push({
        x: p.x + (last.x - p.x) * t,
        y: p.y + (last.y - p.y) * t,
        pressure: p.pressure * (1 - t * 0.5),
        tilt: p.tilt,
        direction: p.direction,
        speed: 0,
        time: last.time + i * 2,
      });
    }

    return result;
  }

  getHistoryLength(): number {
    return this.history.length;
  }
}

// ─── Straight Line ───────────────────────────────────────────────────────────

export class StraightLineAssist {
  private config: StraightLineConfig;
  private activated = false;
  private anchorX = 0;
  private anchorY = 0;
  private lockedAngle = 0;

  constructor(config: Partial<StraightLineConfig> = {}) {
    this.config = {
      enabled: false,
      activationDistancePx: 20,
      angleSnapIncrement: Math.PI / 4,
      lockAfterActivation: true,
      ...config,
    };
  }

  updateConfig(config: Partial<StraightLineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  reset(): void {
    this.activated = false;
  }

  /**
   * Process a point through the straight-line assist.
   * Returns the adjusted point (or the original if no adjustment).
   */
  process(
    point: StrokePoint,
    startX: number,
    startY: number,
    zoom: number,
  ): { point: StrokePoint; isActive: boolean } {
    if (!this.config.enabled) {
      return { point, isActive: false };
    }

    const dx = point.x - startX;
    const dy = point.y - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Convert activation distance from CSS pixels to world units
    const activationWorld = this.config.activationDistancePx / zoom;

    if (!this.activated) {
      if (dist >= activationWorld) {
        this.activated = true;
        this.anchorX = startX;
        this.anchorY = startY;
        this.lockedAngle = Math.atan2(dy, dx);

        if (this.config.angleSnapIncrement > 0) {
          this.lockedAngle =
            Math.round(this.lockedAngle / this.config.angleSnapIncrement) *
            this.config.angleSnapIncrement;
        }
        // Activate and snap this point immediately
        const angle = this.lockedAngle;
        const snappedX = this.anchorX + dist * Math.cos(angle);
        const snappedY = this.anchorY + dist * Math.sin(angle);
        return {
          point: { ...point, x: snappedX, y: snappedY },
          isActive: true,
        };
      }
      return { point, isActive: false };
    }

    // Line is already activated — snap the point to the line from anchor
    let angle = this.lockedAngle;

    if (this.config.angleSnapIncrement > 0 && !this.config.lockAfterActivation) {
      angle = Math.round(angle / this.config.angleSnapIncrement) * this.config.angleSnapIncrement;
    }

    const snappedX = this.anchorX + dist * Math.cos(angle);
    const snappedY = this.anchorY + dist * Math.sin(angle);

    return {
      point: {
        ...point,
        x: snappedX,
        y: snappedY,
      },
      isActive: true,
    };
  }

  isActive(): boolean {
    return this.activated;
  }
}

// ─── Mirror / Symmetry ───────────────────────────────────────────────────────

export class MirrorAssist {
  private config: MirrorConfig;

  constructor(config: Partial<MirrorConfig> = {}) {
    this.config = {
      enabled: false,
      axisX: 0,
      axisY: 0,
      angle: 0,
      radialSymmetry: 2,
      ...config,
    };
  }

  updateConfig(config: Partial<MirrorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Generate mirrored copies of a point.
   * Returns the original point plus all reflected copies.
   */
  mirror(point: StrokePoint): StrokePoint[] {
    if (!this.config.enabled) return [point];

    const { axisX, axisY, angle, radialSymmetry } = this.config;
    const points: StrokePoint[] = [point];
    const step = radialSymmetry > 1 ? (2 * Math.PI) / radialSymmetry : Math.PI;

    for (let i = 1; i < radialSymmetry; i++) {
      const theta = angle + i * step;
      const cosA = Math.cos(theta);
      const sinA = Math.sin(theta);

      // Translate to origin relative to axis
      const dx = point.x - axisX;
      const dy = point.y - axisY;

      // Rotate by -theta
      const rx = dx * cosA + dy * sinA;
      const ry = -dx * sinA + dy * cosA;

      // Mirror (negate Y for reflection across rotated axis)
      const mx = rx;
      const my = -ry;

      // Rotate back
      const finalX = mx * cosA - my * sinA + axisX;
      const finalY = mx * sinA + my * cosA + axisY;

      points.push({
        ...point,
        x: finalX,
        y: finalY,
      });
    }

    return points;
  }

  /**
   * Mirror all mirrored copies of a BrushDab.
   */
  mirrorDab(dab: BrushDab): BrushDab[] {
    if (!this.config.enabled) return [dab];

    const { axisX, axisY, angle, radialSymmetry } = this.config;
    const dabs: import('@strata/scene').BrushDab[] = [dab];
    const step = radialSymmetry > 1 ? (2 * Math.PI) / radialSymmetry : Math.PI;

    for (let i = 1; i < radialSymmetry; i++) {
      const theta = angle + i * step;
      const cosA = Math.cos(theta);
      const sinA = Math.sin(theta);

      const dx = dab.x - axisX;
      const dy = dab.y - axisY;
      const rx = dx * cosA + dy * sinA;
      const ry = -dx * sinA + dy * cosA;
      const mx = rx;
      const my = -ry;
      const finalX = mx * cosA - my * sinA + axisX;
      const finalY = mx * sinA + my * cosA + axisY;

      // Mirror angle for rotated brush tip
      const tipAngle = -dab.angle + 2 * theta;

      dabs.push({
        ...dab,
        x: finalX,
        y: finalY,
        angle: tipAngle,
      });
    }

    return dabs;
  }
}
