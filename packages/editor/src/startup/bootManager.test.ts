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
