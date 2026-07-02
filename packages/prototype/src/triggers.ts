/**
 * Trigger matching system — evaluates whether a prototype trigger fires
 * given a runtime event and the current prototype state.
 *
 * Research basis: Figma prototype trigger model, Framer event handlers,
 * W3C UI Events specification for pointer/keyboard/scroll event semantics.
 */

import type { PrototypeState, Trigger } from './types';

/**
 * Runtime event that can trigger prototype interactions.
 */
export type PrototypeEvent =
  | { type: 'click'; nodeId: string }
  | { type: 'tap'; nodeId: string }
  | { type: 'mouseenter'; nodeId: string }
  | { type: 'mouseleave'; nodeId: string }
  | {
      type: 'keydown';
      key: string;
      ctrlKey?: boolean;
      altKey?: boolean;
      shiftKey?: boolean;
      metaKey?: boolean;
    }
  | {
      type: 'keyup';
      key: string;
      ctrlKey?: boolean;
      altKey?: boolean;
      shiftKey?: boolean;
      metaKey?: boolean;
    }
  | { type: 'scroll'; nodeId: string; scrollDelta: { x: number; y: number } }
  | { type: 'drag'; nodeId: string; distance: number; direction: 'horizontal' | 'vertical' }
  | { type: 'focus'; nodeId: string }
  | { type: 'blur'; nodeId: string }
  | { type: 'timeout'; triggerKind: 'afterDelay' }
  | { type: 'variableChange'; variableId: string; newValue: string | number | boolean }
  | { type: 'mediaQuery'; query: string; matches: boolean }
  | { type: 'load'; nodeId: string };

/**
 * Check whether a trigger fires for the given event.
 */
export function matchTrigger(
  trigger: Trigger,
  event: PrototypeEvent,
  nodeId: string,
  _state: PrototypeState,
): boolean {
  switch (trigger.kind) {
    case 'onClick':
      return event.type === 'click' && event.nodeId === nodeId;
    case 'onTap':
      return event.type === 'tap' && event.nodeId === nodeId;
    case 'onHover':
    case 'onMouseEnter':
      return event.type === 'mouseenter' && event.nodeId === nodeId;
    case 'onHoverEnd':
    case 'onMouseLeave':
      return event.type === 'mouseleave' && event.nodeId === nodeId;
    case 'onDrag':
      if (event.type !== 'drag') return false;
      if (trigger.threshold !== undefined && event.distance < trigger.threshold) return false;
      if (trigger.direction && trigger.direction !== 'any' && event.direction !== trigger.direction)
        return false;
      return event.nodeId === nodeId;
    case 'onScroll':
      if (event.type !== 'scroll') return false;
      if (trigger.direction && trigger.direction !== 'any') {
        if (trigger.direction === 'up' && event.scrollDelta.y >= 0) return false;
        if (trigger.direction === 'down' && event.scrollDelta.y <= 0) return false;
        if (trigger.direction === 'left' && event.scrollDelta.x >= 0) return false;
        if (trigger.direction === 'right' && event.scrollDelta.x <= 0) return false;
      }
      return true;
    case 'onKeyPress':
      if (event.type !== 'keydown') return false;
      if (event.key !== trigger.key) return false;
      if (trigger.modifiers) {
        for (const mod of trigger.modifiers) {
          if (mod === 'ctrl' && !event.ctrlKey) return false;
          if (mod === 'alt' && !event.altKey) return false;
          if (mod === 'shift' && !event.shiftKey) return false;
          if (mod === 'meta' && !event.metaKey) return false;
        }
      }
      return true;
    case 'onFocus':
      return event.type === 'focus' && event.nodeId === nodeId;
    case 'afterDelay':
      return event.type === 'timeout';
    case 'onVariableChange':
      if (event.type !== 'variableChange') return false;
      if (trigger.variableId !== event.variableId) return false;
      if (trigger.equals !== undefined && trigger.equals !== event.newValue) return false;
      return true;
    case 'onMediaQuery':
      if (event.type !== 'mediaQuery') return false;
      return event.matches && event.query === trigger.query;
    case 'onLoad':
      return event.type === 'load';
    default:
      return false;
  }
}
