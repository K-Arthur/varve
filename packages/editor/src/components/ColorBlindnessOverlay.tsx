import { simulateColorBlindness } from '@varve/shared';
import { useEffect, useRef } from 'react';

export type ColorBlindnessView = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export function ColorBlindnessOverlay({
  type,
  sourceCanvas,
}: {
  type: Exclude<ColorBlindnessView, 'none'>;
  sourceCanvas: HTMLCanvasElement | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const src = sourceCanvas;
    if (!canvas || !src) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const draw = () => {
      const cssW = parent.clientWidth;
      const cssH = parent.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      const dpr = window.devicePixelRatio ?? 1;

      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      const offscreen = new OffscreenCanvas(cssW * dpr, cssH * dpr);
      const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!offCtx) return;

      offCtx.drawImage(src, 0, 0);

      const iw = offscreen.width;
      const ih = offscreen.height;
      if (iw === 0 || ih === 0) return;

      const imageData = offCtx.getImageData(0, 0, iw, ih);
      const pixels = imageData.data;

      for (let i = 0; i < pixels.length; i += 4) {
        const [sr, sg, sb] = simulateColorBlindness(
          pixels[i]!,
          pixels[i + 1]!,
          pixels[i + 2]!,
          type,
        );
        pixels[i] = sr;
        pixels[i + 1] = sg;
        pixels[i + 2] = sb;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      offCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(offscreen, 0, 0);
    };

    const tick = () => {
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [type, sourceCanvas]);

  return <canvas ref={canvasRef} className="editor-canvas__color-blindness" aria-hidden />;
}
