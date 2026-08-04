/**
 * Transition animation system — creates screen-to-screen transition animations
 * for the prototype runtime (dissolve, slide, push, moveIn, moveOut, instant).
 *
 * Research basis: Figma prototype transitions (Smart Animate, dissolve, slide,
 * push, moveIn/moveOut), CSS View Transitions API, Web Animations API.
 * Smart Animate layer matching is handled at the runtime level.
 */

import { getEasingFn } from '@varve/shared';
import type { SmartAnimateLayerValues } from './smartAnimate';
import type { NavigationDirection, TransitionConfig } from './types';

/**
 * Describes the animation curves for a screen transition.
 * Used by the renderer to animate between two screens.
 */
export interface TransitionAnimation {
  kind: TransitionConfig['kind'];
  duration: number;
  inKeyframes: {
    inOffsetX: number;
    inOffsetY: number;
    inOpacity: number;
  };
  outKeyframes: {
    outOffsetX: number;
    outOffsetY: number;
    outOpacity: number;
  };
}

/**
 * Create a transition animation configuration from a TransitionConfig.
 */
export function createTransitionAnimation(transition: TransitionConfig): TransitionAnimation {
  const dir = transition.direction ?? 'left';
  const [inStartX, inStartY, outEndX, outEndY] = getOffsetFromDirection(dir);

  const isOverlay = transition.kind === 'dissolve' || transition.kind === 'push';

  return {
    kind: transition.kind,
    duration: transition.duration,
    inKeyframes: {
      inOffsetX: inStartX,
      inOffsetY: inStartY,
      inOpacity: isOverlay ? 0 : 1,
    },
    outKeyframes: {
      outOffsetX: outEndX,
      outOffsetY: outEndY,
      outOpacity: isOverlay ? 0 : 1,
    },
  };
}

function getOffsetFromDirection(dir: NavigationDirection): [number, number, number, number] {
  switch (dir) {
    case 'left':
      return [1, 0, -1, 0];
    case 'right':
      return [-1, 0, 1, 0];
    case 'up':
      return [0, 1, 0, -1];
    case 'down':
      return [0, -1, 0, 1];
    case 'none':
      return [0, 0, 0, 0];
  }
}

/**
 * Screen state during a transition.
 */
export interface ScreenTransitionState {
  outOffsetX: number;
  outOffsetY: number;
  outOpacity: number;
  inOffsetX: number;
  inOffsetY: number;
  inOpacity: number;
}

/**
 * Compute the visual state of a screen transition at a given progress [0, 1].
 * Handles all transition types with appropriate easing.
 */
export function animateScreenTransition(
  transition: TransitionConfig,
  progress: number,
  currentScreenState: { x: number; y: number; opacity: number },
  smartAnimateValues?: Record<string, SmartAnimateLayerValues>,
): ScreenTransitionState {
  const easedT = getEasingFn(transition.easing)(progress);
  const anim = createTransitionAnimation(transition);

  if (transition.kind === 'instant') {
    return {
      outOffsetX: 0,
      outOffsetY: 0,
      outOpacity: 0,
      inOffsetX: 0,
      inOffsetY: 0,
      inOpacity: 1,
    };
  }

  if (transition.kind === 'dissolve') {
    return {
      outOffsetX: 0,
      outOffsetY: 0,
      outOpacity: 1 - easedT,
      inOffsetX: 0,
      inOffsetY: 0,
      inOpacity: easedT,
    };
  }

  if (transition.kind === 'slide' || transition.kind === 'moveIn') {
    return {
      outOffsetX: anim.outKeyframes.outOffsetX * easedT * currentScreenState.x,
      outOffsetY: anim.outKeyframes.outOffsetY * easedT * currentScreenState.y,
      outOpacity: 1 - easedT * 0.3,
      inOffsetX: anim.inKeyframes.inOffsetX * (1 - easedT) * currentScreenState.x,
      inOffsetY: anim.inKeyframes.inOffsetY * (1 - easedT) * currentScreenState.y,
      inOpacity: 0.7 + easedT * 0.3,
    };
  }

  if (transition.kind === 'push') {
    return {
      outOffsetX: anim.outKeyframes.outOffsetX * easedT * currentScreenState.x,
      outOffsetY: anim.outKeyframes.outOffsetY * easedT * currentScreenState.y,
      outOpacity: 1 - easedT,
      inOffsetX: anim.inKeyframes.inOffsetX * (1 - easedT) * currentScreenState.x,
      inOffsetY: anim.inKeyframes.inOffsetY * (1 - easedT) * currentScreenState.y,
      inOpacity: easedT,
    };
  }

  if (transition.kind === 'moveOut') {
    return {
      outOffsetX: anim.outKeyframes.outOffsetX * easedT * currentScreenState.x,
      outOffsetY: anim.outKeyframes.outOffsetY * easedT * currentScreenState.y,
      outOpacity: 1 - easedT,
      inOffsetX: 0,
      inOffsetY: 0,
      inOpacity: 1,
    };
  }

  // smartAnimate — layer-level property interpolation
  if (transition.kind === 'smartAnimate') {
    if (smartAnimateValues && Object.keys(smartAnimateValues).length > 0) {
      // Compute average per-property interpolation progress across all matched layers
      let totalProgress = 0;
      let propCount = 0;
      for (const layerValues of Object.values(smartAnimateValues)) {
        for (const _val of Object.values(layerValues)) {
          totalProgress += easedT;
          propCount++;
        }
      }
      const avgProgress = propCount > 0 ? totalProgress / propCount : easedT;
      return {
        outOffsetX: 0,
        outOffsetY: 0,
        outOpacity: 1 - avgProgress,
        inOffsetX: avgProgress * 50,
        inOffsetY: 0,
        inOpacity: avgProgress,
      };
    }
    // Fall back to dissolve when no smart animate values
    return {
      outOffsetX: 0,
      outOffsetY: 0,
      outOpacity: 1 - easedT,
      inOffsetX: 0,
      inOffsetY: 0,
      inOpacity: easedT,
    };
  }

  return {
    outOffsetX: 0,
    outOffsetY: 0,
    outOpacity: 1 - easedT,
    inOffsetX: 0,
    inOffsetY: 0,
    inOpacity: easedT,
  };
}
