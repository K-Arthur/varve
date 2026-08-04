/**
 * @vitest-environment jsdom
 */
import { isTauriRuntime, resetPlatformInfo } from '@varve/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dismissBootFallback, revealMainWindow } from './revealMainWindow';

describe('revealMainWindow', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetPlatformInfo();
  });

  afterEach(() => {
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
    resetPlatformInfo();
  });

  it('isTauriRuntime is false without __TAURI__', () => {
    expect(isTauriRuntime()).toBe(false);
  });

  it('isTauriRuntime is true when __TAURI__ is present', () => {
    const w = window as Window & { __TAURI__?: { core: object } };
    w.__TAURI__ = { core: {} };
    expect(isTauriRuntime()).toBe(true);
  });

  it('revealMainWindow no-ops in browser', async () => {
    await expect(revealMainWindow()).resolves.toBeUndefined();
  });

  it('dismissBootFallback removes the boot fallback element', () => {
    const el = document.createElement('div');
    el.id = 'varve-boot-fallback';
    document.body.appendChild(el);
    dismissBootFallback();
    expect(document.getElementById('varve-boot-fallback')).toBeNull();
  });

  it('dismissBootFallback removes fallback before root element is visible', () => {
    // Simulate the real main.tsx sequence: dismiss first, then create root
    const bootEl = document.createElement('div');
    bootEl.id = 'varve-boot-fallback';
    document.body.prepend(bootEl);
    const rootEl = document.createElement('div');
    rootEl.id = 'root';
    document.body.appendChild(rootEl);

    // Before React mounts, the boot fallback should be removed
    dismissBootFallback();

    expect(document.getElementById('varve-boot-fallback')).toBeNull();
    // root must still be present for createRoot
    expect(document.getElementById('root')).not.toBeNull();
  });
});
