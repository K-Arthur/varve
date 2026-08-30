import { describe, expect, it } from 'vitest';
import {
  createPanelWindowId,
  getPanelWindowSessionId,
  resetPanelWindowSessionForTest,
} from './panelWindowSession';

describe('panelWindowSession', () => {
  it('keeps one opaque session id for the primary process', () => {
    resetPanelWindowSessionForTest();
    const first = getPanelWindowSessionId();
    expect(getPanelWindowSessionId()).toBe(first);
    expect(first).toMatch(/^panel-session-[A-Za-z0-9]+$/);
  });

  it('allocates URL-safe canonical window ids before creation', () => {
    resetPanelWindowSessionForTest();
    const first = createPanelWindowId();
    const second = createPanelWindowId();
    expect(first).toMatch(/^panel-[A-Za-z0-9]+$/);
    expect(second).toMatch(/^panel-[A-Za-z0-9]+$/);
    expect(second).not.toBe(first);
  });
});
