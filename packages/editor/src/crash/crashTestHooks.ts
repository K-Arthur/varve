/**
 * Deterministic synthetic crash controls — development and test builds only.
 *
 * Exposes `window.__varveCrashTest` so WDIO/Playwright specs and manual
 * development can trigger every capture path deterministically. The hooks
 * are installed only when the build is not production (Vite DEV mode or
 * the `wdio` test mode); they never ship in production UI. Nothing here can
 * generate a report that bypasses the consent gate — every hook routes
 * through CrashCenterController.captureCrash.
 */

import type { CrashCenterController } from './crashController';

export interface CrashTestHooks {
  throwError(message?: string): void;
  rejectPromise(message?: string): void;
  simulateWorkerCrash(message?: string): Promise<void>;
  simulateWasmTrap(message?: string): Promise<void>;
  simulateContextLoss(): void;
  simulateRustPanic(message?: string): Promise<void>;
  simulateDiskFull(): Promise<void>;
  simulateUploadFailure(): Promise<void>;
  simulateOom(message?: string): Promise<void>;
  forceCrashLoop(): void;
  corruptQueue(): Promise<void>;
  revokeDuringUpload(): Promise<void>;
  shutdownDuringPersistence(): Promise<void>;
  /** Injects a stub transport (test only). */
  setUploaderForTesting(uploader: {
    upload: (report: unknown) => Promise<{ ok: boolean; retryable: boolean; status: number }>;
  }): void;
}

declare global {
  interface Window {
    __varveCrashTest?: CrashTestHooks;
  }
}

export function isNonProductionBuild(): boolean {
  const mode = (import.meta as ImportMeta & { env?: { MODE?: string; DEV?: boolean } }).env;
  return mode?.MODE === 'wdio' || mode?.DEV === true;
}

/** Installs the test hooks on the given controller (dev/test builds only). */
export function installCrashTestHooks(controller: CrashCenterController): void {
  if (typeof window === 'undefined') return;
  if (!isNonProductionBuild()) return;
  const hooks: CrashTestHooks = {
    throwError: (message = 'synthetic frontend exception') => {
      throw new Error(message);
    },
    rejectPromise: (message = 'synthetic unhandled rejection') => {
      void Promise.reject(new Error(message));
    },
    simulateWorkerCrash: async (message = 'synthetic worker crash') => {
      await controller.captureCrash({
        type: 'worker',
        category: 'worker-crash',
        subsystem: 'render-worker',
        message,
        rawStack: `Error: ${message}\n    at Worker.onmessage (renderWorker.ts:1:1)`,
        threadCategory: 'worker',
        recoveryStatus: 'not-applicable',
      });
    },
    simulateWasmTrap: async (message = 'synthetic wasm trap') => {
      await controller.captureCrash({
        type: 'wasm',
        category: 'wasm-trap',
        subsystem: 'wasm',
        message,
        rawStack: `RuntimeError: unreachable\n    at module.exports.memory (varve.wasm:0x2f3a)`,
        threadCategory: 'wasm',
        recoveryStatus: 'not-applicable',
      });
    },
    simulateContextLoss: () => {
      window.dispatchEvent(new WebGLContextEvent('webglcontextlost'));
    },
    simulateRustPanic: async (message = 'synthetic rust panic') => {
      await controller.captureCrash({
        type: 'rust-panic',
        category: 'native-panic',
        subsystem: 'native',
        message,
        rawStack: `thread 'main' panicked at ${message}`,
        threadCategory: 'native',
        recoveryStatus: 'not-applicable',
      });
    },
    simulateDiskFull: async () => {
      // Drive the queue into the byte cap so enqueues are dropped.
      for (let i = 0; i < 12; i++) {
        await controller.captureCrash({
          type: 'error',
          category: 'disk-full-simulation',
          subsystem: 'persistence',
          message: 'ENOSPC: no space left on device (simulated)',
          threadCategory: 'main',
          recoveryStatus: 'not-applicable',
        });
      }
    },
    simulateUploadFailure: async () => {
      await controller.captureCrash({
        type: 'error',
        category: 'upload-failure-simulation',
        subsystem: 'network',
        message: 'Failed to send crash report (simulated)',
        threadCategory: 'main',
        recoveryStatus: 'not-applicable',
      });
    },
    simulateOom: async (message = 'synthetic OOM') => {
      await controller.captureCrash({
        type: 'oom',
        category: 'javascript-heap-exhausted',
        subsystem: 'frontend',
        message,
        threadCategory: 'main',
        recoveryStatus: 'not-applicable',
      });
    },
    forceCrashLoop: () => {
      try {
        const key = 'varve:crash-loop';
        const now = Date.now();
        localStorage.setItem(key, JSON.stringify({ failures: [now, now - 1000, now - 2000] }));
      } catch {
        // storage unavailable
      }
    },
    corruptQueue: async () => {
      try {
        const key = 'varve:crash-metrics';
        const state = localStorage.getItem(key)
          ? JSON.parse(localStorage.getItem(key) ?? '{}')
          : {};
        localStorage.setItem(key, JSON.stringify({ ...state, queueCorruptionCount: 1 }));
      } catch {
        // ignore
      }
    },
    revokeDuringUpload: async () => {
      controller.applyConsent('enableAutomatic');
      controller.applyConsent('revoke');
    },
    shutdownDuringPersistence: async () => {
      // Exercises the persist path by capturing and immediately reading back.
      await controller.captureCrash({
        type: 'error',
        category: 'shutdown-simulation',
        subsystem: 'persistence',
        message: 'shutdown during persistence (simulated)',
        threadCategory: 'main',
        recoveryStatus: 'not-applicable',
      });
    },
    setUploaderForTesting: (uploader) => {
      controller.setUploaderForTesting({
        upload: async (report: unknown) => uploader.upload(report),
      } as unknown as Parameters<CrashCenterController['setUploaderForTesting']>[0]);
    },
  };
  window.__varveCrashTest = hooks;
}
