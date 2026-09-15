/**
 * Gradient preset format detection (content sniffing).
 */

export type GradientFileFormat =
  | 'photoshop-grd'
  | 'photoshop-grd-legacy'
  | 'varve-gradient-json'
  | 'unknown';

/** Detect the gradient format from raw bytes. */
export function detectGradientFormatBytes(data: Uint8Array): GradientFileFormat {
  if (data.byteLength >= 4) {
    const sig = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);
    if (sig === '8BGR') return 'photoshop-grd';
    if (sig === 'Grad') return 'photoshop-grd-legacy';
  }
  const head = String.fromCharCode(...Array.from(data.slice(0, 128)));
  if (looksLikeJson(head)) return 'varve-gradient-json';
  return 'unknown';
}

/** Detect the gradient format from a text payload (JSON interchange). */
export function detectGradientFormatText(text: string): GradientFileFormat {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'varve-gradient-json';
  }
  return 'unknown';
}

export function looksLikeJson(head: string): boolean {
  const trimmed = head.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function detectGradientFormat(input: string | Uint8Array): GradientFileFormat {
  if (typeof input === 'string') return detectGradientFormatText(input);
  return detectGradientFormatBytes(input);
}
