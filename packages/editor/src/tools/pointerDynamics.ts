/**
 * Stylus/pointer dynamics normalization.
 *
 * Pressure reporting differs by device in ways that matter to a brush engine:
 * a mouse reports 0 while a button is down on some platforms and 0.5 on others,
 * a pen reports a genuine 0-1 curve, and touch may report either. Normalizing
 * in one place keeps that mess out of every tool, and — importantly — keeps a
 * pen's legitimately light 0.02 touch from being "corrected" to 0.5.
 */

/** What a mouse or a device with no pressure sensor paints at. */
export const DEFAULT_MOUSE_PRESSURE = 0.5;

export type PointerKind = 'mouse' | 'pen' | 'touch' | string;

/**
 * Normalize `PointerEvent.pressure` to a usable brush pressure.
 *
 * Pens keep whatever they report, including very low values — clamping those up
 * would erase the light end of a stylus's dynamic range. Mice and pressureless
 * devices get a fixed mid value so an ordinary mouse user never paints an
 * invisible stroke.
 */
export function normalizePressure(pressure: number, pointerType: PointerKind): number {
  if (!Number.isFinite(pressure)) return DEFAULT_MOUSE_PRESSURE;
  if (pointerType === 'pen') {
    // A pen in contact always reports > 0; a reported 0 means "no sensor".
    if (pressure <= 0) return DEFAULT_MOUSE_PRESSURE;
    return Math.min(1, pressure);
  }
  if (pointerType === 'touch') {
    // Many touchscreens report the 0.5 placeholder or nothing at all.
    return pressure > 0 ? Math.min(1, pressure) : DEFAULT_MOUSE_PRESSURE;
  }
  // Mouse: the spec says 0.5 while a button is held, but browsers disagree.
  return pressure > 0 ? Math.min(1, pressure) : DEFAULT_MOUSE_PRESSURE;
}

/**
 * Collapse tiltX/tiltY into the single 0-90 tilt magnitude the brush dynamics
 * model consumes. Returns the angle of the pen from vertical, which is what
 * "tilt" means to an artist, rather than the mean of two signed axes.
 */
export function normalizeTilt(tiltX: number | undefined, tiltY: number | undefined): number {
  const tx = Number.isFinite(tiltX) ? (tiltX as number) : 0;
  const ty = Number.isFinite(tiltY) ? (tiltY as number) : 0;
  if (tx === 0 && ty === 0) return 0;
  // tiltX/tiltY are independent angles from vertical in each plane. The
  // combined deviation is the magnitude of their tangent vector.
  const rx = (tx * Math.PI) / 180;
  const ry = (ty * Math.PI) / 180;
  const tilt = Math.atan(Math.hypot(Math.tan(rx), Math.tan(ry)));
  return Math.min(90, (tilt * 180) / Math.PI);
}

/**
 * Direction the pen is tilted towards, in radians, or null when upright.
 * Directional brush tips and directional grain need the azimuth, not just the
 * magnitude, so this is exposed separately rather than folded into `tilt`.
 */
export function tiltAzimuth(tiltX: number | undefined, tiltY: number | undefined): number | null {
  const tx = Number.isFinite(tiltX) ? (tiltX as number) : 0;
  const ty = Number.isFinite(tiltY) ? (tiltY as number) : 0;
  if (tx === 0 && ty === 0) return null;
  return Math.atan2(ty, tx);
}
