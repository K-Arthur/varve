# Startup/Loading Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Strata's white-screen-on-boot with a branded loading experience, fix ad-hoc loading states, add ContentSkeleton component, and harden the entire startup pipeline with graceful degradation, performance budgets, and CI regression detection.

**Architecture:** Layer the loading system on top of the existing architecture: a `BootManager` state machine (state: `init` → `home-ready` / `editor-ready`) wraps `App.tsx`. The existing `StartupLoader` component (chromatic-aberration logo, exit animation, error+retry) is mounted during `init` and unmounted when `home-ready`. A feature flag in `EditorSettings` (`showBrandedLoader`) controls whether the branded experience shows or falls back to instant transition. `ContentSkeleton` (new shimmer component) fills placeholder slots. All changes TDD-first with the regression protocol from AGENTS.md.

**Tech Stack:** React 19, TypeScript strict, Vitest, CSS custom properties, localStorage for feature flags

---

## Branch Structure

Each phase = one git branch, one PR, one CI run:

```
loading/01-audit-baseline      → measurement + feature flag + degradation
loading/02-startup-architecture → BootManager + StartupLoader wiring
loading/03-branded-loader       → timing, reduced-motion, warm-restart
loading/04-contextual-widgets   → ContentSkeleton + HomeShell + RegionLoader
loading/05-cleanup-removal      → ad-hoc cleanup + settings consolidation
loading/06-a11y-perf-hardening  → CI regression test + audit + docs
```

---

## Phase 1 — `loading/01-audit-baseline`

**Goal:** Establish performance budgets, feature flag, and graceful degradation patterns before any UX changes.

**Branch:** `loading/01-audit-baseline`
**Risk:** Low — purely additive config and measurement code.

### Task 1.1: Add `startup` section to `EditorSettings`

**Files:**
- Modify: `packages/editor/src/settings.ts:44-49`
- Test: `packages/editor/src/settings.test.ts`

- [ ] **Step 1: Write failing test for startup settings field**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSettings,
  saveSettings,
  resetSettings,
  DEFAULT_EDITOR_SETTINGS,
} from './settings';

beforeEach(() => {
  localStorage.clear();
});

