import { describe, it, expect } from 'vitest';
import type {
  TriggerKind,
  ActionKind,
  TransitionKind,
  EasingKind,
  ComparisonOperator,
  LogicalOperator,
} from './types';

describe('Prototype type system', () => {
  it('includes all standard trigger kinds', () => {
    const triggers: TriggerKind[] = [
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
    expect(triggers).toContain('onClick');
    expect(triggers).toContain('onHover');
    expect(triggers).toContain('onDrag');
    expect(triggers).toContain('onKeyPress');
    expect(triggers).toContain('afterDelay');
    expect(triggers).toContain('onVariableChange');
    expect(triggers).toContain('onMediaQuery');
    expect(triggers).toContain('onScroll');
    expect(triggers).toContain('onLoad');
  });

  it('includes all standard action kinds', () => {
    const actions: ActionKind[] = [
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
    expect(actions).toContain('navigateTo');
    expect(actions).toContain('openOverlay');
    expect(actions).toContain('closeOverlay');
    expect(actions).toContain('setVariable');
    expect(actions).toContain('scrollTo');
    expect(actions).toContain('goBack');
  });

  it('includes all standard transition kinds', () => {
    const transitions: TransitionKind[] = [
      'instant',
      'dissolve',
      'slide',
      'push',
      'moveIn',
      'moveOut',
      'smartAnimate',
    ];
    expect(transitions).toContain('instant');
    expect(transitions).toContain('dissolve');
    expect(transitions).toContain('smartAnimate');
  });

  it('includes all easing kinds', () => {
    const easings: EasingKind[] = [
      'linear',
      'ease',
      'easeIn',
      'easeOut',
      'easeInOut',
      'cubicBezier',
      'spring',
      'steps',
    ];
    expect(easings).toContain('spring');
    expect(easings).toContain('cubicBezier');
    expect(easings).toContain('steps');
  });

  it('includes comparison operators', () => {
    const ops: ComparisonOperator[] = [
      'equals',
      'notEquals',
      'greaterThan',
      'lessThan',
      'greaterThanOrEqual',
      'lessThanOrEqual',
      'contains',
      'startsWith',
      'endsWith',
    ];
    expect(ops).toContain('equals');
    expect(ops).toContain('greaterThan');
    expect(ops).toContain('contains');
  });

  it('includes logical operators', () => {
    const ops: LogicalOperator[] = ['and', 'or', 'not'];
    expect(ops).toContain('and');
    expect(ops).toContain('or');
    expect(ops).toContain('not');
  });
});
