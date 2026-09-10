// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDetachedPanel,
  getDetachedPanels,
  markPanelDetached,
  markPanelReattached,
  reconcileDetachedPanelsForSession,
  resetDetachedPanelsStore,
} from './detachedPanelsStore';

describe('detachedPanelsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDetachedPanelsStore();
  });

  it('tracks one canonical host per singleton panel and advances generation', () => {
    markPanelDetached('layers', 'layers-main', 'panel-one', 'session-a');
    markPanelDetached('layers', 'layers-main', 'panel-two', 'session-a');

    expect(getDetachedPanels()).toEqual([
      expect.objectContaining({
        panelTypeId: 'layers',
        windowId: 'panel-two',
        sessionId: 'session-a',
        generation: 2,
      }),
    ]);
  });

  it('fails closed on stale or legacy persisted records after a new primary session starts', () => {
    markPanelDetached('layers', 'layers-main', 'panel-old', 'old-session');
    markPanelDetached('inspector', 'inspector-main', 'panel-current', 'current-session');

    expect(reconcileDetachedPanelsForSession('current-session')).toEqual([
      expect.objectContaining({ panelTypeId: 'inspector', windowId: 'panel-current' }),
    ]);
    expect(getDetachedPanel('layers')).toBeUndefined();
    expect(getDetachedPanel('inspector')?.sessionId).toBe('current-session');
  });

  it('returns the source panel to the dock idempotently', () => {
    markPanelDetached('layers', 'layers-main', 'panel-one', 'session-a');
    markPanelReattached('layers');
    markPanelReattached('layers');

    expect(getDetachedPanels()).toEqual([]);
  });
});
