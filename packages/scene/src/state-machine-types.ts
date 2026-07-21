import type { EasingDefinition } from '@strata/shared';

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
  targetId?: string;
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
  priority?: number;
  canInterrupt?: boolean;
  actions?: SMAction[];
}

export interface SMState {
  id: string;
  name: string;
  timelineId: string;
  isEntryState?: boolean;
  entryActions?: SMAction[];
  exitActions?: SMAction[];
}

export interface StateMachine {
  id: string;
  name: string;
  states: SMState[];
  transitions: SMTransition[];
  inputs: SMInput[];
}
