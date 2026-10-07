/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import {
  getWorkspacePreferences,
  resetWorkspacePreferenceCache,
  setPanelOverride,
  setWorkspacePreferences,
} from '../../workspace/workspaceStore';

vi.setConfig({ testTimeout: 30_000 });

function PanelVisibility({ panel }: { panel: 'history' | 'timeline' }) {
  const { state } = useEditor();
  const visible = panel === 'history' ? state.historyPanelVisible : state.timelinePanelVisible;
  return <output data-testid="panel">{visible ? 'visible' : 'hidden'}</output>;
}

beforeEach(() => {
  localStorage.clear();
  resetWorkspacePreferenceCache();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetWorkspacePreferenceCache();
});

describe('customized panels at editor boot', () => {
  it.each([
    { mode: 'design', panel: 'history', visible: true, expected: 'visible' },
    { mode: 'design', panel: 'history', visible: false, expected: 'hidden' },
    { mode: 'print', panel: 'history', visible: true, expected: 'hidden' },
    { mode: 'design', panel: 'timeline', visible: true, expected: 'visible' },
    { mode: 'design', panel: 'timeline', visible: false, expected: 'hidden' },
    { mode: 'print', panel: 'timeline', visible: true, expected: 'hidden' },
  ] as const)(
    'restores $mode $panel=$visible as $expected in Design',
    ({ mode, panel, visible, expected }) => {
      setWorkspacePreferences(
        setPanelOverride(getWorkspacePreferences(), mode, panel, { visible }),
      );
      // Re-read the persisted mirror, rather than relying on the live cache.
      resetWorkspacePreferenceCache();
      render(
        <EditorProvider disablePersistentHistory>
          <PanelVisibility panel={panel} />
        </EditorProvider>,
      );
      expect(screen.getByTestId('panel').textContent).toBe(expected);
    },
  );
});
