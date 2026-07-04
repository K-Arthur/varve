import { useMemo } from 'react';

export interface GamutWarningProps {
  r: number;
  g: number;
  b: number;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60;
    else if (max === gg) h = ((bb - rr) / d + 2) * 60;
    else h = ((rr - gg) / d + 4) * 60;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return [h, s, v];
}

export function GamutWarning({ r, g, b }: GamutWarningProps) {
  const outOfGamut = useMemo(() => {
    const [, s, v] = rgbToHsv(r, g, b);
    return s > 85 && v > 15;
  }, [r, g, b]);

  if (!outOfGamut) return null;

  return (
    <div className="gamut-warning" role="status" aria-live="polite" title="Out of CMYK gamut">
      <span aria-hidden className="gamut-warning__icon">
        !
      </span>
      <span>Out of CMYK gamut</span>
    </div>
  );
}
