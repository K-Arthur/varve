import { rgbToCmyk } from '@varve/shared';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { useViewProofState } from './viewProofState';
import './SoftProofOverlay.css';

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
  const { grayscale, mirror } = useViewProofState();

  useEffect(() => {
    const rootAttributes = new Map<
      HTMLElement,
      { grayscale: string | null; mirror: string | null }
    >();
    const canvasTabIndexes = new Map<HTMLCanvasElement, string | null>();

    const restore = () => {
      for (const [root, previous] of rootAttributes) {
        if (previous.grayscale === null) delete root.dataset.viewProofGrayscale;
        else root.dataset.viewProofGrayscale = previous.grayscale;
        if (previous.mirror === null) delete root.dataset.viewProofMirror;
        else root.dataset.viewProofMirror = previous.mirror;
      }
      rootAttributes.clear();

      for (const [canvas, tabIndex] of canvasTabIndexes) {
        if (tabIndex === null) canvas.removeAttribute('tabindex');
        else canvas.setAttribute('tabindex', tabIndex);
      }
      canvasTabIndexes.clear();
    };

    const restoreRoot = (root: HTMLElement) => {
      const previous = rootAttributes.get(root);
      if (!previous) return;
      if (previous.grayscale === null) delete root.dataset.viewProofGrayscale;
      else root.dataset.viewProofGrayscale = previous.grayscale;
      if (previous.mirror === null) delete root.dataset.viewProofMirror;
      else root.dataset.viewProofMirror = previous.mirror;
      rootAttributes.delete(root);
    };

    if (!grayscale && !mirror) return;

    const syncCanvasView = () => {
      const roots = new Set(document.querySelectorAll<HTMLElement>('.editor-canvas'));
      for (const root of rootAttributes.keys()) {
        if (!roots.has(root)) restoreRoot(root);
      }

      for (const root of roots) {
        if (!rootAttributes.has(root)) {
          rootAttributes.set(root, {
            grayscale: root.getAttribute('data-view-proof-grayscale'),
            mirror: root.getAttribute('data-view-proof-mirror'),
          });
        }

        if (grayscale) root.dataset.viewProofGrayscale = 'true';
        else delete root.dataset.viewProofGrayscale;
        if (mirror) root.dataset.viewProofMirror = 'true';
        else delete root.dataset.viewProofMirror;

        const contentCanvas = root.querySelector<HTMLCanvasElement>(
          '.editor-canvas__content-layer',
        );
        if (!contentCanvas) continue;
        if (!canvasTabIndexes.has(contentCanvas)) {
          canvasTabIndexes.set(contentCanvas, contentCanvas.getAttribute('tabindex'));
        }
        if (mirror) {
          if (root.contains(document.activeElement)) {
            (document.activeElement as HTMLElement).blur?.();
          }
          contentCanvas.tabIndex = -1;
        } else {
          const tabIndex = canvasTabIndexes.get(contentCanvas);
          if (tabIndex === null) contentCanvas.removeAttribute('tabindex');
          else if (tabIndex !== undefined) contentCanvas.setAttribute('tabindex', tabIndex);
        }
      }

      for (const canvas of canvasTabIndexes.keys()) {
        if (!canvas.isConnected) {
          const tabIndex = canvasTabIndexes.get(canvas);
          if (tabIndex === null) canvas.removeAttribute('tabindex');
          else if (tabIndex !== undefined) canvas.setAttribute('tabindex', tabIndex);
          canvasTabIndexes.delete(canvas);
        }
      }
    };

    const observer = new MutationObserver(syncCanvasView);
    observer.observe(document.body, { childList: true, subtree: true });
    syncCanvasView();

    return () => {
      observer.disconnect();
      restore();
    };
  }, [grayscale, mirror]);

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
