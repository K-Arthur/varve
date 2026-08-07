/**
 * SafeSvg — the single sanctioned way to render third-party SVG content.
 *
 * Every SVG that reaches the UI (preview, details, inserted cards) goes
 * through the sanitizer here, regardless of how it was stored. This keeps
 * the trust boundary at the render site instead of relying on "it was
 * sanitized when written to the cache".
 */

import { type SanitizeWarning, sanitizeSvg } from '@varve/engine';
import { useMemo } from 'react';

export interface SafeSvgProps {
  /** Raw (untrusted) SVG string. */
  svg: string;
  /** Accessible label; when omitted the element is hidden from AT. */
  label?: string;
  className?: string;
  /** When true, render as an <img> (impossible to execute scripts). */
  asImage?: boolean;
  onSanitizeWarning?: (warnings: SanitizeWarning[]) => void;
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function SafeSvg({ svg, label, className, asImage, onSanitizeWarning }: SafeSvgProps) {
  const safe = useMemo(() => {
    try {
      const result = sanitizeSvg(svg);
      if (result.warnings.length > 0) onSanitizeWarning?.(result.warnings);
      return { svg: result.svg, ok: true };
    } catch {
      return { svg: '', ok: false };
    }
  }, [svg, onSanitizeWarning]);

  if (!safe.ok || !safe.svg) {
    return <span className={className} data-safe-svg="rejected" />;
  }

  const attrs = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };

  if (asImage) {
    return <img className={className} src={svgToDataUrl(safe.svg)} alt={label ?? ''} {...attrs} />;
  }

  // Render the FULL sanitized SVG (root preserved). SVG geometry only draws
  // when its elements live in the SVG namespace — that requires a real
  // <svg> root. Injecting just the inner <path>/<title> into a plain span
  // parses them as HTML elements (HTMLUnknownElement) and nothing renders.
  // The consumer sizes the box via CSS (.icon-card__svg svg { width/height:
  // 100% }); the svg root's own width/height attributes lose to CSS.
  return (
    <span
      className={className}
      // Content is guaranteed sanitized by sanitizeSvg above.
      dangerouslySetInnerHTML={{ __html: safe.svg }}
      {...attrs}
    />
  );
}
