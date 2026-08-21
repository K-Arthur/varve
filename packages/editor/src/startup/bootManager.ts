export type BootState = 'init' | 'home_ready' | 'editor_ready' | 'error';

export interface BootManagerOptions {
  onStateChange?: (prev: BootState, next: BootState) => void;
}

export interface BootManager {
  state(): BootState;
  markHomeReady(): void;
  markEditorReady(): void;
  markError(error: Error): void;
  /** Return to init after a fatal error so startup can be retried. */
  reset(): void;
  error(): Error | null;
  isStartupComplete(): boolean;
}

const VALID_TRANSITIONS: Record<BootState, BootState[]> = {
  // `init -> editor_ready` is permitted because a boot can legitimately reach
  // the editor without Home ever becoming interactive: the browser demo opens
  // its sample document directly and never shows Home at all. Requiring
  // home_ready first meant markEditorReady() was silently dropped — transition()
  // ignores a disallowed move — so bootState stayed 'init' and the branded
  // startup loader covered a fully mounted editor forever. Chromium happened to
  // fire home_interactive anyway and hid the bug; WebKit did not, so Safari
  // visitors got a permanent loading screen.
  init: ['home_ready', 'editor_ready', 'error'],
  home_ready: ['editor_ready', 'error'],
  editor_ready: [],
  error: [],
};

export function createBootManager(opts?: BootManagerOptions): BootManager {
  let _state: BootState = 'init';
  let _error: Error | null = null;

  function transition(next: BootState) {
    const allowed = VALID_TRANSITIONS[_state];
    if (!allowed.includes(next)) return;
    const prev = _state;
    _state = next;
    opts?.onStateChange?.(prev, next);
  }

  return {
    state: () => _state,
    markHomeReady: () => transition('home_ready'),
    markEditorReady: () => transition('editor_ready'),
    markError: (err: Error) => {
      _error = err;
      transition('error');
    },
    reset: () => {
      const prev = _state;
      _state = 'init';
      _error = null;
      if (prev !== 'init') {
        opts?.onStateChange?.(prev, 'init');
      }
    },
    error: () => _error,
    isStartupComplete: () => _state === 'editor_ready',
  };
}
