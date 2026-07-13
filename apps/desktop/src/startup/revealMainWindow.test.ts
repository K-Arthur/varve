/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dismissBootFallback, isTauriRuntime, revealMainWindow } from './revealMainWindow';

describe('revealMainWindow', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('isTauriRuntime is false without __TAURI__', () => {
    expect(isTauriRuntime()).toBe(false);
  });

  it('isTauriRuntime is true when __TAURI__ is present', () => {
    const w = window as Window & { __TAURI__?: { core: object } };
    w.__TAURI__ = { core: {} };
    expect(isTauriRuntime()).toBe(true);
    delete w.__TAURI__;
  });

  it('revealMainWindow no-ops in browser', async () => {
    await expect(revealMainWindow()).resolves.toBeUndefined();
  });

  it('dismissBootFallback removes the boot fallback element', () => {
    const el = document.createElement('div');
    el.id = 'strata-boot-fallback';
    document.body.appendChild(el);
    dismissBootFallback();
    expect(document.getElementById('strata-boot-fallback')).toBeNull();
  });

  it('dismissBootFallback removes fallback before root element is visible', () => {
    // Simulate the real main.tsx sequence: dismiss first, then create root
    const bootEl = document.createElement('div');
    bootEl.id = 'strata-boot-fallback';
    document.body.prepend(bootEl);
    const rootEl = document.createElement('div');
    rootEl.id = 'root';
    document.body.appendChild(rootEl);

    // Before React mounts, the boot fallback should be removed
    dismissBootFallback();

    expect(document.getElementById('strata-boot-fallback')).toBeNull();
    // root must still be present for createRoot
    expect(document.getElementById('root')).not.toBeNull();
  });
});
