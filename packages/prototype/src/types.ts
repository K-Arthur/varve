/**
 * Prototyping type definitions — triggers, actions, interactions, transitions,
 * easing, conditions, flow, and state types for the Strata prototype runtime.
 *
 * Research basis: Figma prototype interactions (triggers + actions model),
 * Framer variant system (states + parameters), Protopie (conditional branching),
 * CSS Web Animations / Web Animations API (easing + keyframes).
 */

import type { NodeId as SceneNodeId } from '@varve/scene';
export type NodeId = SceneNodeId;

// ── Trigger Types ────────────────────────────────────────────────

export type TriggerKind =
  | 'onClick'
  | 'onTap'
  | 'onHover'
  | 'onHoverEnd'
  | 'onDrag'
  | 'onScroll'
  | 'onKeyPress'
  | 'onFocus'
  | 'afterDelay'
  | 'onVariableChange'
  | 'onMediaQuery'
  | 'onMouseEnter'
  | 'onMouseLeave'
  | 'onLoad';

export type TriggerModifier = 'ctrl' | 'alt' | 'shift' | 'meta';

export interface BaseTrigger {
  kind: TriggerKind;
  debounce?: number;
}

export interface ClickTrigger extends BaseTrigger {
  kind: 'onClick' | 'onTap';
  count?: number;
}

export interface HoverTrigger extends BaseTrigger {
  kind: 'onHover' | 'onHoverEnd' | 'onMouseEnter' | 'onMouseLeave';
}

export interface DragTrigger extends BaseTrigger {
  kind: 'onDrag';
  direction?: 'horizontal' | 'vertical' | 'any';
  threshold?: number;
}

export interface ScrollTrigger extends BaseTrigger {
  kind: 'onScroll';
  amount?: number | string;
  targetId?: NodeId;
  direction?: 'up' | 'down' | 'left' | 'right' | 'any';
  visibility?: 'enter' | 'exit' | 'any';
}

export interface KeyPressTrigger extends BaseTrigger {
  kind: 'onKeyPress';
  key: string;
  modifiers?: TriggerModifier[];
}

export interface AfterDelayTrigger extends BaseTrigger {
  kind: 'afterDelay';
  ms: number;
  repeat?: number;
}

export interface VariableChangeTrigger extends BaseTrigger {
  kind: 'onVariableChange';
  variableId: string;
  equals?: string | number | boolean;
}

export interface MediaQueryTrigger extends BaseTrigger {
  kind: 'onMediaQuery';
  query: string;
}

export interface FocusTrigger extends BaseTrigger {
  kind: 'onFocus';
}

export interface LoadTrigger extends BaseTrigger {
  kind: 'onLoad';
}

export type Trigger =
  | ClickTrigger
  | HoverTrigger
  | DragTrigger
  | ScrollTrigger
  | KeyPressTrigger
  | AfterDelayTrigger
  | VariableChangeTrigger
  | MediaQueryTrigger
  | FocusTrigger
  | LoadTrigger;

// ── Action Types ─────────────────────────────────────────────────

export type ActionKind =
  | 'navigateTo'
  | 'openOverlay'
  | 'closeOverlay'
  | 'swapWithOverlay'
  | 'openURL'
  | 'setVariable'
  | 'toggleVariable'
  | 'toggleVisibility'
  | 'scrollTo'
  | 'startAnimation'
  | 'stopAnimation'
  | 'dismiss'
  | 'goBack';

export type NavigationDirection = 'left' | 'right' | 'up' | 'down' | 'none';

export type TransitionKind =
  | 'instant'
  | 'dissolve'
  | 'slide'
  | 'push'
  | 'moveIn'
  | 'moveOut'
  | 'smartAnimate';

export interface TransitionConfig {
  kind: TransitionKind;
  duration: number;
  easing: EasingDefinition;
  direction?: NavigationDirection;
  smartMatch?: 'byName' | 'byIndex' | 'byId';
}

export interface BaseAction {
  kind: ActionKind;
  delay?: number;
  condition?: ConditionDefinition;
}

export interface NavigateToAction extends BaseAction {
  kind: 'navigateTo';
  targetId: NodeId;
  transition: TransitionConfig;
}

export interface OpenOverlayAction extends BaseAction {
  kind: 'openOverlay';
  targetId: NodeId;
  position?:
    | 'center'
    | 'topLeft'
    | 'topRight'
    | 'bottomLeft'
    | 'bottomRight'
    | { x: number; y: number };
  closeOnBackdrop?: boolean;
  transition: TransitionConfig;
}

export interface CloseOverlayAction extends BaseAction {
  kind: 'closeOverlay';
  overlayId: NodeId;
  transition: TransitionConfig;
}

