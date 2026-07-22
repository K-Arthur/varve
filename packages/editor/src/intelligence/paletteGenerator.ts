import type { Document, ManagedColor } from '@strata/scene';
import { addSwatch } from '@strata/scene';
import {
  type ColorBlindnessType,
  contrastRatio,
  managedColorToRgba,
  relativeLuminance,
  simulateColorBlindness,
} from '@strata/shared';

export interface PaletteBackground {
  name: string;
  color: ManagedColor;
}

export interface GenerateOptions {
  heroColor: ManagedColor;
  backgrounds: PaletteBackground[];
  simulateCVD?: boolean;
}

export interface ContrastInfo {
  ratio: number;
  passesAA: boolean;
  passesAAA: boolean;
}

export interface PaletteCandidate {
  name: string;
  color: ManagedColor;
  changed: boolean;
  contrastRatios: ContrastInfo[];
}

export interface CvdSimulation {
  type: ColorBlindnessType;
  candidates: PaletteCandidate[];
}

export interface PaletteResult {
  candidates: PaletteCandidate[];
  heroColor: ManagedColor;
  disclaimer: string;
  cvdSimulations?: CvdSimulation[];
}

function computeContrast(color: ManagedColor, backgrounds: PaletteBackground[]): ContrastInfo[] {
  const [r, g, b] = managedColorToRgba(color);
  const fgLum = relativeLuminance(r, g, b);
  return backgrounds.map((bg) => {
    const [br, bg_, bb] = managedColorToRgba(bg.color);
    const bgLum = relativeLuminance(br, bg_, bb);
    const ratio = contrastRatio(fgLum, bgLum);
    return {
      ratio,
      passesAA: ratio >= 4.5,
      passesAAA: ratio >= 7,
    };
  });
}

function generateCandidates(
  heroColor: ManagedColor,
  backgrounds: PaletteBackground[],
): PaletteCandidate[] {
  const [_hr, _hg, _hb] = managedColorToRgba(heroColor);

  const surface: ManagedColor = { space: 'rgb', r: 255, g: 255, b: 255, a: 1 };
  const textPrimary: ManagedColor = { space: 'rgb', r: 16, g: 21, b: 31, a: 1 };

  return [
    {
      name: 'hero',
      color: heroColor,
      changed: false,
      contrastRatios: computeContrast(heroColor, backgrounds),
    },
    {
      name: 'light',
      color: { space: 'rgb', r: 255, g: 255, b: 255, a: 1 },
      changed: true,
      contrastRatios: computeContrast({ space: 'rgb', r: 255, g: 255, b: 255, a: 1 }, backgrounds),
    },
    {
      name: 'dark',
      color: { space: 'rgb', r: 16, g: 21, b: 31, a: 1 },
      changed: true,
      contrastRatios: computeContrast({ space: 'rgb', r: 16, g: 21, b: 31, a: 1 }, backgrounds),
    },
    {
      name: 'surface',
      color: surface,
      changed: true,
      contrastRatios: computeContrast(surface, backgrounds),
    },
    {
      name: 'text-primary',
      color: textPrimary,
      changed: true,
      contrastRatios: computeContrast(textPrimary, backgrounds),
    },
    {
      name: 'accent',
      color: { space: 'rgb', r: 57, g: 208, b: 198, a: 1 },
      changed: true,
      contrastRatios: computeContrast({ space: 'rgb', r: 57, g: 208, b: 198, a: 1 }, backgrounds),
    },
  ];
}

export function generateAccessiblePalette(_doc: Document, options: GenerateOptions): PaletteResult {
  const candidates = generateCandidates(options.heroColor, options.backgrounds);
  const result: PaletteResult = {
    candidates,
    heroColor: options.heroColor,
    disclaimer: 'Generated palette may need manual adjustment for specific use cases.',
  };

  if (options.simulateCVD) {
    const types: ColorBlindnessType[] = ['protanopia', 'deuteranopia', 'tritanopia'];
    result.cvdSimulations = types.map((type) => ({
      type,
      candidates: candidates.map((c) => {
        const [r, g, b] = managedColorToRgba(c.color);
        const simulated = simulateColorBlindness(r, g, b, type);
        return {
          ...c,
          color: { space: 'rgb', r: simulated[0], g: simulated[1], b: simulated[2], a: 1 },
        };
      }),
    }));
  }

  return result;
}

export function applyPaletteAsSwatches(doc: Document, candidates: PaletteCandidate[]): Document {
  let result = doc;
  for (const c of candidates) {
    result = addSwatch(result, `palette-${c.name}`, c.color);
  }
  return result;
}
