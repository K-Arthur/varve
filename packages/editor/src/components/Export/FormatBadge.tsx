/**
 * FormatBadge — the single format-identity chip for every export surface.
 *
 * A badge is metadata, not status: it must never borrow the danger/warning/
 * success meanings the app reserves for real state, and it must never be the
 * only carrier of the format name. The treatment is deliberately neutral and
 * token-based so the Inspector's configuration rows and the batch dialog's
 * job rows read identically, in every theme, without per-format palettes that
 * drifted between the two surfaces (the 2026-09-17 review found PNG green in
 * the Inspector and teal in the dialog, SVG teal vs amber, and a fully
 * hardcoded WebP purple).
 *
 * The exported `formatLabel` is also used by the dialog's format filters so
 * chips and badges always spell a format the same way.
 */

import './FormatBadge.css';

export interface FormatBadgeProps {
  /** Export format identifier (`png`, `jpeg`, `svg`, `pdf-x1a`, …). */
  format: string;
  /** Additional class hooks for the consumer's layout. */
  className?: string;
}

const FORMAT_LABELS: Record<string, string> = {
  jpg: 'JPG',
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WEBP',
  avif: 'AVIF',
  gif: 'GIF',
  svg: 'SVG',
  'svg-component': 'SVG',
  pdf: 'PDF',
  'pdf-screen': 'PDF',
  'pdf-x1a': 'PDF/X-1a',
  'pdf-x3': 'PDF/X-3',
  'pdf-x4': 'PDF/X-4',
  tiff: 'TIFF',
  bmp: 'BMP',
  ico: 'ICO',
  eps: 'EPS',
  psd: 'PSD',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  react: 'REACT',
  flutter: 'FLUTTER',
  swiftui: 'SWIFTUI',
};

/** Display label for a format identifier; unknown formats upper-case as-is. */
export function formatLabel(format: string): string {
  return FORMAT_LABELS[format.toLowerCase()] ?? format.toUpperCase();
}

export function FormatBadge({ format, className }: FormatBadgeProps) {
  return (
    <span className={`format-badge${className ? ` ${className}` : ''}`}>{formatLabel(format)}</span>
  );
}
