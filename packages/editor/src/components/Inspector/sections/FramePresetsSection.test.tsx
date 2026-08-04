/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
/**
 * FramePresetsSection tests — the wiring between the shared preset registry
 * (@varve/shared), the PresetPicker UI (@varve/ui), and the editor's
 * applyFramePreset/presetLibrary. PresetPicker's own search/keyboard-nav/
 * grouping behavior is covered exhaustively in @varve/ui; these tests focus
 * on: unit conversion into applyFramePreset, mode="create" vs "resize"
 * differences, and the save-current-size-as-custom-preset flow.
 */
import { createMemoryPlatform } from '@varve/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { PromptDialog } from '../../PromptDialog';
import { FramePresetsSection } from './FramePresetsSection';

afterEach(cleanup);

beforeEach(() => {
  // DisclosureSection persists expand/collapse per section-title-slug across
  // renders within a session — clear so each test starts from the same
  // (defaultExpanded-driven) state regardless of test order.
  sessionStorage.clear();
});

/** Resize mode starts collapsed by default (only "create" mode auto-expands)
 *  — expand it so tests can reach the PresetPicker/save-current button. */
async function expandDisclosure(user: ReturnType<typeof userEvent.setup>, title: string) {
  const trigger = screen.getByText(title);
  if (trigger.closest('button')?.getAttribute('aria-expanded') === 'false') {
    await user.click(trigger);
  }
}

function setup(mode: 'create' | 'resize') {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Probe() {
    ctx = useEditor();
    return null;
  }
  const platform = createMemoryPlatform();
  render(
    <EditorProvider platform={platform}>
      <Probe />
      <FramePresetsSection mode={mode} />
      <PromptDialog />
    </EditorProvider>,
  );
  if (!ctx) throw new Error('ctx not found');
  return () => ctx as NonNullable<typeof ctx>;
}

describe('FramePresetsSection', () => {
  it('shows "Frame presets" in create mode and "Resize to preset" in resize mode', () => {
    setup('create');
    expect(screen.getByRole('button', { name: 'Frame presets' })).toBeInTheDocument();
    cleanup();
    setup('resize');
    expect(screen.getByRole('button', { name: 'Resize to preset' })).toBeInTheDocument();
  });

  it('renders built-in preset categories', () => {
    setup('create');
    expect(screen.getByText('Social')).toBeInTheDocument();
    expect(screen.getByText('Paper')).toBeInTheDocument();
    expect(screen.getByText('Video & Motion')).toBeInTheDocument();
  });

  it('creates a frame at the correct px size when a preset is selected (create mode)', async () => {
    const user = userEvent.setup();
    const getCtx = setup('create');
    await user.click(screen.getByText('Instagram Post'));

    await waitFor(() => {
      const frames = Object.values(getCtx().state.document.nodes).filter((n) => n.kind === 'frame');
      expect(frames).toHaveLength(1);
      const frame = frames[0];
      if (frame?.kind !== 'frame') throw new Error('frame not created');
      expect(frame.w).toBe(1080);
      expect(frame.h).toBe(1080);
    });
  });

  it('converts a physical-unit preset (mm) to the fixed-96dpi px world unit', async () => {
    const user = userEvent.setup();
    const getCtx = setup('create');
    await user.click(screen.getByText('A4'));

    await waitFor(() => {
      const frames = Object.values(getCtx().state.document.nodes).filter((n) => n.kind === 'frame');
      expect(frames).toHaveLength(1);
      const frame = frames[0];
      if (frame?.kind !== 'frame') throw new Error('frame not created');
      // 210mm/297mm at the fixed-96dpi world unit, not the raw mm numbers.
      expect(frame.w).toBeCloseTo(793.7, 0);
      expect(frame.h).toBeCloseTo(1122.5, 0);
    });
  });

  it('does not show "Save current size as preset" with no selection', async () => {
    const user = userEvent.setup();
    setup('resize');
    await expandDisclosure(user, 'Resize to preset');
    expect(screen.queryByText('Save current size as preset')).not.toBeInTheDocument();
  });

  it('does not show "Save current size as preset" in create mode, even with a frame selected', async () => {
    const getCtx = setup('create');
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => {
      expect(getCtx().state.selection).toHaveLength(1);
    });
    expect(screen.queryByText('Save current size as preset')).not.toBeInTheDocument();
  });

  it('saves the selected frame size as a named custom preset (resize mode)', async () => {
    const user = userEvent.setup();
    // applyFramePreset selects the frame it creates, so calling it directly
    // (rather than clicking a picker tile) both creates and selects a frame
    // in one step, letting mode="resize" show the save-current button.
    const getCtx = setup('resize');
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => {
      expect(getCtx().state.selection).toHaveLength(1);
    });
    await expandDisclosure(user, 'Resize to preset');

    const saveButton = await screen.findByText('Save current size as preset');
    await user.click(saveButton);

    // applyFramePreset runs the name through nextAutoName (e.g. "Test Frame
    // 1", not the raw "Test Frame"), so read the actual frame name back
    // rather than assuming the exact auto-naming format.
    const frameName = Object.values(getCtx().state.document.nodes).find((n) => n.kind === 'frame')
      ?.name as string;
    const nameInput = await screen.findByDisplayValue(frameName);
    await user.clear(nameInput);
    await user.type(nameInput, 'My Custom Frame');
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(screen.getByText('Custom')).toBeInTheDocument();
      expect(screen.getByText('My Custom Frame')).toBeInTheDocument();
    });
  });
});
