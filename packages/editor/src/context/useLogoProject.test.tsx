// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { createDocument } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import type { EditorState } from './types';
import { useLogoProject } from './useLogoProject';

function makeState(): EditorState {
  return {
    document: createDocument('logo-history', true),
    selection: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    primaryId: null,
    focusedNodeId: null,
    activeContainerId: null,
    selectionMode: 'default',
    selectionOrigin: 'api',
    selectionRevision: 0,
  } as unknown as EditorState;
}

describe('useLogoProject history boundary', () => {
  it('groups project creation before updating the document', () => {
    const stateRef = { current: makeState() } as React.MutableRefObject<EditorState>;
    const setState = vi.fn<React.Dispatch<React.SetStateAction<EditorState>>>();
    const updateDoc = vi.fn((fn: (doc: EditorState['document']) => EditorState['document']) => {
      stateRef.current = { ...stateRef.current, document: fn(stateRef.current.document) };
    });
    const groupCompoundOperation = vi.fn((_label: string, action: () => void) => action());
    const announcerRef = {
      current: { announce: vi.fn() } as unknown as CanvasAnnouncer,
    } as React.MutableRefObject<CanvasAnnouncer | null>;

    const { result } = renderHook(() =>
      useLogoProject(setState, stateRef, updateDoc, groupCompoundOperation, announcerRef),
    );

    act(() => result.current.newLogoProject('History-safe logo'));

    expect(groupCompoundOperation).toHaveBeenCalledWith('Logo project', expect.any(Function));
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(stateRef.current.document.logoProject?.concepts).toHaveLength(1);
  });
});
