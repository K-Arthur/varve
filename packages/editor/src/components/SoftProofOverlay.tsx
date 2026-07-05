import React, { useEffect, useRef } from 'react';
import { rgbToCmyk } from '@strata/shared';

export interface SoftProofOverlayProps {
  softProofEnabled: boolean;
  /** Optional: reference to the main canvas element for per-pixel proofing. */
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

/**
 * SoftProofOverlay — print simulation overlay.
 *
 * When enabled, adds a saturation blend overlay to simulate gamut reduction
 * on screen. When a canvas ref is provided, also renders a per-pixel CMYK
 * conversion preview in a hidden canvas for accurate color assessment.
 */
export function SoftProofOverlay({ softProofEnabled, canvasRef }: SoftProofOverlayProps) {
  const proofCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!softProofEnabled || !canvasRef?.current || !proofCanvasRef.current) return;

    const src = canvasRef.current;
    const dst = proofCanvasRef.current;
    const ctx = dst.getContext('2d');
    if (!ctx) return;

    const w = src.width;
    const h = src.height;
    if (w === 0 || h === 0) return;

    dst.width = w;
    dst.height = h;

    // Draw source canvas content to proof canvas
    ctx.drawImage(src, 0, 0);

    // Convert pixels to simulate CMYK gamut
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]! / 255;
      const g = d[i + 1]! / 255;
      const b = d[i + 2]! / 255;

      // Analytical CMYK conversion (returns [c, m, y, k] in 0-1 range)
      const [c, m, y, k] = rgbToCmyk(r, g, b);

      // Simulate dot gain and gamut reduction
      const maxInk = 340; // TAC limit for coated paper
      const total = (c + m + y + k) * 100;
      const scale = total > maxInk ? maxInk / total : 1;

      // Apply TAC scaling and convert back to RGB for display
      const sc = c * scale;
      const sm = m * scale;
      const sy = y * scale;
      const sk = k * scale;

      // CMYK → RGB (inverse)
      const rr = (1 - sc) * (1 - sk);
      const gg = (1 - sm) * (1 - sk);
      const bb = (1 - sy) * (1 - sk);

      d[i] = Math.round(rr * 255);
      d[i + 1] = Math.round(gg * 255);
      d[i + 2] = Math.round(bb * 255);
    }

    ctx.putImageData(imageData, 0, 0);
  }, [softProofEnabled, canvasRef]);

  if (!softProofEnabled) return null;

  return (
    <>
      {/* CSS saturation-blend overlay for quick preview */}
      <div
        data-testid="soft-proof-overlay"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: 'none',
          zIndex: 9998,
          mixBlendMode: 'saturation' as React.CSSProperties['mixBlendMode'],
          background: 'transparent',
        }}
      />
      {/* Canvas-based CMYK simulation (hidden, used by developer tools) */}
      <canvas
        ref={proofCanvasRef}
        data-testid="soft-proof-cmyk-canvas"
        style={{ display: 'none' }}
        width={0}
        height={0}
      />
    </>
  );
}
