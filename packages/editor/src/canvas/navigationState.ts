/**
 * Navigation gesture state machine — the small, explicit model behind the
 * canvas's viewport-level gestures (wheel pan/zoom, touch pinch/pan, space-hand
 * pan). Tools own their own drag state; this machine owns the *navigation*
 * transitions so scattered booleans cannot form impossible combinations
 * (e.g. panning and pinching at once, or a pinch continuing after the gesture
 * was cancelled).
 *
 * States:
 * - idle        : no navigation gesture in progress
 * - wheel-pan   : plain wheel scrolling the viewport (momentum may follow)
 * - wheel-zoom  : ctrl/cmd+wheel zooming at the cursor
 * - touch-pan   : one-finger touch (route to tool, no viewport pan)
 * - touch-pinch : two-finger pan+zoom about the centroid
 * - space-hand  : Spacebar spring-loaded Hand tool pan
 *
 * All transitions are explicit. `pointercancel`, window blur, and Escape all
 * collapse any active gesture back to `idle`, so a lost pointer or key can
 * never leave the editor in a stuck navigation state.
 */
export type NavigationGestureState =
  | 'idle'
  | 'wheel-pan'
  | 'wheel-zoom'
  | 'touch-pan'
  | 'touch-pinch'
  | 'space-hand';

export type NavigationGestureEvent =
  | { type: 'wheel'; zoom: boolean }
  | { type: 'pointer-down'; pointerType: string; pointerCount: number }
  | { type: 'pointer-move'; pointerType: string; pointerCount: number }
  | { type: 'pointer-up'; pointerType: string; pointerCount: number }
  | { type: 'pointer-cancel' }
  | { type: 'space-down' }
  | { type: 'space-up' }
  | { type: 'blur' }
  | { type: 'reset' };

export interface NavigationStateTransition {
  next: NavigationGestureState;
  /** Whether the gesture that just ended should be treated as finished. */
  finished: boolean;
}

function touchStateFor(count: number): NavigationGestureState {
  return count >= 2 ? 'touch-pinch' : 'touch-pan';
}

/**
 * Advance the navigation state machine. Pure and synchronous — the pipeline
 * calls it on every relevant event and dispatches the resulting state.
 */
export function transitionNavigationState(
  state: NavigationGestureState,
  event: NavigationGestureEvent,
): NavigationStateTransition {
  switch (event.type) {
    case 'wheel':
      return {
        next: event.zoom ? 'wheel-zoom' : 'wheel-pan',
        finished: false,
      };
    case 'pointer-down':
      if (event.pointerType !== 'touch') return { next: state, finished: false };
      return { next: touchStateFor(event.pointerCount), finished: false };
    case 'pointer-move':
      if (event.pointerType !== 'touch') return { next: state, finished: false };
      if (state === 'touch-pan' && event.pointerCount >= 2) {
        return { next: 'touch-pinch', finished: false };
      }
      if (state === 'touch-pinch' && event.pointerCount < 2) {
        return { next: 'touch-pan', finished: true };
      }
      return { next: state, finished: false };
    case 'pointer-up':
      if (event.pointerType !== 'touch') return { next: state, finished: false };
      if (event.pointerCount < 2 && (state === 'touch-pinch' || state === 'touch-pan')) {
        return { next: event.pointerCount === 0 ? 'idle' : 'touch-pan', finished: true };
      }
      return { next: state, finished: false };
    case 'pointer-cancel':
    case 'blur':
    case 'reset':
      return { next: 'idle', finished: state !== 'idle' };
    case 'space-down':
      return { next: 'space-hand', finished: false };
    case 'space-up':
      return { next: 'idle', finished: state === 'space-hand' };
    default:
      return { next: state, finished: false };
  }
}
