export type BootState = 'init' | 'home_ready' | 'editor_ready' | 'error';

export interface BootManagerOptions {
  onStateChange?: (prev: BootState, next: BootState) => void;
}

export interface BootManager {
  state(): BootState;
  markHomeReady(): void;
  markEditorReady(): void;
  markError(error: Error): void;
  error(): Error | null;
  isStartupComplete(): boolean;
}

const VALID_TRANSITIONS: Record<BootState, BootState[]> = {
  init: ['home_ready', 'error'],
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
    error: () => _error,
    isStartupComplete: () => _state === 'editor_ready',
  };
}
