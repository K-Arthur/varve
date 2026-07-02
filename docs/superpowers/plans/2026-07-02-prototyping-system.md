# Prototyping System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD is mandatory.

**Goal:** Build a complete, production-grade prototyping ecosystem from scratch — interaction engine, animation system, state/variable management, navigation/flow system, presentation/preview mode, debugging tools, and accessibility support.

**Architecture:** New `@strata/prototype` package for core engine + `packages/shared` extensions + `packages/editor` UI components. The prototype runtime is an event→trigger→action→state pipeline that drives IR replay on the existing Canvas2D renderer.

**Tech Stack:** TypeScript 5.x, React 19, Vitest, Canvas2D IR replay, CSS Web Animations API for DOM transitions, `requestAnimationFrame` for JS-driven animations.

**Packages affected:**
- `packages/prototype` (NEW) — Core prototype engine
- `packages/shared` — Easing math, animation interpolation
- `packages/editor` — Prototype UI panels, presentation mode
- `packages/engine` — Prototype rendering extensions
- `packages/scene` — Prototype types on Document model

---

## Architecture Overview

```
@strata/prototype/
├── types.ts              # All prototype type definitions
├── triggers.ts           # Trigger system (click, hover, scroll, key, etc.)
├── actions.ts            # Action system (navigate, overlay, setVariable, etc.)
├── interactions.ts       # Interaction model (trigger→action mapping)
├── transitions.ts        # Transition/animation types
├── animation.ts          # Animation engine (keyframes, timelines, easing)
├── runtime.ts            # Prototype runtime engine (event→trigger→action→state)
├── state.ts              # Prototype state machine
├── navigation.ts         # Navigation/flow system
├── variables.ts          # Prototype-specific variable system
├── conditionals.ts       # Conditional branching (if/else)
├── responsive.ts         # Responsive breakpoint system
├── scrolling.ts          # Scroll viewport management
├── validation.ts         # Prototype validation
├── debug.ts              # Debug console/logging
├── accessibility.ts      # Accessibility helpers (reduced-motion, keyboard nav)
├── index.ts              # Public API exports
```

```
@strata/editor/src/
├── context.tsx            # Extended with prototype state + methods
├── Shell.tsx              # Extended with presentation mode, prototype toolbars
├── Menubar.tsx            # Extended with Present entry
├── components/
│   ├── Prototype/
│   │   ├── PrototypePresenter.tsx   # Fullscreen presentation mode
│   │   ├── PrototypePlayer.tsx      # Inline prototype player
│   │   ├── PrototypePanel.tsx       # Right panel for prototype editing
│   │   ├── InteractionEditor.tsx    # Trigger/action editing UI
│   │   ├── TransitionEditor.tsx     # Animation/transition editing
│   │   ├── FlowView.tsx             # Flow diagram overlay
│   │   ├── DeviceFrame.tsx          # Device frame for previews
│   │   ├── PrototypeConsole.tsx     # Debug console
│   │   ├── StateInspector.tsx       # Variable/state inspector
│   │   ├── prototype.css            # Prototype UI styles
│   │   └── index.ts                 # Exports
```

---

## Phase 1: Foundation — Prototype Types, Interactions, Triggers, Actions

### Task 1.1: Core prototype types

**Files:**
- Create: `packages/prototype/src/types.ts`
- Create: `packages/prototype/src/triggers.ts`
- Create: `packages/prototype/src/actions.ts`
- Create: `packages/prototype/src/interactions.ts`
- Create: `packages/prototype/src/index.ts`
- Test: `packages/prototype/src/types.test.ts`
- Test: `packages/prototype/src/triggers.test.ts`
- Test: `packages/prototype/src/actions.test.ts`
- Test: `packages/prototype/src/interactions.test.ts`
- Modify: `packages/prototype/package.json`

**Step 1: Create package.json**

```json
{
  "name": "@strata/prototype",
  "version": "0.0.0",
  "private": true,
  "description": "Strata prototype engine: interactions, animations, state, presentation.",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "cd ../.. && vitest run packages/prototype"
  },
  "dependencies": {
    "@strata/engine": "workspace:*",
    "@strata/scene": "workspace:*",
    "@strata/shared": "workspace:*"
  }
}
```

**Step 2: Write the failing types test**

