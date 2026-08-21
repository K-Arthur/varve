import type { GradientFill, GradientInterpolationSpace, HueInterpolation } from '@varve/scene';

/**
 * Resolve the value shown by inspector controls without changing the model.
 * Missing interpolation metadata is historical sRGB, while an explicit
 * document source inherits the current document default.
 */
export function resolvedGradientInterpolationSpace(
  gradient: GradientFill | undefined,
  documentDefault: GradientInterpolationSpace = 'oklab',
): GradientInterpolationSpace | undefined {
  if (!gradient) return undefined;
  return gradient.interpolationSource === 'document'
    ? documentDefault
    : (gradient.interpolationSpace ?? 'srgb');
}

/** Resolve hue state only when the active interpolation space uses hue. */
export function resolvedGradientHueInterpolation(
  gradient: GradientFill | undefined,
  documentDefault: GradientInterpolationSpace = 'oklab',
): HueInterpolation | undefined {
  const space = resolvedGradientInterpolationSpace(gradient, documentDefault);
  if (space !== 'oklch' && space !== 'hsl') return undefined;
  return gradient?.hueInterpolation ?? 'shorter';
}
