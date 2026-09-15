export interface StartupCapabilities {
  /** Whether CSS/SVG animations should play (respects reduced-motion). */
  canAnimate: boolean;
  /** GPU capability score 0-1 (1 = best effort). Proxied via WebGL context probe. */
  gpuScore: number;
  /** Whether Canvas2D is available (always true in modern browsers, but defensive). */
  canvasAvailable: boolean;
  /** True when animations should be simplified (reduced-motion OR very low gpuScore). */
  shouldSimplify: boolean;
}

export function checkStartupCapabilities(): StartupCapabilities {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let gpuScore = 0.5;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const gl = probe.getContext('webgl') ?? probe.getContext('webgl2');
    if (gl) {
      gpuScore = 1.0;
      const loseContext = gl.getExtension('WEBGL_lose_context');
      loseContext?.loseContext();
    }
  } catch {
    gpuScore = 0.3;
  }

  const canvasAvailable = typeof HTMLCanvasElement !== 'undefined';
  const shouldSimplify = reducedMotion || gpuScore < 0.4;

  return {
    canAnimate: !reducedMotion,
    gpuScore,
    canvasAvailable,
    shouldSimplify,
  };
}
