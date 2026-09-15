/**
 * Trigger matching system — evaluates whether a prototype trigger fires
 * given a runtime event and the current prototype state.
 *
 * Research basis: Figma prototype trigger model, Framer event handlers,
 * W3C UI Events specification for pointer/keyboard/scroll event semantics.
 */

import type { PrototypeState, Trigger } from './types';

/**
 * Tracks the last time each trigger was matched for debounce.
 */
const _lastTriggeredAt = new WeakMap<Trigger, number>();

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
  const now = Date.now();
  if (trigger.debounce !== undefined && trigger.debounce > 0) {
    const lastTime = _lastTriggeredAt.get(trigger);
    if (lastTime !== undefined && now - lastTime < trigger.debounce) {
      return false;
    }
  }

  let matched = false;

  switch (trigger.kind) {
    case 'onClick':
      matched = event.type === 'click' && event.nodeId === nodeId;
      break;
    case 'onTap':
      matched = event.type === 'tap' && event.nodeId === nodeId;
      break;
    case 'onHover':
    case 'onMouseEnter':
      matched = event.type === 'mouseenter' && event.nodeId === nodeId;
      break;
    case 'onHoverEnd':
    case 'onMouseLeave':
      matched = event.type === 'mouseleave' && event.nodeId === nodeId;
      break;
    case 'onDrag':
      if (event.type !== 'drag') {
        matched = false;
        break;
      }
      if (trigger.threshold !== undefined && event.distance < trigger.threshold) {
        matched = false;
        break;
      }
      if (
        trigger.direction &&
        trigger.direction !== 'any' &&
        event.direction !== trigger.direction
      ) {
        matched = false;
        break;
      }
      matched = event.nodeId === nodeId;
      break;
    case 'onScroll':
      if (event.type !== 'scroll') {
        matched = false;
        break;
      }
      if (trigger.direction && trigger.direction !== 'any') {
        if (trigger.direction === 'up' && event.scrollDelta.y >= 0) {
          matched = false;
          break;
        }
        if (trigger.direction === 'down' && event.scrollDelta.y <= 0) {
          matched = false;
          break;
        }
        if (trigger.direction === 'left' && event.scrollDelta.x >= 0) {
          matched = false;
          break;
        }
        if (trigger.direction === 'right' && event.scrollDelta.x <= 0) {
          matched = false;
          break;
        }
      }
      matched = true;
      break;
    case 'onKeyPress':
      if (event.type !== 'keydown') {
        matched = false;
        break;
      }
      if (event.key !== trigger.key) {
        matched = false;
        break;
      }
      if (trigger.modifiers) {
        let modsOk = true;
        for (const mod of trigger.modifiers) {
          if (mod === 'ctrl' && !event.ctrlKey) {
            modsOk = false;
            break;
          }
          if (mod === 'alt' && !event.altKey) {
            modsOk = false;
            break;
          }
          if (mod === 'shift' && !event.shiftKey) {
            modsOk = false;
            break;
          }
          if (mod === 'meta' && !event.metaKey) {
            modsOk = false;
            break;
          }
        }
        if (!modsOk) {
          matched = false;
          break;
        }
      }
      matched = true;
      break;
    case 'onFocus':
      matched = event.type === 'focus' && event.nodeId === nodeId;
      break;
    case 'afterDelay':
      matched = event.type === 'timeout';
      break;
    case 'onVariableChange':
      if (event.type !== 'variableChange') {
        matched = false;
        break;
      }
      if (trigger.variableId !== event.variableId) {
        matched = false;
        break;
      }
      if (trigger.equals !== undefined && trigger.equals !== event.newValue) {
        matched = false;
        break;
      }
      matched = true;
      break;
    case 'onMediaQuery':
      if (event.type !== 'mediaQuery') {
        matched = false;
        break;
      }
      matched = event.matches && event.query === trigger.query;
      break;
    case 'onLoad':
      matched = event.type === 'load';
      break;
    default:
      matched = false;
      break;
  }

  if (matched && trigger.debounce !== undefined && trigger.debounce > 0) {
    _lastTriggeredAt.set(trigger, now);
  }

  return matched;
}