```typescript
// packages/prototype/src/types.test.ts
import { describe, it, expect } from 'vitest';

describe('PrototypeType', () => {
  it('TriggerKind includes all standard triggers', () => {
    const kinds: TriggerKind[] = [
      'onClick',
      'onTap',
      'onHover',
      'onHoverEnd',
      'onDrag',
      'onScroll',
      'onKeyPress',
      'onFocus',
      'afterDelay',
      'onVariableChange',
      'onMediaQuery',
      'onMouseEnter',
      'onMouseLeave',
      'onLoad',
    ];
    // Just asserting the type is valid
    expect(kinds.length).toBeGreaterThanOrEqual(10);
  });

  it('ActionKind includes all standard actions', () => {
    const kinds: ActionKind[] = [
      'navigateTo',
      'openOverlay',
      'closeOverlay',
      'swapWithOverlay',
      'openURL',
      'setVariable',
      'toggleVariable',
      'toggleVisibility',
      'scrollTo',
      'startAnimation',
      'stopAnimation',
      'dismiss',
      'goBack',
    ];
    expect(kinds.length).toBeGreaterThanOrEqual(10);
  });
});
```

**Step 3: Write the types.ts implementation**

```typescript
// packages/prototype/src/types.ts

import type { NodeId } from '@strata/scene';

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
  /** Optional debounce in ms for rapid-fire triggers like onScroll, onDrag */
  debounce?: number;
}

export interface ClickTrigger extends BaseTrigger {
  kind: 'onClick' | 'onTap';
  /** Optional count for double-click/triple-tap */
  count?: number;
}

export interface HoverTrigger extends BaseTrigger {
  kind: 'onHover' | 'onHoverEnd' | 'onMouseEnter' | 'onMouseLeave';
}

export interface DragTrigger extends BaseTrigger {
  kind: 'onDrag';
  /** Direction constraint for scroll-like drag navigation */
  direction?: 'horizontal' | 'vertical' | 'any';
  /** Minimum drag distance to trigger (px) */
  threshold?: number;
}

export interface ScrollTrigger extends BaseTrigger {
  kind: 'onScroll';
  /** Trigger when scrolled by this amount (px or %) */
  amount?: number | string;
  /** Trigger when reaching a specific element */
  targetId?: NodeId;
  /** Direction of scroll to watch */
  direction?: 'up' | 'down' | 'left' | 'right' | 'any';
  /** Trigger on entering/exiting viewport (intersection observer semantics) */
  visibility?: 'enter' | 'exit' | 'any';
}

export interface KeyPressTrigger extends BaseTrigger {
  kind: 'onKeyPress';
  key: string;
  /** Required modifier keys */
  modifiers?: TriggerModifier[];
}

export interface AfterDelayTrigger extends BaseTrigger {
  kind: 'afterDelay';
  /** Delay in milliseconds */
  ms: number;
  /** Optional repeat interval (for auto-advancing slideshows) */
  repeat?: number;
}

export interface VariableChangeTrigger extends BaseTrigger {
  kind: 'onVariableChange';
  variableId: string;
  /** Optional: only trigger when value matches this */
  equals?: string | number | boolean;
}

export interface MediaQueryTrigger extends BaseTrigger {
  kind: 'onMediaQuery';
  /** CSS-like media query (e.g., "max-width: 768px") */
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
  /** Direction for slide/push/moveIn/moveOut */
  direction?: NavigationDirection;
  /** Smart animate layer matching strategy */
  smartMatch?: 'byName' | 'byIndex' | 'byId';
}

export interface BaseAction {
  kind: ActionKind;
  /** Optional delay before action executes */
  delay?: number;
  /** Optional condition — only execute if predicate is true */
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
  /** Optional overlay position relative to parent */
  position?: 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | { x: number; y: number };
  /** Close on backdrop click */
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
  /** Simple value or expression string */
  value: string | number | boolean;
  /** Math expression (e.g. "count + 1") */
  expression?: string;
}

export interface ToggleVariableAction extends BaseAction {
  kind: 'toggleVariable';
  variableId: string;
}

export interface ToggleVisibilityAction extends BaseAction {
  kind: 'toggleVisibility';
  targetId: NodeId;
  /** If not set, toggles; if set, forces */
  visible?: boolean;
}

export interface ScrollToAction extends BaseAction {
  kind: 'scrollTo';
  targetId: NodeId;
  /** Scroll container to scroll */
  containerId?: NodeId;
  behavior?: 'smooth' | 'instant' | 'auto';
  /** Offset from top/left after scroll (px) */
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
  /** Node the interaction is attached to */
  nodeId: NodeId;
  /** Display name (auto-generated or custom) */
  name: string;
  /** Trigger that fires the interaction */
  trigger: Trigger;
  /** Actions to execute (sequence) */
  actions: Action[];
  /** Whether this interaction is active */
  enabled: boolean;
  /** User-facing description */
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

export type ComparisonOperator = 'equals' | 'notEquals' | 'greaterThan' | 'lessThan' | 'greaterThanOrEqual' | 'lessThanOrEqual' | 'contains' | 'startsWith' | 'endsWith';

export type LogicalOperator = 'and' | 'or' | 'not';

export interface ConditionComparison {
  operator: LogicalOperator | 'none';
  conditions: ConditionDefinition[];
}

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
  /** Interactions keyed by node ID */
  interactions: Record<NodeId, Interaction[]>;
  /** Prototype flow entry point */
  entryPoint?: NodeId;
  /** Device simulation settings */
  device?: DeviceConfig;
  /** Breakpoints for responsive simulation */
  breakpoints?: BreakpointConfig[];
  /** Home screen (first screen shown) */
  homeScreenId?: NodeId;
}

export interface DeviceConfig {
  type: 'phone' | 'tablet' | 'desktop' | 'watch' | 'tv' | 'custom';
  name: string;
  width: number;
  height: number;
  /** Device pixel ratio for @2x displays */
  dpr: number;
  /** Frame color */
  frameColor?: string;
  /** Show notch/dynamic island */
  showNotch?: boolean;
  /** Show home indicator */
  showHomeIndicator?: boolean;
}

export interface BreakpointConfig {
  name: string;
  minWidth: number;
  maxWidth: number;
  /** Device preset to use at this breakpoint */
  device?: DeviceConfig;
}

// ── State Types ──────────────────────────────────────────────────

export interface PrototypeVariable {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'color';
  value: string | number | boolean;
  /** Expose for user editing in simulator */
  editable?: boolean;
  /** Description for the variable purpose */
  description?: string;
}

export interface PrototypeState {
  variables: Record<string, PrototypeVariable>;
  /** Current prototype screen/frame */
  currentScreenId: NodeId;
  /** Open overlays stack */
  overlayStack: NodeId[];
  /** Scroll positions per container */
  scrollPositions: Record<string, { x: number; y: number }>;
  /** Visibility overrides per node */
  visibilityOverrides: Record<string, boolean>;
  /** Animation states per animation ID */
  animationStates: Record<string, 'running' | 'paused' | 'stopped' | 'finished'>;
}

// ── Flow/Diagram Types ───────────────────────────────────────────

export interface FlowConnection {
  id: string;
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  /** The interaction this connection represents */
  interactionId: string;
}

export interface FlowData {
  nodes: NodeId[];
  connections: FlowConnection[];
}
```

