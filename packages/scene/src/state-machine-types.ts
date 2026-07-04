import type { EasingDefinition } from '@strata/shared';

export type SMInputType = 'boolean' | 'number' | 'trigger';
export type SMTransitionTrigger =
  | 'onClick'
  | 'onHover'
  | 'onKeyPress'
  | 'onVariableChange'
  | 'onTimelineEnd';

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
}

export interface SMState {
  id: string;
  name: string;
  timelineId: string;
  isEntryState?: boolean;
}

export interface StateMachine {
  id: string;
  name: string;
  states: SMState[];
  transitions: SMTransition[];
  inputs: SMInput[];
}
