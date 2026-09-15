import { beforeEach, describe, expect, it } from 'vitest';
import type { PlatformInfo } from '../runtime';
import {
  detectRuntimeKind,
  getPlatformInfo,
  hasCapability,
  isTauriRuntime,
  isWebRuntime,
  resetPlatformInfo,
  setPlatformInfoForTest,
} from '../runtime';

beforeEach(() => {
  resetPlatformInfo();
});

describe('detectRuntimeKind', () => {
  it('returns memory when no window (SSR)', () => {
    expect(detectRuntimeKind()).toBe('memory');
  });

  it('returns tauri when overridden', () => {
    setPlatformInfoForTest({
      kind: 'tauri',
      os: 'linux',
      capabilities: new Set(),
      hasTauriIpc: true,
      hasNativeFs: true,
      hasWebGpu: false,
      hasWebWorker: false,
      hasWasm: false,
    });
    expect(detectRuntimeKind()).toBe('tauri');
  });

  it('returns web when overridden', () => {
    setPlatformInfoForTest({
      kind: 'web',
      os: 'linux',
      capabilities: new Set(['wasm', 'indexedDb']),
      hasTauriIpc: false,
      hasNativeFs: false,
      hasWebGpu: false,
      hasWebWorker: true,
      hasWasm: true,
    });
    expect(detectRuntimeKind()).toBe('web');
  });
});

describe('getPlatformInfo', () => {
  it('returns memory info by default (no window)', () => {
    const info = getPlatformInfo();
    expect(info.kind).toBe('memory');
    expect(info.os).toBe('unknown');
    expect(info.capabilities).toBeInstanceOf(Set);
  });

  it('returns override when set', () => {
    const custom: PlatformInfo = {
      kind: 'tauri',
      os: 'mac',
      capabilities: new Set(['nativeMenu', 'fs.read', 'wasm']),
      hasTauriIpc: true,
      hasNativeFs: true,
      hasWebGpu: false,
      hasWebWorker: true,
      hasWasm: true,
    };
    setPlatformInfoForTest(custom);
    const info = getPlatformInfo();
    expect(info.kind).toBe('tauri');
    expect(info.os).toBe('mac');
    expect(info.hasTauriIpc).toBe(true);
    expect(info.capabilities.has('nativeMenu')).toBe(true);
  });

  it('is memoised (returns same reference)', () => {
    resetPlatformInfo();
    const a = getPlatformInfo();
    const b = getPlatformInfo();
    expect(a).toBe(b);
  });

  it('re-detects after reset', () => {
    const custom: PlatformInfo = {
      kind: 'web',
      os: 'linux',
      capabilities: new Set(),
      hasTauriIpc: false,
      hasNativeFs: false,
      hasWebGpu: false,
      hasWebWorker: false,
      hasWasm: false,
    };
    setPlatformInfoForTest(custom);
    const a = getPlatformInfo();
    expect(a.kind).toBe('web');

    resetPlatformInfo();
    const b = getPlatformInfo();
    expect(b.kind).toBe('memory');
    expect(b).not.toBe(a);
  });
});

describe('hasCapability', () => {
  it('returns true for overridden capabilities', () => {
    setPlatformInfoForTest({
      kind: 'tauri',
      os: 'linux',
      capabilities: new Set(['webgpu', 'wasmSimd']),
      hasTauriIpc: true,
      hasNativeFs: true,
      hasWebGpu: true,
      hasWebWorker: false,
      hasWasm: false,
    });
    expect(hasCapability('webgpu')).toBe(true);
    expect(hasCapability('wasmSimd')).toBe(true);
    expect(hasCapability('nativeMenu')).toBe(false);
  });
});

describe('isTauriRuntime', () => {
  it('returns true when kind is tauri', () => {
    setPlatformInfoForTest({
      kind: 'tauri',
      os: 'linux',
      capabilities: new Set(),
      hasTauriIpc: true,
      hasNativeFs: true,
      hasWebGpu: false,
      hasWebWorker: false,
      hasWasm: false,
    });
    expect(isTauriRuntime()).toBe(true);
  });

  it('returns false for web kind', () => {
    setPlatformInfoForTest({
      kind: 'web',
      os: 'linux',
      capabilities: new Set(),
      hasTauriIpc: false,
      hasNativeFs: false,
      hasWebGpu: false,
      hasWebWorker: false,
      hasWasm: false,
    });
    expect(isTauriRuntime()).toBe(false);
  });

  it('returns false for memory kind', () => {
    resetPlatformInfo();
    expect(isTauriRuntime()).toBe(false);
  });
});

describe('isWebRuntime', () => {
  it('returns true for web kind', () => {
    setPlatformInfoForTest({
      kind: 'web',
      os: 'linux',
      capabilities: new Set(),
      hasTauriIpc: false,
      hasNativeFs: false,
      hasWebGpu: false,
      hasWebWorker: false,
      hasWasm: false,
    });
    expect(isWebRuntime()).toBe(true);
  });

  it('returns false for tauri kind', () => {
    setPlatformInfoForTest({
      kind: 'tauri',
      os: 'linux',
      capabilities: new Set(),
      hasTauriIpc: true,
      hasNativeFs: true,
      hasWebGpu: false,
      hasWebWorker: false,
      hasWasm: false,
    });
    expect(isWebRuntime()).toBe(false);
  });
});

describe('stale scan rejection', () => {
  it('detectRuntimeKind returns correct kind after override and reset', () => {
    setPlatformInfoForTest({
      kind: 'tauri',
      os: 'linux',
      capabilities: new Set(),
      hasTauriIpc: true,
      hasNativeFs: true,
      hasWebGpu: false,
      hasWebWorker: false,
      hasWasm: false,
    });
    expect(detectRuntimeKind()).toBe('tauri');

    resetPlatformInfo();
    expect(detectRuntimeKind()).toBe('memory');
  });
});
