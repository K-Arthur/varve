import type { EasingDefinition } from '@varve/shared';

export type SMInputType = 'boolean' | 'number' | 'trigger';
export type SMTransitionTrigger =
  | 'onClick'
  | 'onHover'
  | 'onPointerDown'
  | 'onPointerUp'
  | 'onKeyPress'
  | 'onTimer'
  | 'onDragEnd'
  | 'onVariableChange'
  | 'onTimelineEnd'
  | 'onMediaEvent';

export type SMActionKind =
  | 'setVariable'
  | 'navigateTo'
  | 'openOverlay'
  | 'closeOverlay'
  | 'playTimeline'
  | 'pauseTimeline'
  | 'seekTimeline'
  | 'custom';

export interface SMAction {
  id: string;
  kind: SMActionKind;
  /** Target variable id for setVariable, target screen id for navigateTo, etc. */
  targetId?: string;
  /** Value for setVariable, time in ms for seekTimeline, JS expression for custom. */
  value?: string | number | boolean;
}

export interface SMInput {
  id: string;
  name: string;
  type: SMInputType;
  defaultValue?: boolean | number;
}

export interface SMTransition {
  id: string;
  fromStateId: string;
  toStateId: string;
  trigger: SMTransitionTrigger;
  condition?: string;
  duration?: number;
  easing?: EasingDefinition;
  /** Priority when multiple transitions match (higher wins). Default 0. */
  priority?: number;
  /** Whether this transition can interrupt an active transition. Default true. */
  canInterrupt?: boolean;
  /** Actions fired when this transition fires. */
  actions?: SMAction[];
}

export interface SMState {
  id: string;
  name: string;
  timelineId: string;
  isEntryState?: boolean;
  /** Actions fired when entering this state. */
  entryActions?: SMAction[];
  /** Actions fired when exiting this state. */
  exitActions?: SMAction[];
}

export interface StateMachine {
  id: string;
  name: string;
  states: SMState[];
  transitions: SMTransition[];
  inputs: SMInput[];
}