export interface SwapOverlayAction extends BaseAction {
  kind: 'swapWithOverlay';
  overlayId: NodeId;
  newTargetId: NodeId;
  transition: TransitionConfig;
}

export interface OpenURLAction extends BaseAction {
  kind: 'openURL';
  url: string;
  newTab?: boolean;
}

export interface SetVariableAction extends BaseAction {
  kind: 'setVariable';
  variableId: string;
  value: string | number | boolean;
  expression?: string;
}

export interface ToggleVariableAction extends BaseAction {
  kind: 'toggleVariable';
  variableId: string;
}

export interface ToggleVisibilityAction extends BaseAction {
  kind: 'toggleVisibility';
  targetId: NodeId;
  visible?: boolean;
}

export interface ScrollToAction extends BaseAction {
  kind: 'scrollTo';
  targetId: NodeId;
  containerId?: NodeId;
  behavior?: 'smooth' | 'instant' | 'auto';
  offset?: number;
}

export interface StartAnimationAction extends BaseAction {
  kind: 'startAnimation';
  targetId: NodeId;
  animationId: string;
}

export interface StopAnimationAction extends BaseAction {
  kind: 'stopAnimation';
  targetId: NodeId;
  animationId: string;
}

export interface DismissAction extends BaseAction {
  kind: 'dismiss';
}

export interface GoBackAction extends BaseAction {
  kind: 'goBack';
}

export type Action =
  | NavigateToAction
  | OpenOverlayAction
  | CloseOverlayAction
  | SwapOverlayAction
  | OpenURLAction
  | SetVariableAction
  | ToggleVariableAction
  | ToggleVisibilityAction
  | ScrollToAction
  | StartAnimationAction
  | StopAnimationAction
  | DismissAction
  | GoBackAction;

// ── Interaction Model ────────────────────────────────────────────

export interface Interaction {
  id: string;
  nodeId: NodeId;
  name: string;
  trigger: Trigger;
  actions: Action[];
  enabled: boolean;
  description?: string;
}

// ── Easing Definitions ───────────────────────────────────────────

export type EasingKind =
  | 'linear'
  | 'ease'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'cubicBezier'
  | 'spring'
  | 'steps';

export interface CubicBezierEasing {
  kind: 'cubicBezier';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SpringEasing {
  kind: 'spring';
  mass: number;
  stiffness: number;
  damping: number;
  velocity?: number;
}

export interface StepsEasing {
  kind: 'steps';
  count: number;
  position?: 'start' | 'end';
}

export type EasingDefinition =
  | { kind: 'linear' }
  | { kind: 'ease' }
  | { kind: 'easeIn' }
  | { kind: 'easeOut' }
  | { kind: 'easeInOut' }
  | CubicBezierEasing
  | SpringEasing
  | StepsEasing;

// ── Condition Definitions ────────────────────────────────────────

export type ComparisonOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'contains'
  | 'startsWith'
  | 'endsWith';

export type LogicalOperator = 'and' | 'or' | 'not';

export interface ConditionClause {
  variableId: string;
  operator: ComparisonOperator;
  value: string | number | boolean;
}

export type ConditionDefinition =
  | ConditionClause
  | { logicalOperator: 'and'; conditions: ConditionDefinition[] }
  | { logicalOperator: 'or'; conditions: ConditionDefinition[] }
  | { logicalOperator: 'not'; condition: ConditionDefinition };

// ── Prototype Document Extension ─────────────────────────────────

export interface PrototypeData {
  interactions: Record<NodeId, Interaction[]>;
  entryPoint?: NodeId;
  device?: DeviceConfig;
  breakpoints?: BreakpointConfig[];
  homeScreenId?: NodeId;
}

export interface DeviceConfig {
  type: 'phone' | 'tablet' | 'desktop' | 'watch' | 'tv' | 'custom';
  name: string;
  width: number;
  height: number;
  dpr: number;
  frameColor?: string;
  showNotch?: boolean;
  showHomeIndicator?: boolean;
}

export interface BreakpointConfig {
  name: string;
  minWidth: number;
  maxWidth: number;
  device?: DeviceConfig;
}

// ── State Types ──────────────────────────────────────────────────

export interface PrototypeVariable {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'color';
  value: string | number | boolean;
  editable?: boolean;
  description?: string;
}

export interface PrototypeState {
  variables: Record<string, PrototypeVariable>;
  currentScreenId: NodeId;
  overlayStack: NodeId[];
  scrollPositions: Record<string, { x: number; y: number }>;
  visibilityOverrides: Record<string, boolean>;
  animationStates: Record<string, 'running' | 'paused' | 'stopped' | 'finished'>;
}

// ── Flow Types ───────────────────────────────────────────────────

export interface FlowConnection {
  id: string;
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  interactionId: string;
}

export interface FlowData {
  nodes: NodeId[];
  connections: FlowConnection[];
}
