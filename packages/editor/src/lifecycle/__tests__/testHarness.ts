import { vi } from 'vitest';
import type { LifecycleMarker } from '../coordinator';
import type {
  DialogOutcome,
  EditorLifecycleApi,
  PromptRequest,
  SaveFailureCategory,
  SaveOutcome,
} from '../types';

export interface FakeSession {
  id: string;
  name: string;
  dirty: boolean;
  filePath?: string;
  fileId?: string;
}

export interface FakeApiControls {
  api: EditorLifecycleApi;
  sessions: FakeSession[];
  saveCalls: string[];
  closed: string[];
  setDirty(id: string, dirty: boolean): void;
  setActive(id: string | null): void;
  setSaveResult(result: SaveOutcome): void;
  setSaveAsResult(result: SaveOutcome): void;
  setLastSaveFailure(category: SaveFailureCategory): void;
  /** When false, a successful save does NOT clear dirty — simulates an edit
   *  landing mid-save (revision race). Default true. */
  setClearDirtyOnSave(enabled: boolean): void;
  gateSave(): Promise<void>;
  releaseSave(): void;
}

export function createFakeApi(initial: FakeSession[] = []): FakeApiControls {
  const sessions: FakeSession[] = [...initial];
  const saveCalls: string[] = [];
  const closed: string[] = [];
  let activeId: string | null = initial[0]?.id ?? null;
  let saveResult: SaveOutcome = { ok: true };
  let saveAsResult: SaveOutcome = { ok: true };
  let lastSaveFailure: SaveFailureCategory = 'unknown';
  let clearDirtyOnSave = true;
  let gate: Promise<void> | null = null;
  let releaseGate: (() => void) | null = null;

  const api: EditorLifecycleApi = {
    getSessions: () => sessions,
    getActiveSessionId: () => activeId,
    saveSession: vi.fn(async (id: string): Promise<SaveOutcome> => {
      saveCalls.push(id);
      if (gate) await gate;
      if (saveResult.ok && clearDirtyOnSave) {
        const session = sessions.find((s) => s.id === id);
        if (session) session.dirty = false;
      }
      return saveResult;
    }),
    saveSessionAs: vi.fn(async (): Promise<SaveOutcome> => saveAsResult),
    isSessionDirty: (id) => sessions.find((s) => s.id === id)?.dirty ?? false,
    closeTab: vi.fn((id: string) => {
      closed.push(id);
      const index = sessions.findIndex((s) => s.id === id);
      if (index >= 0) sessions.splice(index, 1);
      return true;
    }),
    switchTab: vi.fn((id: string) => {
      activeId = id;
    }),
    getLastSaveFailure: () => lastSaveFailure,
    goHome: vi.fn(),
  };

  return {
    api,
    sessions,
    saveCalls,
    closed,
    setDirty(id, dirty) {
      const session = sessions.find((s) => s.id === id);
      if (session) session.dirty = dirty;
    },
    setActive(id) {
      activeId = id;
    },
    setSaveResult(result) {
      saveResult = result;
    },
    setSaveAsResult(result) {
      saveAsResult = result;
    },
    setLastSaveFailure(category) {
      lastSaveFailure = category;
    },
    setClearDirtyOnSave(enabled) {
      clearDirtyOnSave = enabled;
    },
    gateSave() {
      if (!gate) {
        gate = new Promise<void>((resolve) => (releaseGate = resolve));
      }
      return gate;
    },
    releaseSave() {
      releaseGate?.();
      gate = null;
      releaseGate = null;
    },
  };
}

export interface DialogHarness {
  requests: PromptRequest[];
  prompt(request: PromptRequest): void;
  last(): PromptRequest | null;
  respond(outcome: DialogOutcome): void;
  cancel(): void;
  flush(): Promise<void>;
}

export function createDialogHarness(): DialogHarness {
  const requests: PromptRequest[] = [];
  let pending: PromptRequest | null = null;
  return {
    requests,
    prompt(request) {
      requests.push(request);
      pending = request;
    },
    respond(outcome) {
      if (!pending) return;
      const request = pending;
      pending = null;
      request.respond(outcome);
    },
    cancel() {
      if (!pending) return;
      const request = pending;
      pending = null;
      request.respond(null);
    },
    last: () => (requests.length > 0 ? requests[requests.length - 1]! : null),
    async flush() {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}

export interface MemoryMarkerControl {
  marker: LifecycleMarker;
  value: () => string;
  cleanCalls: () => number;
}

export function createMemoryMarker(initial = 'true'): MemoryMarkerControl {
  let value = initial;
  let cleanCalls = 0;
  const marker: LifecycleMarker = {
    begin: vi.fn(() => {
      const previous = value === 'true';
      value = 'false';
      return previous;
    }),
    previousSessionWasClean: vi.fn(() => value === 'true'),
    markClean: vi.fn(() => {
      cleanCalls++;
      value = 'true';
    }),
  };
  return { marker, value: () => value, cleanCalls: () => cleanCalls };
}
