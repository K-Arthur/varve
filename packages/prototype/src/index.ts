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

// Accessibility
export {
  adjustTransitionForAccessibility,
  announceToScreenReader,
  generateAriaLabel,
  getFocusableElements,
  MIN_ANIMATION_DURATION,
  prefersReducedMotion,
} from './accessibility';
export type { ActionResult } from './actions';
// Action system
export { evaluateExpression, executeAction } from './actions';
export type { AnimationTimeline, Keyframe } from './animation';
// Animation system
export {
  addKeyframe,
  createTimeline,
  interpolateValue,
  sampleAt,
} from './animation';
export type { LogEntry, LogLevel } from './debug';
// Debug
export { PrototypeDebugConsole } from './debug';
export type { ProcessedInteraction } from './interactions';
// Interaction system
export { evaluateCondition, findInteractions, processInteractions } from './interactions';
// Navigation / Flow
export {
  addConnection,
  createFlowData,
  findEntryPoint,
  findOrphanNodes,
  findPath,
  getAllReachable,
  getIncomingConnections,
  getOutgoingConnections,
  removeConnection,
  resolveEntryPoint,
} from './navigation';
// Responsive
export {
  createBreakpointConfig,
  findActiveBreakpoint,
  getDeviceForViewport,
  sortBreakpoints,
} from './responsive';
export type { PrototypeRuntime } from './runtime';
// Runtime
export {
  applyActionResult,
  createInitialState,
  createRuntime,
  getActiveOverlays,
  getVariable,
  handleEvent,
  processDelays,
  setVariable,
} from './runtime';
export type { ScrollContainer, ScrollState } from './scrolling';
// Scrolling
export {
  createScrollContainer,
  getScrollPosition,
  getVisibleBounds,
  isElementVisible,
  setScrollPosition,
} from './scrolling';
export type { ScreenTransitionState, TransitionAnimation } from './transitions';
// Transitions
export {
  animateScreenTransition,
  createTransitionAnimation,
} from './transitions';
export { buildSmartAnimateValues, matchLayersByName } from './smartAnimate';
export type { LayerMatch } from './smartAnimate';
// Trigger system
export { matchTrigger } from './triggers';
// Types
export type * from './types';
export type { ValidationIssue } from './validation';
// Validation
export { validatePrototype } from './validation';
export type { PrototypeVariableDef, PrototypeVariableStore } from './variables';
// Variables
export {
  createVariable,
  evaluatePrototypeExpression,
  getVariableValue,
  resolvePrototypeVariable,
  setVariableValue,
} from './variables';
