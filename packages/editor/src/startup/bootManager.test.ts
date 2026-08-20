import { describe, expect, it } from 'vitest';
import { createBootManager } from './bootManager';

describe('createBootManager', () => {
  it('starts in init state', () => {
    const bm = createBootManager();
    expect(bm.state()).toBe('init');
  });

  it('transitions to home_ready on markHomeReady()', () => {
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

  it('caps state machine at editor_ready', () => {
    const bm = createBootManager();
    bm.markHomeReady();
    bm.markEditorReady();
    bm.markHomeReady();
    expect(bm.state()).toBe('editor_ready');
  });

  it('transitions to error state', () => {
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

  it('reset returns to init from error so retry can proceed', () => {
    const bm = createBootManager();
    bm.markError(new Error('failed'));
    expect(bm.state()).toBe('error');
    bm.reset();
    expect(bm.state()).toBe('init');
    expect(bm.error()).toBeNull();
    bm.markHomeReady();
    expect(bm.state()).toBe('home_ready');
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

describe('boot without Home', () => {
  it('completes startup when the editor opens directly', () => {
    // The browser demo seeds a document and mounts the editor without ever
    // showing Home. Rejecting this transition left the branded loader over a
    // fully mounted editor — invisible in Chromium, which fired home_ready
    // regardless, and a permanent loading screen in WebKit.
    const boot = createBootManager();
    boot.markEditorReady();
    expect(boot.state()).toBe('editor_ready');
    expect(boot.isStartupComplete()).toBe(true);
  });

  it('still refuses to go backwards once the editor is ready', () => {
    const boot = createBootManager();
    boot.markEditorReady();
    boot.markHomeReady();
    expect(boot.state()).toBe('editor_ready');
  });
});
