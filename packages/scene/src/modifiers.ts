/**
 * Typed variable modifiers — non-destructive relative color operations.
 *
 * A modifier applies on top of a resolved variable value without replacing
 * the variable relationship. Alpha is the first implemented modifier kind;
 * future kinds (lightness, chroma, hue rotation, tint/shade, mixing) extend
 * the `VariableModifier` union with new typed variants — never free-form
 * strings.
 *
 * Semantics (all operate on normalized alpha in [0, 1]):
 * - multiply: effective = tokenAlpha × value   (relative opacity, e.g. ×0.5)
 * - set:      effective = value                (absolute alpha, RGB stays linked)
 * - offset:   effective = clamp(tokenAlpha + value, 0, 1)  (percentage points)
 *
 * Resolution order (documented and tested): resolve collection mode → alias
 * chain → type validation → canonical color → modifier stack (array order)
 * → renderer color → paint-level opacity → node-level opacity at compositing.
 * Modifiers touch only the alpha channel; node opacity stays a separate
 * compositing property and is never applied twice.
 */
import type { BitDepth, ManagedColor } from './colorManagement';

export type AlphaModifierOperation = 'multiply' | 'set' | 'offset';

export interface AlphaModifier {
  kind: 'alpha';
  operation: AlphaModifierOperation;
  value: number;
}

/** Typed modifier stack. Extend this union for future color operations. */
export type VariableModifier = AlphaModifier;

/** Upper bound on the modifier stack length (serialization safety). */
export const MAX_MODIFIERS_PER_BINDING = 8;

export function isAlphaModifier(value: unknown): value is AlphaModifier {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    m.kind === 'alpha' &&
    (m.operation === 'multiply' || m.operation === 'set' || m.operation === 'offset') &&
    typeof m.value === 'number'
  );
}

export function isVariableModifier(value: unknown): value is VariableModifier {
  return isAlphaModifier(value);
}

/**
 * Sanitize untrusted serialized modifier data (codec/migration input).
 * Drops malformed entries, caps the stack length, and coerces non-finite
 * numeric values to safe defaults. Returns a fresh validated array.
 */
export function validateVariableModifiers(raw: unknown): VariableModifier[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: VariableModifier[] = [];
  for (const entry of raw) {
    if (!isAlphaModifier(entry)) continue;
    if (!Number.isFinite(entry.value)) continue;
    out.push(entry);
    if (out.length >= MAX_MODIFIERS_PER_BINDING) break;
  }
  return out.length > 0 ? out : undefined;
}

/** Bit-depth scale for the alpha channel of a color value. */
export function alphaScaleForColor(color: ManagedColor): number {
  const bitDepth = (color as { bitDepth?: BitDepth }).bitDepth;
  if (bitDepth === 'uint16') return 65535;
  if (bitDepth === 'float16' || bitDepth === 'float32') return 1;
  return 255;
}

/** Read the color's alpha as normalized [0, 1]. */
export function normalizedAlpha(color: ManagedColor): number {
  const scale = alphaScaleForColor(color);
  const raw = (color as { a?: number }).a ?? scale;
  if (!Number.isFinite(raw)) return 1;
  if (scale === 1) return Math.min(1, Math.max(0, raw));
  return Math.min(1, Math.max(0, raw / scale));
}

/** Clamp a normalized alpha and scale it back into the color's bit depth. */
export function withAlpha(color: ManagedColor, normalized: number): ManagedColor {
  const scale = alphaScaleForColor(color);
  const clamped = Math.min(1, Math.max(0, normalized));
  const raw = scale === 1 ? clamped : Math.round(clamped * scale);
  return { ...color, a: raw } as ManagedColor;
}

/**
 * Apply an alpha modifier stack in deterministic order.
 *
 * Returns `{ color, valid }`. `valid === false` means the color type is not
 * modifier-compatible (the binding and modifiers are preserved; the caller
 * must surface the invalid state instead of silently detaching or rendering
 * arbitrary output).
 */
export function applyAlphaModifiers(
  color: ManagedColor,
  modifiers: readonly VariableModifier[],
): { color: ManagedColor; valid: boolean } {
  let alpha = normalizedAlpha(color);
  let valid = true;

  for (const modifier of modifiers) {
    if (modifier.kind !== 'alpha') {
      valid = false;
      continue;
    }
    const value = modifier.value;
    if (!Number.isFinite(value)) {
      valid = false;
      continue;
    }
    switch (modifier.operation) {
      case 'multiply':
        alpha = alpha * value;
        break;
      case 'set':
        alpha = value;
        break;
      case 'offset':
        alpha = alpha + value;
        break;
    }
    alpha = Math.min(1, Math.max(0, alpha));
  }

  if (!valid) return { color, valid: false };
  return { color: withAlpha(color, alpha), valid: true };
}

/**
 * Human-readable modifier label, e.g. "× 50%", "Set 50%", "−20 pt".
 * Unambiguous: multiply is always labelled as relative ("×"), offset is
 * always labelled as percentage points, set is always labelled "Set".
 */
export function alphaModifierLabel(modifier: AlphaModifier): string {
  switch (modifier.operation) {
    case 'multiply': {
      const pct = Math.round(modifier.value * 100);
      return `× ${pct}%`;
    }
    case 'set': {
      const pct = Math.round(modifier.value * 100);
      return `Set ${pct}%`;
    }
    case 'offset': {
      const pts = Math.round(modifier.value * 100);
      return pts >= 0 ? `+${pts} pt` : `${pts} pt`;
    }
  }
}

/** Effective normalized alpha for a color + modifier stack (diagnostics). */
export function effectiveAlpha(
  color: ManagedColor,
  modifiers: readonly VariableModifier[],
): number | null {
  const { valid } = applyAlphaModifiers(color, modifiers);
  return valid ? normalizedAlpha(applyAlphaModifiers(color, modifiers).color) : null;
}