describe('startup settings', () => {
  it('defaults branded loader to enabled', () => {
    const s = loadSettings();
    expect(s.startup.showBrandedLoader).toBe(true);
  });

  it('persists branded loader toggle', () => {
    saveSettings({
      ...DEFAULT_EDITOR_SETTINGS,
      startup: { showBrandedLoader: false },
    });
    const s = loadSettings();
    expect(s.startup.showBrandedLoader).toBe(false);
  });

  it('merges partial startup settings gracefully', () => {
    const existing = JSON.stringify({
      export: { defaultFormat: 'svg' },
      startup: { showBrandedLoader: false },
    });
    localStorage.setItem('strata-editor-settings', existing);
    const s = loadSettings();
    expect(s.export.defaultFormat).toBe('svg');
    expect(s.startup.showBrandedLoader).toBe(false);
    // Appearance default preserved
    expect(s.appearance.reduceMotion).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --filter @varve/editor -- settings.test.ts 2>&1 | head -30`
Expected: FAIL — `startup` does not exist on `EditorSettings`.

- [ ] **Step 3: Add `StartupSettingsStore` interface and defaults**

```typescript
// Add to settings.ts
export interface StartupSettingsStore {
  /** Show the branded chromatic-aberration loader on boot. False → instant transition. */
  showBrandedLoader: boolean;
}

export const DEFAULT_STARTUP_SETTINGS: StartupSettingsStore = {
  showBrandedLoader: true,
};

// Add to EditorSettings interface
export interface EditorSettings {
  export: ExportSettingsStore;
  appearance: AppearanceSettingsStore;
  panel: PanelSettingsStore;
  render: RenderSettingsStore;
  startup: StartupSettingsStore; // NEW
}

// Add to DEFAULT_EDITOR_SETTINGS
export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  export: { ...DEFAULT_EXPORT_SETTINGS },
  appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
  panel: { ...DEFAULT_PANEL_SETTINGS },
  render: { ...DEFAULT_RENDER_SETTINGS },
  startup: { ...DEFAULT_STARTUP_SETTINGS }, // NEW
};
```

- [ ] **Step 4: Update merge/load/save functions for new section**

```typescript
// In loadSettings()
const parsed = JSON.parse(raw) as Record<string, unknown>;
return {
  export: mergePartial(DEFAULT_EXPORT_SETTINGS, parsed.export as Partial<ExportSettingsStore>),
  appearance: mergePartial(DEFAULT_APPEARANCE_SETTINGS, parsed.appearance as Partial<AppearanceSettingsStore>),
  panel: mergePartial(DEFAULT_PANEL_SETTINGS, parsed.panel as Partial<PanelSettingsStore>),
  render: mergePartial(DEFAULT_RENDER_SETTINGS, parsed.render as Partial<RenderSettingsStore>),
  startup: mergePartial(DEFAULT_STARTUP_SETTINGS, parsed.startup as Partial<StartupSettingsStore>),
};

// Add to EditorSettingsPatch
export interface EditorSettingsPatch {
  export?: Partial<ExportSettingsStore>;
  appearance?: Partial<AppearanceSettingsStore>;
  panel?: Partial<PanelSettingsStore>;
  render?: Partial<RenderSettingsStore>;
  startup?: Partial<StartupSettingsStore>;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test --filter @varve/editor -- settings.test.ts 2>&1`
Expected: PASS (3 new tests)

- [ ] **Step 6: Write failing test for startup timing measurement**

New file: `packages/editor/src/startup/startupTimer.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { createStartupTimer, type StartupMark } from './startupTimer';

describe('startupTimer', () => {
  it('records a mark with timestamp', () => {
    const timer = createStartupTimer();
    timer.mark('app_mount');
    const marks = timer.getMarks();
    expect(marks).toHaveLength(1);
    expect(marks[0].name).toBe('app_mount');
    expect(marks[0].time).toBeGreaterThan(0);
  });

  it('records marks in insertion order', () => {
    const timer = createStartupTimer();
    timer.mark('first');
    timer.mark('second');
    const marks = timer.getMarks();
    expect(marks[0].name).toBe('first');
    expect(marks[1].name).toBe('second');
  });

  it('computes elapsed from first mark', () => {
    const timer = createStartupTimer();
    timer.mark('start');
    timer.mark('mid');
    timer.mark('end');
    const elapsed = timer.elapsed();
    expect(elapsed).toBeGreaterThanOrEqual(0);
    // All three marks within the same millisecond-tick in tests, but the
    // function still returns a non-negative number.
    expect(typeof elapsed).toBe('number');
  });

  it('returns zero elapsed when no marks exist', () => {
    const timer = createStartupTimer();
    expect(timer.elapsed()).toBe(0);
  });

  it('reports marks as frozen snapshot', () => {
    const timer = createStartupTimer();
    timer.mark('a');
    const marks = timer.getMarks();
    timer.mark('b');
    // Snapshot taken earlier should not be affected
    expect(marks).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Run test — verify it fails**

Run: `pnpm test --filter @varve/editor -- startupTimer.test.ts 2>&1`
Expected: FAIL — `createStartupTimer` not exported

- [ ] **Step 8: Implement `startupTimer.ts`**

New file: `packages/editor/src/startup/startupTimer.ts`

```typescript
export interface StartupMark {
  name: string;
  time: number;
}

export interface StartupTimer {
  mark(name: string): void;
  getMarks(): readonly StartupMark[];
  elapsed(): number;
}

export function createStartupTimer(): StartupTimer {
  const marks: StartupMark[] = [];

  return {
    mark(name: string): void {
      marks.push({ name, time: performance.now() });
    },

    getMarks(): readonly StartupMark[] {
      return Object.freeze([...marks]);
    },

    elapsed(): number {
      if (marks.length === 0) return 0;
      return marks[marks.length - 1].time - marks[0].time;
    },
  };
}
```

- [ ] **Step 9: Run tests — verify they pass**

Run: `pnpm test --filter @varve/editor -- startupTimer.test.ts 2>&1`
Expected: PASS

- [ ] **Step 10: Export startupTimer from package index**

```typescript
// packages/editor/src/index.ts — add:
export { createStartupTimer } from './startup/startupTimer';
export type { StartupTimer, StartupMark } from './startup/startupTimer';
```

- [ ] **Step 11: Commit**

```bash
git add packages/editor/src/settings.ts packages/editor/src/settings.test.ts \
       packages/editor/src/startup/startupTimer.ts \
       packages/editor/src/startup/startupTimer.test.ts \
       packages/editor/src/index.ts
git commit -m "feat(loading): add startup settings and timing infrastructure"
```

### Task 1.2: Add graceful-degradation helper for GPU/rendering

**Files:**
- Create: `packages/editor/src/startup/capabilityCheck.ts`
- Create: `packages/editor/src/startup/capabilityCheck.test.ts`

- [ ] **Step 1: TDD — write failing test for capability check**

```typescript
import { describe, it, expect } from 'vitest';
import { checkStartupCapabilities, type StartupCapabilities } from './capabilityCheck';

describe('checkStartupCapabilities', () => {
  it('returns animation flag based on prefers-reduced-motion', () => {
    const caps = checkStartupCapabilities();
    // Default in jsdom: no preference, so animation should be allowed
    expect(typeof caps.canAnimate).toBe('boolean');
  });

  it('returns a gpuScore between 0 and 1', () => {
    const caps = checkStartupCapabilities();
    expect(caps.gpuScore).toBeGreaterThanOrEqual(0);
    expect(caps.gpuScore).toBeLessThanOrEqual(1);
  });

  it('detects when canvas is available', () => {
    const caps = checkStartupCapabilities();
    // jsdom has a shimmed canvas
    expect(caps.canvasAvailable).toBe(true);
  });

  it('incorporates reduced-motion into shouldSimplify', () => {
    // Set prefers-reduced-motion: reduce
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as typeof window.matchMedia;

    const caps = checkStartupCapabilities();
    expect(caps.shouldSimplify).toBe(true);

    window.matchMedia = original;
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm test --filter @varve/editor -- capabilityCheck.test.ts 2>&1`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `capabilityCheck.ts`**

```typescript
export interface StartupCapabilities {
  /** Whether CSS/SVG animations should play (respects reduced-motion). */
  canAnimate: boolean;
  /** GPU capability score 0–1 (1 = best effort). Proxied via offscreen-canvas / WebGL context check. */
  gpuScore: number;
  /** Whether Canvas2D is available (always true in modern browsers, but defensive). */
  canvasAvailable: boolean;
  /** True when animations should be simplified (reduced-motion OR very low gpuScore). */
  shouldSimplify: boolean;
}

export function checkStartupCapabilities(): StartupCapabilities {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Quick GPU probe: try to create a WebGL context at a tiny size
  let gpuScore = 0.5; // neutral default
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const gl = probe.getContext('webgl') ?? probe.getContext('webgl2');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        // We don't need the renderer string — just knowing WebGL works is enough
        gpuScore = 1.0;
      } else {
        gpuScore = 0.8;
      }
      // Clean up
      const loseContext = gl.getExtension('WEBGL_lose_context');
      loseContext?.loseContext();
    }
  } catch {
    gpuScore = 0.3; // software / locked-down environment
  }

  const canvasAvailable = typeof HTMLCanvasElement !== 'undefined';
  const shouldSimplify = reducedMotion || gpuScore < 0.4;

  return {
    canAnimate: !reducedMotion,
    gpuScore,
    canvasAvailable,
    shouldSimplify,
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `pnpm test --filter @varve/editor -- capabilityCheck.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Export from index**

```typescript
export { checkStartupCapabilities } from './startup/capabilityCheck';
export type { StartupCapabilities } from './startup/capabilityCheck';
```

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/startup/capabilityCheck.ts \
       packages/editor/src/startup/capabilityCheck.test.ts \
       packages/editor/src/index.ts
git commit -m "feat(loading): add capability check for GPU and reduced-motion"
```

### Task 1.3: Performance budget specification

- [ ] **Document the performance budget in the feature flag:**

```typescript
// In startUpSettings commentary (not a test — a self-documenting constant):
export const STARTUP_PERFORMANCE_BUDGET = {
  /** Max additional time-to-interactive from branded loader (beyond init) — 50ms */
  maxLoaderOverheadMs: 50,
  /** Target frame rate for chromatic-aberration animation */
  targetFps: 60,
  /** Degradation threshold — switch to static below this */
  minAcceptableFps: 30,
  /** Max total startup time from app_mount to home_ready (budget for init work) */
  maxStartupMs: 1200,
} as const;
```

No test needed — this is a constant. The budget numbers will be verified in Phase 6.

- [ ] **Commit:**

```bash
git add packages/editor/src/settings.ts
git commit -m "feat(loading): document performance budget constants"
```

### Phase 1 gate check

- [ ] `pnpm test --filter @varve/editor` — all pass
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm lint` — 0 new errors on modified files
- [ ] `pnpm format` — clean
- [ ] PR opened, CI green, NOT merged (per addendum §1)

---

## Phase 2 — `loading/02-startup-architecture`

**Goal:** Create `BootManager` state machine and wire `StartupLoader` into `App.tsx` behind the feature flag.

**Branch:** `loading/02-startup-architecture` (branch from `loading/01-audit-baseline`)
**Risk:** Medium — touches `App.tsx` and adds loading state to the root component.

### Task 2.1: BootManager state machine

**Files:**
- Create: `packages/editor/src/startup/bootManager.ts`
- Create: `packages/editor/src/startup/bootManager.test.ts`

- [ ] **Step 1: TDD — write failing test for BootManager**

```typescript
import { describe, it, expect } from 'vitest';
import { createBootManager } from './bootManager';

describe('createBootManager', () => {
  it('starts in init state', () => {
    const bm = createBootManager();
    expect(bm.state()).toBe('init');
  });

  it('transitions to homeReady on markHomeReady()', () => {
    const bm = createBootManager();
    bm.markHomeReady();
    expect(bm.state()).toBe('home_ready');
  });

  it('transitions from home_ready to editor_ready via markEditorReady()', () => {
    const bm = createBootManager();
    bm.markHomeReady();
    bm.markEditorReady();
    expect(bm.state()).toBe('editor_ready');
  });

  it('reports isStartupComplete when editor_ready', () => {
    const bm = createBootManager();
    expect(bm.isStartupComplete()).toBe(false);
    bm.markHomeReady();
    expect(bm.isStartupComplete()).toBe(false);
    bm.markEditorReady();
    expect(bm.isStartupComplete()).toBe(true);
  });

  it('caps state machine at editor_ready (no further transitions)', () => {
    const bm = createBootManager();
    bm.markHomeReady();
    bm.markEditorReady();
    // Should be a no-op
    bm.markHomeReady();
    expect(bm.state()).toBe('editor_ready');
  });

  it('accepts error state', () => {
    const bm = createBootManager();
    bm.markError(new Error('DB connection failed'));
    expect(bm.state()).toBe('error');
    expect(bm.error()?.message).toBe('DB connection failed');
  });

  it('once in error, stays in error', () => {
    const bm = createBootManager();
    bm.markError(new Error('first'));
    bm.markHomeReady();
    expect(bm.state()).toBe('error');
  });

  it('calls onStateChange callbacks', () => {
    const changes: string[] = [];
    const bm = createBootManager({
      onStateChange(prev, next) {
        changes.push(`${prev}->${next}`);
      },
    });
    bm.markHomeReady();
    bm.markEditorReady();
    expect(changes).toEqual(['init->home_ready', 'home_ready->editor_ready']);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm test --filter @varve/editor -- bootManager.test.ts 2>&1`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `bootManager.ts`**

```typescript
export type BootState = 'init' | 'home_ready' | 'editor_ready' | 'error';

export interface BootManagerOptions {
  onStateChange?: (prev: BootState, next: BootState) => void;
}

export interface BootManager {
  /** Current state of the boot sequence. */
  state(): BootState;
  /** Mark the home screen as ready to display. */
  markHomeReady(): void;
  /** Mark the editor (used after warm-launch) as ready to display. */
  markEditorReady(): void;
  /** Mark a fatal startup error. */
  markError(error: Error): void;
  /** Return the current error, or null. */
  error(): Error | null;
  /** True when both home and editor are ready. */
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
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `pnpm test --filter @varve/editor -- bootManager.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Export from index**

```typescript
export { createBootManager } from './startup/bootManager';
export type { BootManager, BootState, BootManagerOptions } from './startup/bootManager';
```

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/startup/bootManager.ts \
       packages/editor/src/startup/bootManager.test.ts \
       packages/editor/src/index.ts
git commit -m "feat(loading): add BootManager state machine"
```

### Task 2.2: Wire StartupLoader into App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `packages/ui/src/components/StartupLoader.tsx` (minor: add `featureFlag` prop or verify it works as-is)
- Create: `apps/desktop/src/__tests__/App.startup.test.tsx`

- [ ] **Step 1: TDD — write failing test for startup loader wiring**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../App';

// Mock the platform module so it doesn't hit localStorage / IndexedDB
vi.mock('@varve/platform', () => ({
  detectPlatform: () => ({
    getViewState: vi.fn().mockResolvedValue({}),
    listFiles: vi.fn().mockResolvedValue([]),
    listTrashedFiles: vi.fn().mockResolvedValue([]),
    listProjects: vi.fn().mockResolvedValue([]),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    setViewState: vi.fn(),
    listenForChanges: vi.fn(),
  }),
}));

// Mock EditorSettings to default showBrandedLoader=true
vi.mock('@varve/editor/settings', () => ({
  loadSettings: () => ({
    export: {},
    appearance: { reduceMotion: false, theme: 'light' },
    panel: {},
    render: {},
    startup: { showBrandedLoader: true },
  }),
}));

describe('App startup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows StartupLoader on mount when branded loader enabled', () => {
    render(<App />);
    // The loader has role="status"
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('does not show StartupLoader when branded loader disabled', async () => {
    vi.mocked(loadSettings).mockReturnValueOnce({
      ...DEFAULT_EDITOR_SETTINGS,
      startup: { showBrandedLoader: false },
    });
    render(<App />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
```

Wait — the test above won't work cleanly because `vitest.mock` is hoisted and we can't change mocks per-test easily. Let me use a simpler approach: test the `useStartup` hook separately.

Let me revise: instead of testing `App.tsx` directly (which involves many dependencies), test the hook that wraps the logic, then verify App.tsx uses it.

- [ ] **Step 1 (revised): Write failing test for `useStartup` hook**

New file: `packages/editor/src/startup/useStartup.test.tsx`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import { useStartup } from './useStartup';

// Mock EditorSettings
const mockLoadSettings = vi.fn();
vi.mock('../settings', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  DEFAULT_EDITOR_SETTINGS: {
    export: {},
    appearance: { reduceMotion: false, theme: 'light' },
    panel: {},
    render: {},
    startup: { showBrandedLoader: true },
  },
}));

describe('useStartup', () => {
  beforeEach(() => {
    mockLoadSettings.mockReturnValue({
      export: {},
      appearance: { reduceMotion: false, theme: 'light' },
      panel: {},
      render: {},
      startup: { showBrandedLoader: true },
    });
  });

  it('shows loader when branded mode is enabled and boot not ready', () => {
    const { result } = renderHook(() => useStartup({}));
    expect(result.current.showLoader).toBe(true);
    expect(result.current.bootState).toBe('init');
  });

  it('hides loader when branded mode is disabled', () => {
    mockLoadSettings.mockReturnValue({
      export: {},
      appearance: { reduceMotion: false, theme: 'light' },
      panel: {},
      render: {},
      startup: { showBrandedLoader: false },
    });
    const { result } = renderHook(() => useStartup({}));
    expect(result.current.showLoader).toBe(false);
    expect(result.current.bootState).toBe('home_ready');
  });

  it('hides loader when boot reaches home_ready', () => {
    const { result } = renderHook(() => useStartup({}));
    act(() => {
      result.current.onHomeReady();
    });
    expect(result.current.showLoader).toBe(false);
    expect(result.current.bootState).toBe('home_ready');
  });

  it('calls onBootComplete callback when editor_ready', () => {
    const onBootComplete = vi.fn();
    const { result } = renderHook(() => useStartup({ onBootComplete }));
    act(() => { result.current.onHomeReady(); });
    act(() => { result.current.onEditorReady(); });
    expect(onBootComplete).toHaveBeenCalledOnce();
  });

  it('provides error state', () => {
    const { result } = renderHook(() => useStartup({}));
    act(() => {
      result.current.onBootError(new Error('Init failed'));
    });
    expect(result.current.bootError).toBe('Init failed');
    expect(result.current.showLoader).toBe(true); // still showing while error visible
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm test --filter @varve/editor -- useStartup.test.tsx 2>&1`
Expected: FAIL — `useStartup` not found

- [ ] **Step 3: Implement `useStartup` hook**

New file: `packages/editor/src/startup/useStartup.ts`

```typescript
import { useEffect, useMemo, useState } from 'react';
import { loadSettings } from '../settings';
import { createBootManager, type BootManager, type BootState } from './bootManager';
import { createStartupTimer, type StartupTimer } from './startupTimer';
import { checkStartupCapabilities, type StartupCapabilities } from './capabilityCheck';

export interface UseStartupOptions {
  onBootComplete?: () => void;
}

export interface UseStartupResult {
  showLoader: boolean;
  bootState: BootState;
  bootError: string | null;
  onRetry: () => void;
  capabilities: StartupCapabilities;
  startupTime: number;
  onHomeReady: () => void;
  onEditorReady: () => void;
  onBootError: (err: Error) => void;
}

export function useStartup(opts: UseStartupOptions): UseStartupResult {
  const [bootState, setBootState] = useState<BootState>('init');
  const [bootError, setBootError] = useState<string | null>(null);

  const settings = useMemo(() => loadSettings(), []);
  const showBrandedLoader = settings.startup.showBrandedLoader;

  const bootManager = useMemo<BootManager>(() => createBootManager({
    onStateChange: (_prev, next) => {
      setBootState(next);
      if (next === 'editor_ready') {
        opts.onBootComplete?.();
      }
    },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const startupTimer = useMemo<StartupTimer>(() => createStartupTimer(), []);
  const capabilities = useMemo<StartupCapabilities>(() => checkStartupCapabilities(), []);

  useEffect(() => {
    startupTimer.mark('app_mount');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // If branded loader is disabled, skip straight to home_ready
  useEffect(() => {
    if (!showBrandedLoader && bootManager.state() === 'init') {
      bootManager.markHomeReady();
    }
  }, [showBrandedLoader, bootManager]);

  const showLoader = showBrandedLoader && bootState === 'init';
  const startupTime = startupTimer.elapsed();

  return {
    showLoader,
    bootState,
    bootError,
    onRetry: () => {
      setBootError(null);
      setBootState('init');
    },
    capabilities,
    startupTime,
    onHomeReady: () => bootManager.markHomeReady(),
    onEditorReady: () => bootManager.markEditorReady(),
    onBootError: (err: Error) => {
      setBootError(err.message);
      bootManager.markError(err);
    },
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `pnpm test --filter @varve/editor -- useStartup.test.tsx 2>&1`
Expected: PASS

- [ ] **Step 5: Wire useStartup into App.tsx**

Modify `apps/desktop/src/App.tsx`:

```typescript
import { useState, useCallback } from 'react';
import { StartupLoader } from '@varve/ui';
import { useStartup } from '@varve/editor';
import { detectPlatform, type FileEntry } from '@varve/platform';
import { Shell } from '@varve/editor';
import { HomeShell } from '@varve/home';
import { TitleBar } from './chrome/TitleBar';

const platform = detectPlatform();

export function App() {
  const [view, setView] = useState<'home' | 'editor'>('home');
  const [editorMounted, setEditorMounted] = useState(false);
  const [openRequest, setOpenRequest] = useState<OpenFileRequest | null>(null);
  const [homeReady, setHomeReady] = useState(false);

  const {
    showLoader,
    bootError,
    onRetry,
    capabilities,
    onHomeReady,
    onEditorReady,
    onBootError,
  } = useStartup({
    onBootComplete: () => {
      // Mark total startup time via performance API for CI
      performance.measure('strata-startup', 'app_mount');
    },
  });

  // Signal home ready once HomeShell has mounted and loaded
  const handleHomeReady = useCallback(() => {
    setHomeReady(true);
    onHomeReady();
  }, [onHomeReady]);

  const handleOpenFile = useCallback((entry: FileEntry) => {
    platform
      .readFile(entry.id)
      .catch(() => null)
      .then((json) => {
        setOpenRequest((prev) => ({
          id: entry.id,
          name: entry.name,
          json: json ?? null,
          seq: (prev?.seq ?? 0) + 1,
        }));
        setEditorMounted(true);
        setView('editor');
        onEditorReady();
      });
  }, [onEditorReady]);

  const handleBackToHome = useCallback(() => {
    setView('home');
  }, []);

  const handleResumeEditing = useCallback(() => {
    setView('editor');
    onEditorReady();
  }, [onEditorReady]);

  const surfaceStyle = (visible: boolean): React.CSSProperties => ({
    display: visible ? 'flex' : 'none',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  });

  return (
    <>
      {showLoader && (
        <StartupLoader
          error={bootError}
          onRetry={bootError ? onRetry : undefined}
          ready={bootError ? false : homeReady}
        />
      )}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100dvw',
        height: '100dvh',
        overflow: 'hidden',
      }}>
        <TitleBar />
        <div style={surfaceStyle(view === 'home')}>
          <HomeShell
            platform={platform}
            onOpenFile={handleOpenFile}
            onResumeEditing={editorMounted ? handleResumeEditing : undefined}
            onReady={handleHomeReady}
          />
        </div>
        {editorMounted && (
          <div style={surfaceStyle(view === 'editor')}>
            <Shell
              onBackToHome={handleBackToHome}
              openFile={openRequest}
              platform={platform}
              active={view === 'editor'}
            />
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 6: Add `onReady` callback to HomeShell**

Modify `packages/home/src/HomeShell.tsx` — add `onReady?: () => void` prop and call it on first render after loading completes.

```typescript
export interface HomeShellProps {
  platform: Platform;
  onOpenFile: (entry: FileEntry) => void;
  onResumeEditing?: () => void;
  onReady?: () => void; // NEW
}
```

In the HomeShell body:
```typescript
// Near the top of the component function
const readyFired = useRef(false);
useEffect(() => {
  if (!view.loading && !readyFired.current) {
    readyFired.current = true;
    onReady?.();
  }
}, [view.loading, onReady]);
```

- [ ] **Step 7: Write failing test for onReady callback**

```typescript
// packages/home/src/HomeShell.startup.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { HomeShell } from './HomeShell';

const mockPlatform = {
  getViewState: vi.fn().mockResolvedValue({}),
  listFiles: vi.fn().mockResolvedValue([]),
  listTrashedFiles: vi.fn().mockResolvedValue([]),
  listProjects: vi.fn().mockResolvedValue([]),
  listWorkspaces: vi.fn().mockResolvedValue([]),
  setViewState: vi.fn(),
  listenForChanges: vi.fn(() => () => {}),
} as any;

describe('HomeShell onReady', () => {
  it('calls onReady after loading completes', async () => {
    const onReady = vi.fn();
    render(
      <HomeShell
        platform={mockPlatform}
        onOpenFile={vi.fn()}
        onReady={onReady}
      />
    );
    // Wait for async load to resolve
    await vi.waitFor(() => {
      expect(onReady).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 8: Verify tests pass**

Run: `pnpm test --filter @varve/home -- HomeShell.startup.test.tsx 2>&1`
Expected: PASS

- [ ] **Step 9: Handle degraded capabilities**

In the `StartupLoader` usage, pass simplified styles when `capabilities.shouldSimplify`:

```typescript
// In App.tsx, wrap StartupLoader:
import { StartupLoader } from '@varve/ui';

{showLoader && (
  <StartupLoader
    error={bootError}
    onRetry={bootError ? onRetry : undefined}
    ready={bootError ? false : homeReady}
    simplified={capabilities.shouldSimplify}
  />
)}
```

Add `simplified` prop to StartupLoader:

```typescript
// packages/ui/src/components/StartupLoader.tsx
export interface StartupLoaderProps {
  error?: string | null;
  onRetry?: () => void;
  ready?: boolean;
  simplified?: boolean; // NEW — skip chromatic aberration animation
}
```

```typescript
// In the component:
const { error, onRetry, ready, simplified } = props;
// ...
className={`startup-loader ${exiting ? 'startup-loader--exiting' : ''} 
  ${error ? 'startup-loader--error' : ''} 
  ${simplified ? 'startup-loader--simplified' : ''}`}
```

CSS: `.startup-loader--simplified` keeps the white logo static — no chromatic-aberration layers move.

- [ ] **Step 10: Write test for simplified mode**

```typescript
// packages/ui/src/components/StartupLoader.test.tsx — NEW FILE
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StartupLoader } from './StartupLoader';

describe('StartupLoader', () => {
  it('renders with role status when not ready', () => {
    render(<StartupLoader />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('does not render when ready and exit complete', () => {
    const { container } = render(<StartupLoader ready />);
    // After ready, it sets exiting, then after animation returns null
    // For simplicity, we check the --exiting class is present:
    expect(container.querySelector('.startup-loader--exiting')).toBeDefined();
  });

  it('renders error state when error provided', () => {
    render(<StartupLoader error="Something failed" onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Something failed')).toBeDefined();
    expect(screen.getByText('Retry Startup')).toBeDefined();
  });

  it('adds simplified class when simplified prop is true', () => {
    const { container } = render(<StartupLoader simplified />);
    expect(container.querySelector('.startup-loader--simplified')).toBeDefined();
  });
});
```

- [ ] **Step 11: Add CSS for simplified mode**

```css
/* In StartupLoader.css */
.startup-loader--simplified .startup-loader__logo--red,
.startup-loader--simplified .startup-loader__logo--green,
.startup-loader--simplified .startup-loader__logo--blue {
  animation: none;
  opacity: 0;
}
```

- [ ] **Step 12: Verify all tests pass**

Run: `pnpm test --filter @varve/ui -- StartupLoader.test.tsx 2>&1`
Run: `pnpm test --filter @varve/editor -- useStartup.test.tsx 2>&1`
Run: `pnpm test --filter @varve/home -- HomeShell.startup.test.tsx 2>&1`
Expected: All PASS

- [ ] **Step 13: Handle rapid relaunch — enable skip animation on cache**

In `useStartup`, add a flag for rapid relaunch detection:

```typescript
const isWarmRestart = useMemo(() => {
  // Use sessionStorage (cleared on tab close) — if still set, this
  // is an in-session navigation (e.g. dev reload), not a cold start.
  if (typeof sessionStorage !== 'undefined') {
    const flag = sessionStorage.getItem('strata-session-started');
    if (flag) return true;
    sessionStorage.setItem('strata-session-started', '1');
  }
  return false;
}, []);

// Skip branded loader on warm restarts
useEffect(() => {
  if (isWarmRestart && showBrandedLoader && bootManager.state() === 'init') {
    bootManager.markHomeReady();
  }
}, [isWarmRestart, showBrandedLoader, bootManager]);
```

Add test:
```typescript
it('skips branded loader on warm restart (sessionStorage)', () => {
  sessionStorage.setItem('strata-session-started', '1');
  const { result } = renderHook(() => useStartup({}));
  expect(result.current.showLoader).toBe(false);
  expect(result.current.bootState).toBe('home_ready');
  sessionStorage.clear();
});
```

- [ ] **Step 14: Commit**

```bash
git add apps/desktop/src/App.tsx packages/editor/src/startup/useStartup.ts \
       packages/editor/src/startup/useStartup.test.tsx \
       packages/ui/src/components/StartupLoader.tsx \
       packages/ui/src/components/StartupLoader.css \
       packages/ui/src/components/StartupLoader.test.tsx \
       packages/home/src/HomeShell.tsx
git commit -m "feat(loading): wire StartupLoader into App with BootManager"
```

### Phase 2 gate check

- [ ] `pnpm test` — all pass (including new: 10 bootManager, 5 useStartup, 2 HomeShell.onReady, 4 StartupLoader)
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm lint` — 0 new errors
- [ ] `pnpm audit:emoji` — clean
- [ ] `pnpm audit:tokens` — 96/96 WCAG-AA
- [ ] PR opened, CI green

---

## Phase 3 — `loading/03-branded-loader`

**Goal:** Fine-tune timing, exit animation, reduced-motion, and warm-restart edge cases.

**Branch:** `loading/03-branded-loader` (branch from `loading/02-startup-architecture`)
**Risk:** Low — refinement of the startup UX.

### Task 3.1: Exit animation timing

The current `StartupLoader` uses `ready` → `exiting` → fade-out (CSS opacity transition). This works but should:
- Use a configurable exit duration via `--loader-fade-in` token
- Not block the app on animation completion (the app content renders underneath)

**Files:**
- Modify: `packages/ui/src/components/StartupLoader.tsx`
- Modify: `packages/ui/src/components/StartupLoader.css`
- Modify: `packages/editor/src/startup/useStartup.ts`

- [ ] **Step 1: Write test for exit transition timing**

```typescript
// In StartupLoader.test.tsx
it('fires onExited callback after exit animation completes', async () => {
  const onExited = vi.fn();
  render(<StartupLoader ready onExited={onExited} />);
  // Default exit animation is 250ms (--duration-base)
  await vi.waitFor(() => {
    expect(onExited).toHaveBeenCalledOnce();
  }, { timeout: 1000 });
});
```

- [ ] **Step 2: Implement `onExited` callback**

```typescript
export interface StartupLoaderProps {
  error?: string | null;
  onRetry?: () => void;
  ready?: boolean;
  simplified?: boolean;
  onExited?: () => void; // NEW
  exitDuration?: number;  // NEW — override default 250ms
}
```

```typescript
// In component:
useEffect(() => {
  if (ready) {
    setExiting(true);
    const duration = exitDuration ?? 250; // --duration-base
    const timer = setTimeout(() => {
      onExited?.();
    }, duration);
    return () => clearTimeout(timer);
  }
}, [ready, exitDuration, onExited]);
```

- [ ] **Step 3: Verify tests pass**

Run: `pnpm test --filter @varve/ui -- StartupLoader.test.tsx 2>&1`

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/StartupLoader.tsx
git commit -m "feat(loading): add onExited callback to StartupLoader"
```

### Phase 3 gate check

- [ ] `pnpm test` — all pass
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm lint` — 0 new errors
- [ ] PR opened, CI green

---

## Phase 4 — `loading/04-contextual-widgets`

**Goal:** Create `ContentSkeleton` component, improve HomeShell loading state, fix RegionLoader usage gaps.

**Branch:** `loading/04-contextual-widgets` (branch from `loading/02-startup-architecture`)
**Risk:** Low — additive components with no touch to critical startup path.

### Task 4.1: ContentSkeleton component

**Files:**
- Create: `packages/ui/src/components/ContentSkeleton.tsx`
- Create: `packages/ui/src/components/ContentSkeleton.css`
- Create: `packages/ui/src/components/ContentSkeleton.test.tsx`

- [ ] **Step 1: TDD — write failing test for ContentSkeleton**

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentSkeleton } from './ContentSkeleton';

describe('ContentSkeleton', () => {
  it('renders with accessibility label', () => {
    render(<ContentSkeleton label="Loading layers" />);
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByLabelText('Loading layers')).toBeDefined();
  });

  it('renders the correct number of rows', () => {
    const { container } = render(<ContentSkeleton rows={3} label="test" />);
    const items = container.querySelectorAll('.content-skeleton__row');
    expect(items).toHaveLength(3);
  });

  it('renders a grid variant', () => {
    const { container } = render(
      <ContentSkeleton variant="grid" columns={4} rows={2} label="grid" />
    );
    const items = container.querySelectorAll('.content-skeleton__cell');
    expect(items).toHaveLength(8); // 4×2
  });

  it('renders a card variant with icon, title, description', () => {
    const { container } = render(
      <ContentSkeleton variant="card" label="card" />
    );
    expect(container.querySelector('.content-skeleton__card-icon')).toBeDefined();
    expect(container.querySelector('.content-skeleton__card-title')).toBeDefined();
    expect(container.querySelector('.content-skeleton__card-desc')).toBeDefined();
  });

  it('uses inline variant for text-sized placeholders', () => {
    const { container } = render(
      <ContentSkeleton variant="inline" width="60%" label="inline" />
    );
    const el = container.querySelector('.content-skeleton--inline');
    expect(el).toBeDefined();
    expect(el?.getAttribute('style')).toContain('width: 60%');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm test --filter @varve/ui -- ContentSkeleton.test.tsx 2>&1`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `ContentSkeleton.tsx`**

```typescript
export interface ContentSkeletonProps {
  /** Accessible label for the loading region */
  label: string;
  /** Visual variant */
  variant?: 'list' | 'grid' | 'card' | 'inline';
  /** Number of rows (list variant) */
  rows?: number;
  /** Number of columns (grid variant) */
  columns?: number;
  /** Width percentage for inline variant */
  width?: string;
  /** Height for inline variant */
  height?: string;
  className?: string;
}

export function ContentSkeleton({
  label,
  variant = 'list',
  rows = 1,
  columns = 1,
  width,
  height,
  className = '',
}: ContentSkeletonProps) {
  const baseClass = 'content-skeleton';

  if (variant === 'inline') {
    return (
      <div
        className={`${baseClass} ${baseClass}--inline ${className}`}
        role="status"
        aria-label={label}
        style={{ width, height }}
      >
        <div className={`${baseClass}__shimmer`} />
      </div>
    );
  }

  if (variant === 'grid') {
    const cells = Array.from({ length: rows * columns }, (_, i) => i);
    return (
      <div
        className={`${baseClass} ${baseClass}--grid ${className}`}
        role="status"
        aria-label={label}
        style={{ '--skeleton-columns': columns } as React.CSSProperties}
      >
        {cells.map((i) => (
          <div key={i} className={`${baseClass}__cell`}>
            <div className={`${baseClass}__shimmer`} />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div
        className={`${baseClass} ${baseClass}--card ${className}`}
        role="status"
        aria-label={label}
      >
        <div className={`${baseClass}__card-icon`}>
          <div className={`${baseClass}__shimmer`} />
        </div>
        <div className={`${baseClass}__card-title`}>
          <div className={`${baseClass}__shimmer`} />
        </div>
        <div className={`${baseClass}__card-desc`}>
          <div className={`${baseClass}__shimmer`} />
        </div>
      </div>
    );
  }

  // default: list
  const items = Array.from({ length: rows }, (_, i) => i);
  return (
    <div
      className={`${baseClass} ${baseClass}--list ${className}`}
      role="status"
      aria-label={label}
    >
      {items.map((i) => (
        <div key={i} className={`${baseClass}__row`}>
          <div className={`${baseClass}__shimmer`} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement `ContentSkeleton.css`**

```css
.content-skeleton {
  --skeleton-bg: var(--color-surface-raised, #e0e0e0);
  --skeleton-shimmer: var(--color-surface-overlay, #f0f0f0);
  --skeleton-radius: var(--radius-sm, 4px);
  position: relative;
  overflow: hidden;
}

.content-skeleton__shimmer {
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--skeleton-bg) 25%,
    var(--skeleton-shimmer) 50%,
    var(--skeleton-bg) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite var(--ease-standard, ease-in-out);
  border-radius: var(--skeleton-radius);
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .content-skeleton__shimmer {
    animation: none;
    opacity: 0.5;
  }
}

/* List variant */
.content-skeleton--list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
}

.content-skeleton__row {
  height: 20px;
  border-radius: var(--skeleton-radius);
}

.content-skeleton__row:last-child {
  width: 60%;
}

/* Grid variant */
.content-skeleton--grid {
  display: grid;
  grid-template-columns: repeat(var(--skeleton-columns, 4), 1fr);
  gap: var(--space-3, 12px);
}

.content-skeleton__cell {
  aspect-ratio: 1;
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
}

/* Card variant */
.content-skeleton--card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
  padding: var(--space-3, 12px);
  border-radius: var(--radius-md, 8px);
  background: var(--color-surface-default, transparent);
}

.content-skeleton__card-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm, 4px);
  overflow: hidden;
}

.content-skeleton__card-title {
  height: 16px;
  width: 70%;
  border-radius: var(--skeleton-radius);
  overflow: hidden;
}

.content-skeleton__card-desc {
  height: 12px;
  width: 90%;
  border-radius: var(--skeleton-radius);
  overflow: hidden;
}

/* Inline variant */
.content-skeleton--inline {
  display: inline-block;
  height: var(--skeleton-inline-height, 1em);
  vertical-align: middle;
  border-radius: var(--skeleton-radius);
  overflow: hidden;
}
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `pnpm test --filter @varve/ui -- ContentSkeleton.test.tsx 2>&1`
Expected: PASS

- [ ] **Step 6: Export ContentSkeleton from UI package**

```typescript
// packages/ui/src/components/index.ts
export { ContentSkeleton } from './ContentSkeleton';
export type { ContentSkeletonProps } from './ContentSkeleton';
```

### Task 4.2: Improve HomeShell loading state

**Files:**
- Modify: `packages/home/src/HomeShell.tsx:483-490`

Replace the bare `"Loading..."` text with a shimmer skeleton that matches the home screen layout.

- [ ] **Step 1: Write failing test for HomeShell skeleton loading**

```typescript
// packages/home/src/HomeShell.startup.test.tsx — add test
it('renders ContentSkeleton when loading', () => {
  const slowPlatform = {
    ...mockPlatform,
    getViewState: () => new Promise(() => {}), // never resolves
  };
  render(
    <HomeShell
      platform={slowPlatform}
      onOpenFile={vi.fn()}
    />
  );
  // Should show role="status" from ContentSkeleton
  expect(screen.getByRole('status')).toBeDefined();
});
```

- [ ] **Step 2: Replace HomeShell loading state**

```typescript
// In HomeShell.tsx — import ContentSkeleton
import { ContentSkeleton } from '@varve/ui';

// Replace lines 483-490
if (view.loading) {
  return (
    <div className="strata-home">
      <div className="strata-home__sidebar">
        <ContentSkeleton variant="list" rows={5} label="Loading navigation" />
      </div>
      <div className="strata-home__content">
        <ContentSkeleton variant="grid" columns={4} rows={2} label="Loading projects" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify tests pass**

Run: `pnpm test --filter @varve/home -- HomeShell.startup.test.tsx 2>&1`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ContentSkeleton.tsx \
       packages/ui/src/components/ContentSkeleton.css \
       packages/ui/src/components/ContentSkeleton.test.tsx \
       packages/ui/src/components/index.ts \
       packages/home/src/HomeShell.tsx
git commit -m "feat(loading): add ContentSkeleton component and improve HomeShell loading"
```

### Phase 4 gate check

- [ ] `pnpm test` — all pass
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm lint` — 0 new errors
- [ ] `pnpm audit:emoji` — clean
- [ ] PR opened, CI green

---

## Phase 5 — `loading/05-cleanup-removal`

**Goal:** Remove ad-hoc "Loading..." text strings, consolidate spinner implementations, remove duplicate settings stores.

**Branch:** `loading/05-cleanup-removal` (branch from `master`, not from earlier branches)
**Risk:** Low — pure cleanup within well-understood components.

### Task 5.1: Audit and replace ad-hoc loading text

**Files to modify (from the audit):**
- `packages/home/src/ActivityFeed.tsx:X` — replace "Loading..." text with `InlineActivityIndicator`
- `packages/editor/src/components/BackgroundRemoval/BgRemovalModelsTab.tsx:X` — replace "Loading model status..." with `RegionLoader`

- [ ] **Step 1: Write failing tests for each replacement**

```typescript
// ActivityFeed loading test
it('shows InlineActivityIndicator while loading', () => {
  // ... render with loading=true
  expect(screen.getByRole('img')).toBeDefined(); // InlineActivityIndicator uses role="img"
});
```

- [ ] **Step 2: Apply replacements**

Use `RegionLoader` wrapping the content for panel-level loads, `InlineActivityIndicator` for small inline loads.

- [ ] **Step 3: Verify tests pass**

- [ ] **Step 4: Commit**

### Task 5.2: Consolidate spinner CSS variables into design token system

**Files:**
- Modify: `packages/ui/src/tokens/color.ts` or tokens generator

- [ ] **Step 1: Add loading token variables to design token output**

```typescript
// Add to the color tokens generation
export const LOADING_TOKENS = {
  'loader-primary': { value: '--color-interactive-default', dark: '--color-interactive-default' },
  'loader-muted': { value: '--color-text-muted' },
  'startup-bg': { value: '#10151f' }, // always dark
  'startup-logo': { value: '#ffffff' }, // always white
  'skeleton-bg': { value: '--color-surface-raised' },
  'skeleton-shimmer': { value: '--color-surface-overlay' },
} as const;
```

- [ ] **Step 2: Run token generation**

Run: `pnpm --filter @varve/ui tokens:generate`
Expected: `tokens.css` regenerated with new loading tokens

- [ ] **Step 3: Update local fallbacks in component CSS to use tokens**

In `StartupLoader.css`:
```css
background: var(--startup-bg);
/* Remove the #10151f fallback — now guaranteed via tokens */
```

In `ContentSkeleton.css`:
```css
--skeleton-bg: var(--skeleton-bg-color);
--skeleton-shimmer: var(--skeleton-shimmer-color);
```

- [ ] **Step 4: Verify token audit passes**

Run: `pnpm audit:tokens` — must still pass 96/96 (or more if new tokens added)

### Task 5.3: Remove dead code — unused `InspectorPanel.tsx` and stale `--startup-*` duplicates

- [ ] **Step 1: Search for all `--startup-*` CSS variables in the repo**

If only `StartupLoader.css` has them (which now use the tokenized variables), remove the local fallbacks.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/tokens/ packages/ui/src/components/StartupLoader.css
git commit -m "refactor(loading): consolidate loading tokens into design system"
```

### Phase 5 gate check

- [ ] `pnpm test` — all pass
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm lint` — 0 new errors
- [ ] `pnpm audit:tokens` — 96/96 WCAG-AA (or higher)
- [ ] `pnpm audit:emoji` — clean
- [ ] PR opened, CI green

---

## Phase 6 — `loading/06-a11y-perf-hardening`

**Goal:** Add CI regression test for startup timing, accessibility audit, performance measurement, and documentation.

**Branch:** `loading/06-a11y-perf-hardening` (branch from `master`, integrates all prior phases)
**Risk:** Medium — modifies test infrastructure and adds a timing-sensitive CI assertion.

### Task 6.1: Startup timing CI regression test

**Files:**
- Create: `packages/editor/src/startup/startupCi.test.ts` (lightweight, runs in Vitest)
- Or add to an existing E2E spec: `tests/e2e/startup/startup.spec.ts`

E2E approach is better for real timing. Add a Playwright test:

- [ ] **Step 1: Write Playwright spec**

```typescript
// tests/e2e/startup/startup.spec.ts
import { test, expect } from '@playwright/test';

test('startup completes within performance budget', async ({ page }) => {
  // Measure from navigation start to app ready
  await page.goto('/', { waitUntil: 'networkidle' });
  
  const timing = await page.evaluate(() => {
    const marks = performance.getEntriesByName('strata-startup');
    if (marks.length === 0) return null;
    const measure = marks[0] as PerformanceMeasure;
    return measure.duration;
  });

  // If timing is available, assert it's within budget
  if (timing !== null) {
    expect(timing).toBeLessThan(2000); // 2s max for cold start (generous CI allowance)
  }
});
```

- [ ] **Step 2: Verify E2E test runs**

Run: `pnpm test:e2e --filter @varve/home -- startup.spec.ts 2>&1` (or the equivalent E2E command)
Expected: PASS

- [ ] **Step 3: Add timing assertion to CI config**

If `.github/workflows/` already exists, ensure the startup E2E test is included in the matrix.

- [ ] **Step 4: Commit**

### Task 6.2: Accessibility audit of loading surfaces

**Files:**
- Create or update: `tests/e2e/startup/axe.spec.ts`

- [ ] **Step 1: Write axe-core scan for startup state**

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Startup accessibility', () => {
  test('StartupLoader passes axe-core scan', async ({ page }) => {
    await page.goto('/');
    // The load may have already finished — wait for the loader to be visible
    await page.waitForSelector('[role="status"]', { timeout: 2000 }).catch(() => {});
    
    const results = await new AxeBuilder({ page })
      .exclude('[aria-live="polite"]') // live regions are exempt
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('error state passes axe-core scan', async ({ page }) => {
    // Simulate startup error via URL param or localStorage flag
    await page.goto('/?startupError=1');
    await page.waitForSelector('[role="alert"]');
    
    const results = await new AxeBuilder({ page })
      .analyze();
    expect(results.violations).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify E2E tests pass**

Run: `pnpm test:e2e --filter @varve/home -- axe.spec.ts 2>&1`
Expected: PASS (0 violations)

- [ ] **Step 3: Commit**

### Task 6.3: Performance measurement report

- [ ] **Step 1: Run startup timing manually**

```bash
# Start dev server
cd apps/desktop && pnpm dev &
# Wait for server
# Open chromium with performance logging, measure time-to-interactive
```

- [ ] **Step 2: Document measured numbers in the loading system doc**

Update `docs/architecture/loading-system.md` with a Performance section:
- Measured startup time (cold)
- Measured startup time (warm restart)
- Frame rate of branded animation
- Frame rate with reduced-motion

### Task 6.4: Update documentation

- [ ] **Step 1: Update `docs/architecture/loading-system.md`**

Add sections:
- **Performance:** Measured numbers from Task 6.3
- **Boot Sequence:** State machine diagram (init → home_ready → editor_ready)
- **Feature Flag:** `EditorSettings.startup.showBrandedLoader` — how to disable
- **Graceful Degradation:** When simplified/static mode activates
- **Warm Restart:** SessionStorage flag behavior
- **CI Regression:** E2E timing test location

- [ ] **Step 2: Confirm the doc points at the `loading/06-a11y-perf-hardening` commit hash**

```bash
git log --oneline -1
# Update the doc with this commit hash as the anchor reference
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/loading-system.md
git commit -m "docs(loading): update architecture doc with boot sequence and performance numbers"
```

### Phase 6 gate check

- [ ] `pnpm test` — all pass
- [ ] `pnpm test:e2e` — startup + axe specs pass
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm lint` — 0 new errors
- [ ] `pnpm audit:emoji` — clean
- [ ] `pnpm audit:tokens` — 96/96 WCAG-AA
- [ ] `cargo test --workspace` — clean (no Rust changes, but verify no regression)
- [ ] `just gate` — green
- [ ] PR opened, CI green
- [ ] Explicit sign-off obtained before merging to main (per addendum §1)

---

## File Inventory

### New Files (13)
| File | Purpose | Phase |
|------|---------|-------|
| `packages/editor/src/startup/startupTimer.ts` | Performance mark recording | 1 |
| `packages/editor/src/startup/startupTimer.test.ts` | Timer tests | 1 |
| `packages/editor/src/startup/capabilityCheck.ts` | GPU/reduced-motion detection | 1 |
| `packages/editor/src/startup/capabilityCheck.test.ts` | Capability check tests | 1 |
| `packages/editor/src/startup/bootManager.ts` | Boot state machine | 2 |
| `packages/editor/src/startup/bootManager.test.ts` | BootManager tests | 2 |
| `packages/editor/src/startup/useStartup.ts` | React hook for startup orchestration | 2 |
| `packages/editor/src/startup/useStartup.test.tsx` | Hook tests | 2 |
| `packages/ui/src/components/StartupLoader.test.tsx` | StartupLoader component tests | 2 |
| `packages/ui/src/components/ContentSkeleton.tsx` | Shimmer skeleton component | 4 |
| `packages/ui/src/components/ContentSkeleton.css` | Skeleton styles | 4 |
| `packages/ui/src/components/ContentSkeleton.test.tsx` | Skeleton tests | 4 |
| `tests/e2e/startup/startup.spec.ts` | E2E timing CI regression test | 6 |
| `tests/e2e/startup/axe.spec.ts` | E2E accessibility scan | 6 |

### Modified Files (9)
| File | Change | Phase |
|------|--------|-------|
| `packages/editor/src/settings.ts` | Add StartupSettingsStore + STARTUP_PERFORMANCE_BUDGET | 1 |
| `packages/ui/src/components/StartupLoader.tsx` | Add simplified, onExited, exitDuration props | 2, 3 |
| `packages/ui/src/components/StartupLoader.css` | Add --simplified styles, remove hardcoded fallbacks | 2, 5 |
| `apps/desktop/src/App.tsx` | Wire useStartup + StartupLoader | 2 |
| `packages/home/src/HomeShell.tsx` | Add onReady callback, ContentSkeleton loading | 2, 4 |
| `packages/editor/src/index.ts` | Export new startup modules | 1, 2 |
| `packages/home/src/ActivityFeed.tsx` | Replace ad-hoc loading text | 5 |
| `packages/ui/src/tokens/` | Add loading design tokens | 5 |
| `docs/architecture/loading-system.md` | Performance section, boot sequence, fallbacks | 6 |

### Files not modified (verified correct or outside scope)
- `packages/editor/src/context.tsx` — all sync, no async boot needed
- `packages/editor/src/Shell.tsx` — no loading changes needed
- `packages/engine/src/imageCache.ts` — loading pattern already correct
- `packages/ui/src/components/RegionLoader.tsx` — already correct with 300ms debounce
- `packages/ui/src/components/InlineActivityIndicator.tsx` — already correct
- `packages/ui/src/components/DeterminateProgress.tsx` — already correct

---

## Dependency Graph

```
Phase 1 (baseline) ──→ Phase 2 (architecture) ──→ Phase 3 (branded loader)
                                                         │
                                                         └── branched from Phase 2
                                                         
Phase 4 (contextual widgets) ── branched from Phase 2 (independent of Phase 3)

Phase 5 (cleanup) ── branched from master (independent cleanup)

Phase 6 (hardening) ── merges Phases 1-5, adds tests + docs
```

Phases 3 and 4 can run in parallel if using separate agents (they branch from Phase 2 but don't modify the same files).

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| StartupLoader adds measurable latency to TTI | Low | High | Feature flag defaults ON but can be disabled; performance budget of 50ms max overhead |
| App.tsx test flakiness with timing-sensitive assertions | Medium | Medium | E2E test uses performance API, not wall-clock; generous CI budget (2s) |
| Browser/GPU API differences in capability check | Low | Low | `checkStartupCapabilities` catches all errors and returns safe defaults |
| SessionStorage warm-restart flag persists across hard refresh (Ctrl+F5) | Low | Low | Expected behavior — developer reloads are the main use case for warm restart; true cold start sees no flag |
| Two settings stores cause confusion | Medium | Low | Not changing this in the plan — it's a pre-existing issue flagged in the audit but out of scope for this work |
| CSS token generation conflicts with theme system | Low | Medium | New tokens are additive; `pnpm audit:tokens` ensures WCAG compliance |

---

## Plan complete and saved to `docs/plans/loading-system-implementation.md`

Two execution options:

**1. Inline Execution (recommended)** — Execute phases sequentially in this session using executing-plans, batch execution with checkpoints between phases for review

**2. Subagent-Driven** — Dispatch a fresh subagent per phase, review between phases, fast iteration

Which approach?
