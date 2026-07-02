/**
 * @strata/prototype — Strata prototype engine.
 *
 * A complete, production-grade prototyping system: interaction engine,
 * animation system, state/variable management, navigation/flow system,
 * presentation/preview mode, debugging tools, and accessibility support.
 *
 * Research basis: Figma prototype interactions (trigger→action model),
 * Framer Variants (state-based micro-interactions), Protopie (conditional
 * branching), CSS Web Animations API, W3C UI Events, WCAG 2.2 AA.
 */

// Types
export type * from './types';

// Trigger system
export { matchTrigger } from './triggers';
export type { PrototypeEvent } from './triggers';

// Action system
export { executeAction, evaluateExpression } from './actions';
export type { ActionResult } from './actions';

// Interaction system
export { findInteractions, processInteractions, evaluateCondition } from './interactions';
export type { ProcessedInteraction } from './interactions';

// Animation system
export {
  addKeyframe,
  createTimeline,
  interpolateValue,
  sampleAt,
} from './animation';
export type { AnimationTimeline, Keyframe } from './animation';

// Transitions
export {
  animateScreenTransition,
  createTransitionAnimation,
} from './transitions';
export type { ScreenTransitionState, TransitionAnimation } from './transitions';

// Runtime
export {
  applyActionResult,
  createInitialState,
  createRuntime,
  getActiveOverlays,
  getVariable,
  handleEvent,
  setVariable,
} from './runtime';
export type { PrototypeRuntime } from './runtime';