**Step 4: Test passes, implement triggers.ts**

**Step 5: Implement actions.ts**

**Step 6: Implement interactions.ts**

**Step 7: Implement index.ts (re-export all types)**

**Step 8: Commit**

```bash
git add packages/prototype/
git commit -m "feat(prototype): add core prototype types, triggers, actions, interactions"
```

---

## Phase 2: Animation Engine

### Task 2.1: Easing math in shared

**Files:**
- Create: `packages/shared/src/easing.ts`
- Test: `packages/shared/src/easing.test.ts`
- Modify: `packages/shared/src/index.ts`

### Task 2.2: Animation framework in prototype

**Files:**
- Create: `packages/prototype/src/animation.ts`
- Create: `packages/prototype/src/animation.test.ts`

### Task 2.3: Transitions system

**Files:**
- Create: `packages/prototype/src/transitions.ts`
- Test: `packages/prototype/src/transitions.test.ts`

---

## Phase 3: Prototype Runtime Engine

### Task 3.1: State machine

**Files:**
- Create: `packages/prototype/src/state.ts`
- Test: `packages/prototype/src/state.test.ts`

### Task 3.2: Runtime engine

**Files:**
- Create: `packages/prototype/src/runtime.ts`
- Test: `packages/prototype/src/runtime.test.ts`

