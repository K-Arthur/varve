// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  classifyWorkspaceInteractions,
  readWorkspaceInteractionSnapshot,
  type WorkspaceInteractionSnapshot,
} from '../interactionResolution';

function snapshot(
  overrides: Partial<WorkspaceInteractionSnapshot> = {},
): WorkspaceInteractionSnapshot {
  return {
    tool: 'select',
    maskPreviewMode: 'none',
    isPlaying: false,
    activeElement: null,
    hasOpenModal: false,
    hasImeComposition: false,
    hasActiveControl: false,
    ...overrides,
  };
}

describe('classifyWorkspaceInteractions', () => {
  it('proceeds with no resolutions for an idle editor', () => {
    const plan = classifyWorkspaceInteractions(snapshot());
    expect(plan.blocked).toBe(false);
    expect(plan.resolutions).toEqual([]);
  });

  it('blocks while an IME composition is in progress', () => {
    const plan = classifyWorkspaceInteractions(snapshot({ hasImeComposition: true }));
    expect(plan.blocked).toBe(true);
    expect(plan.blockedReason).toBe('ime-composition');
  });

  it('blocks while a modal dialog is open', () => {
    const plan = classifyWorkspaceInteractions(snapshot({ hasOpenModal: true }));
    expect(plan.blocked).toBe(true);
    expect(plan.blockedReason).toBe('modal-open');
  });

  it('commits node editing, crop, and mask previews back to Select', () => {
    for (const input of [
      snapshot({ tool: 'nodeEdit' }),
      snapshot({ tool: 'crop' }),
      snapshot({ maskPreviewMode: 'preview' }),
    ]) {
      const plan = classifyWorkspaceInteractions(input);
      expect(plan.blocked).toBe(false);
      expect(plan.resolutions.some((resolution) => resolution.kind !== 'text-edit')).toBe(true);
      expect(
        plan.resolutions.every((resolution) =>
          ['commit', 'cancel', 'continue', 'pause'].includes(resolution.action),
        ),
      ).toBe(true);
    }
  });

  it('commits a focused text field so hiding its panel cannot discard a draft', () => {
    const input = document.createElement('input');
    const plan = classifyWorkspaceInteractions(snapshot({ activeElement: input }));
    expect(plan.resolutions).toEqual([
      expect.objectContaining({ kind: 'text-edit', action: 'commit' }),
    ]);
  });

  it('recognizes contenteditable and textarea as text entry', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(
      classifyWorkspaceInteractions(snapshot({ activeElement: editable })).resolutions[0]?.kind,
    ).toBe('text-edit');
    const textarea = document.createElement('textarea');
    expect(
      classifyWorkspaceInteractions(snapshot({ activeElement: textarea })).resolutions[0]?.kind,
    ).toBe('text-edit');
  });

  it('cancels an active control drag and lets playback continue', () => {
    const plan = classifyWorkspaceInteractions(
      snapshot({ hasActiveControl: true, isPlaying: true }),
    );
    expect(plan.resolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'active-control', action: 'cancel' }),
        expect.objectContaining({ kind: 'motion-playback', action: 'continue' }),
      ]),
    );
  });
});

describe('readWorkspaceInteractionSnapshot', () => {
  it('reads the active element and DOM-marked composition/drag/modal state', () => {
    document.body.innerHTML = '';
    const composing = document.createElement('div');
    composing.setAttribute('data-ime-composing', '');
    const dragging = document.createElement('div');
    dragging.setAttribute('data-drag-active', '');
    const modal = document.createElement('dialog');
    modal.setAttribute('open', '');
    document.body.append(composing, dragging, modal);

    const probe = readWorkspaceInteractionSnapshot({
      tool: 'pen',
      maskPreviewMode: 'none',
      isPlaying: false,
    });
    expect(probe.hasImeComposition).toBe(true);
    expect(probe.hasActiveControl).toBe(true);
    expect(probe.hasOpenModal).toBe(true);
    expect(probe.tool).toBe('pen');
  });
});
