import type { Fill, GradientStop, ManagedColor } from '@strata/scene';
import {
  autoFixContrast,
  contrastRatio,
  managedColorToRgba,
  relativeLuminance,
  wcagLevel,
} from '@strata/shared';

export interface ContrastResult {
  ratio: number;
  passes: boolean;
  level: 'AAA' | 'AA' | 'FAIL';
  warning?: string;
  autoFix?: () => ManagedColor;
}

function isLargeText(fontSize?: number, fontWeight?: number): boolean {
  if (fontSize == null) return false;
  return fontSize >= 24 || (fontSize >= 18.67 && (fontWeight ?? 400) >= 700);
}

function rgbaFromManaged(c: ManagedColor): [number, number, number, number] {
  return managedColorToRgba(c);
}

export function checkContrast(
  fg: ManagedColor,
  bg: ManagedColor | null,
  options?: { fontSize?: number; fontWeight?: number },
): ContrastResult {
  if (!bg) {
    return {
      ratio: 0,
      passes: false,
      level: 'FAIL',
      warning: 'Background not determined — contrast depends on layered context',
    };
  }

  const [, , , fgA] = rgbaFromManaged(fg);
  if (fgA === 0) {
    return {
      ratio: 0,
      passes: false,
      level: 'FAIL',
      warning: 'Fill is fully transparent — no contrast to evaluate',
    };
  }

  const [fr, fg_, fb] = rgbaFromManaged(fg);
  const [br, bg_, bb] = rgbaFromManaged(bg);

  const fgLum = relativeLuminance(fr, fg_, fb);
  const bgLum = relativeLuminance(br, bg_, bb);
  const ratio = contrastRatio(fgLum, bgLum);
  const large = isLargeText(options?.fontSize, options?.fontWeight);
  const level = wcagLevel(ratio, large);

  const passes = level !== 'FAIL';

  let autoFixFn: (() => ManagedColor) | undefined;
  if (!passes && fgA >= 255) {
    autoFixFn = () => {
      const fixed = autoFixContrast(fr, fg_, fb, br, bg_, bb);
      if (!fixed) return fg;
      return { space: 'rgb', r: fixed.r, g: fixed.g, b: fixed.b, a: 255 };
    };
  }

  return {
    ratio,
    passes,
    level,
    ...(level === 'FAIL' && !autoFixFn
      ? { warning: 'Cannot auto-fix: fill has transparency' }
      : {}),
    ...(autoFixFn ? { autoFix: autoFixFn } : {}),
  };
}

export function checkFillContrast(
  fills: Fill[],
  background: ManagedColor | null,
  options?: { fontSize?: number; fontWeight?: number },
): ContrastResult {
  const solidFill = fills.find((f) => f.visible && f.type === 'solid');
  if (solidFill?.color) {
    return checkContrast(solidFill.color, background, options);
  }

  const gradientFill = fills.find((f) => f.visible && f.type === 'gradient');
  if (gradientFill?.gradient) {
    const result = checkGradientContrast(gradientFill.gradient.stops, background);
    return {
      ...result,
      warning: result.warning ?? 'Gradient fill — checking worst-case stop',
    };
  }

  return {
    ratio: 0,
    passes: false,
    level: 'FAIL',
    warning: 'No solid or gradient fill found — cannot determine contrast',
  };
}

export function checkGradientContrast(
  stops: GradientStop[],
  background: ManagedColor | null,
): ContrastResult {
  if (stops.length === 0) {
    return {
      ratio: 0,
      passes: false,
      level: 'FAIL',
      warning: 'No gradient stops — cannot determine contrast',
    };
  }

  let worstRatio = Infinity;

  for (const stop of stops) {
    const result = checkContrast(stop.color, background);
    if (result.ratio < worstRatio) {
      worstRatio = result.ratio;
    }
  }

  const ratio = worstRatio === Infinity ? 0 : worstRatio;
  const level = wcagLevel(ratio, false);
  const passes = level !== 'FAIL';

  return {
    ratio,
    passes,
    level,
    warning: !passes && background ? 'Gradient stop may fail against background' : undefined,
    autoFix: undefined,
  };
}