---

## Phase 4: Navigation & Flow System

### Task 4.1: Navigation system

**Files:**
- Create: `packages/prototype/src/navigation.ts`
- Test: `packages/prototype/src/navigation.test.ts`

### Task 4.2: Flow management

**Files:**
- Create: `packages/prototype/src/flow.ts`
- Test: `packages/prototype/src/flow.test.ts`

---

## Phase 5: Variables, Conditionals, Logic

### Task 5.1: Prototype variables

**Files:**
- Create: `packages/prototype/src/variables.ts`
- Test: `packages/prototype/src/variables.test.ts`

### Task 5.2: Conditionals

**Files:**
- Create: `packages/prototype/src/conditionals.ts`
- Test: `packages/prototype/src/conditionals.test.ts`

---

## Phase 6: Responsive & Scrolling

### Task 6.1: Responsive system

**Files:**
- Create: `packages/prototype/src/responsive.ts`
- Test: `packages/prototype/src/responsive.test.ts`

### Task 6.2: Scrolling/viewport

**Files:**
- Create: `packages/prototype/src/scrolling.ts`
- Test: `packages/prototype/src/scrolling.test.ts`

---

## Phase 7: Presentation & Preview

### Task 7.1: Presentation mode (editor UI)

**Files:**
- Create: `packages/editor/src/components/Prototype/PrototypePresenter.tsx`
- Create: `packages/editor/src/components/Prototype/PrototypePlayer.tsx`
- Create: `packages/editor/src/components/Prototype/DeviceFrame.tsx`
- Create: `packages/editor/src/components/Prototype/prototype.css`
- Create: `packages/editor/src/components/Prototype/index.ts`
- Test: `packages/editor/src/components/Prototype/PrototypePresenter.test.tsx`

### Task 7.2: Shell integration

**Files:**
- Modify: `packages/editor/src/Shell.tsx`
- Modify: `packages/editor/src/Menubar.tsx`
- Modify: `packages/editor/src/context.tsx`

---

## Phase 8: UI Workflows

### Task 8.1: Prototype panel (inspector)

**Files:**
- Create: `packages/editor/src/components/Prototype/PrototypePanel.tsx`
- Create: `packages/editor/src/components/Prototype/InteractionEditor.tsx`
- Create: `packages/editor/src/components/Prototype/TransitionEditor.tsx`
- Test: `packages/editor/src/components/Prototype/PrototypePanel.test.tsx`

### Task 8.2: Flow view

**Files:**
- Create: `packages/editor/src/components/Prototype/FlowView.tsx`
- Test: `packages/editor/src/components/Prototype/FlowView.test.tsx`

---

## Phase 9: Debugging & Validation

### Task 9.1: Debug console

**Files:**
- Create: `packages/prototype/src/debug.ts`
- Create: `packages/editor/src/components/Prototype/PrototypeConsole.tsx`
- Test: `packages/prototype/src/debug.test.ts`

### Task 9.2: Validation

**Files:**
- Create: `packages/prototype/src/validation.ts`
- Test: `packages/prototype/src/validation.test.ts`

### Task 9.3: State inspector

**Files:**
- Create: `packages/editor/src/components/Prototype/StateInspector.tsx`

---

## Phase 10: Accessibility

### Task 10.1: Accessibility layer

**Files:**
- Create: `packages/prototype/src/accessibility.ts`
- Test: `packages/prototype/src/accessibility.test.ts`
- Modified: `PrototypePresenter.tsx` (ARIA, focus, reduced-motion)

---

## Phase 11: Integration & Stress Testing

### Task 11.1: Full integration tests

**Files:**
- Create: `packages/prototype/src/__tests__/integration.test.ts`

### Task 11.2: Stress/performance tests

**Files:**
- Create: `packages/prototype/src/__tests__/stress.test.ts`

---

## Phase 12: Verification & Documentation

### Task 12.1: Gate verification

### Task 12.2: Document update

**Files:**
- Modify: `packages/prototype/README.md`
- Modify: `AGENTS.md` (add prototype package info)
