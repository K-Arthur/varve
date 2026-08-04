/**
 * RAF-driven prototype screen transition (Smart Animate + standard transitions).
 */

import type { LayerMatch, SmartAnimateLayerValues, TransitionConfig } from '@varve/prototype';
import { animateScreenTransition, prefersReducedMotion } from '@varve/prototype';
import { useEffect, useState } from 'react';

export interface ActivePrototypeTransition {
  fromScreenId: string;
  toScreenId: string;
  transition: TransitionConfig;
  smartAnimateValues?: Record<string, SmartAnimateLayerValues>;
  layerMatches?: LayerMatch[];
  startedAt: number;
}

export function usePrototypeTransition(transition: ActivePrototypeTransition | null): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!transition) {
      setProgress(0);
      return;
    }

    if (prefersReducedMotion() || transition.transition.kind === 'instant') {
      setProgress(1);
      return;
    }

    const duration = Math.max(transition.transition.duration, 1);
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - transition.startedAt;
      const t = Math.min(1, elapsed / duration);
      setProgress(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transition]);

  return progress;
}

export function computeTransitionVisuals(
  transition: ActivePrototypeTransition,
  progress: number,
): {
  from: { opacity: number; transform: string };
  to: { opacity: number; transform: string };
} {
  const state = animateScreenTransition(
    transition.transition,
    progress,
    { x: 0, y: 0, opacity: 1 },
    transition.smartAnimateValues as Record<string, SmartAnimateLayerValues> | undefined,
  );
  return {
    from: {
      opacity: state.outOpacity,
      transform: `translate(${state.outOffsetX}px, ${state.outOffsetY}px)`,
    },
    to: {
      opacity: state.inOpacity,
      transform: `translate(${state.inOffsetX}px, ${state.inOffsetY}px)`,
    },
  };
}
