// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediaRuntime = vi.hoisted(() => ({
  installMediaFrameResolver: vi.fn(),
  syncMediaSessions: vi.fn(),
  bridgeMediaCacheToRedraw: vi.fn(() => () => {}),
  tickMediaPresentation: vi.fn(() => 0),
}));

const frameRuntime = vi.hoisted(() => ({
  createEditorFrameKey: vi.fn(() => 'projection-media-frame'),
  requestEditorFrame: vi.fn(),
}));

vi.mock('../../media/editorMediaRuntime', () => mediaRuntime);
vi.mock('../../performance/editorFrameRuntime', () => frameRuntime);

import { EditorProvider, useEditor } from '../../context';
import { resetSettings, updateSettings } from '../../settings';
import {
  getWorkspacePreferences,
  resetWorkspacePreferenceCache,
} from '../../workspace/workspaceStore';

function mountProjection() {
  let editor: ReturnType<typeof useEditor> | undefined;

  function Probe() {
    editor = useEditor();
    return null;
  }

  render(
    <EditorProvider projectionMode disablePersistentHistory>
      <Probe />
    </EditorProvider>,
  );

  return () => {
    if (!editor) throw new Error('projection editor did not mount');
    return editor;
  };
}

beforeEach(() => {
  localStorage.clear();
  resetWorkspacePreferenceCache();
  resetSettings();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetWorkspacePreferenceCache();
  resetSettings();
});

describe('EditorProvider projection mode runtime ownership', () => {
  it('keeps media runtime ownership in the primary editor', async () => {
    let editor: ReturnType<typeof useEditor> | undefined;

    function Probe() {
      editor = useEditor();
      return null;
    }

    render(
      <EditorProvider disablePersistentHistory>
        <Probe />
      </EditorProvider>,
    );

    await waitFor(() => expect(editor).toBeDefined());
    expect(mediaRuntime.installMediaFrameResolver).toHaveBeenCalledTimes(1);
    expect(mediaRuntime.syncMediaSessions).toHaveBeenCalledTimes(1);
    expect(mediaRuntime.bridgeMediaCacheToRedraw).toHaveBeenCalledTimes(1);
  });

  it('does not install media sessions, subscribe to the cache, or start a media clock', async () => {
    const getEditor = mountProjection();

    await waitFor(() => expect(getEditor()).toBeDefined());
    expect(mediaRuntime.installMediaFrameResolver).not.toHaveBeenCalled();
    expect(mediaRuntime.syncMediaSessions).not.toHaveBeenCalled();
    expect(mediaRuntime.bridgeMediaCacheToRedraw).not.toHaveBeenCalled();

    act(() => {
      getEditor().playMedia();
      getEditor().seekMedia(250);
      getEditor().stepMediaFrame(1);
    });

    expect(mediaRuntime.tickMediaPresentation).not.toHaveBeenCalled();
    expect(frameRuntime.createEditorFrameKey).not.toHaveBeenCalled();
    expect(frameRuntime.requestEditorFrame).not.toHaveBeenCalled();
    expect(getEditor().state.media.isPlaying).toBe(false);
  });

  it('does not migrate or mutate persisted workspace preferences', async () => {
    // A legacy panel setting normally becomes a workspace override after the
    // primary provider mounts. A projection must only read the snapshot.
    updateSettings({ panel: { leftPanelVisible: false } });
    expect(getWorkspacePreferences().design.customized).toBe(false);

    const getEditor = mountProjection();
    await waitFor(() => expect(getEditor()).toBeDefined());

    expect(getWorkspacePreferences().design.customized).toBe(false);
    let switched = true;
    await act(async () => {
      switched = await getEditor().requestWorkspaceSwitch('drawing');
    });

    expect(switched).toBe(false);
    expect(getEditor().state.workspaceMode).toBe('design');
    expect(getWorkspacePreferences().design.customized).toBe(false);
  });
});
