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

  // Inner content only (strip the outer <svg> so the consumer controls the
  // box) — content is guaranteed sanitized at this point.
  const inner = safe.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

  return (
    <span
      className={className}
      // Content is guaranteed sanitized by sanitizeSvg above.
      dangerouslySetInnerHTML={{ __html: inner }}
      {...attrs}
    />
  );
}
