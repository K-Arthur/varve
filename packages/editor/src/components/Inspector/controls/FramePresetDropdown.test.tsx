// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FrameNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useEditor: vi.fn(),
  recordRecent: vi.fn(),
  toggleFavorite: vi.fn(),
  addCustomPreset: vi.fn(),
  deleteCustomPreset: vi.fn(),
  promptDialog: vi.fn(),
}));

vi.mock('../../../context', () => ({
  useEditor: mocks.useEditor,
}));

vi.mock('../../../presetLibrary', () => ({
  usePresetLibrary: () => ({
    customPresets: [],
    favoriteIds: new Set<string>(),
    recentIds: [],
    recordRecent: mocks.recordRecent,
    toggleFavorite: mocks.toggleFavorite,
    addCustomPreset: mocks.addCustomPreset,
    deleteCustomPreset: mocks.deleteCustomPreset,
  }),
}));

vi.mock('../../PromptDialog', () => ({
  promptDialog: (...args: any[]) => mocks.promptDialog(...args),
}));

import { FramePresetDropdown } from './FramePresetDropdown';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeTestFrame(id: string, w: number, h: number): FrameNode {
  return {
    id,
    kind: 'frame',
    name: `Frame ${id}`,
    x: 0,
    y: 0,
    w,
    h,
    children: [],
    opacity: 1,
    visible: true,
    locked: false,
  } as unknown as FrameNode;
}

describe('FramePresetDropdown', () => {
  it('detects and displays known preset name (iPhone 17 for 402x874)', () => {
    mocks.useEditor.mockReturnValue({
      applyFramePreset: vi.fn(),
      platform: 'browser',
    });

    const frame = makeTestFrame('frame-1', 402, 874);
    render(<FramePresetDropdown frame={frame} />);

    expect(screen.getByTestId('frame-preset-dropdown-trigger')).toHaveTextContent('iPhone 17');
  });

  it('displays "Custom" when frame dimensions do not match any preset', () => {
    mocks.useEditor.mockReturnValue({
      applyFramePreset: vi.fn(),
      platform: 'browser',
    });

    const frame = makeTestFrame('frame-1', 1234, 5678);
    render(<FramePresetDropdown frame={frame} />);

    expect(screen.getByTestId('frame-preset-dropdown-trigger')).toHaveTextContent('Custom');
  });

  it('displays "Mixed" when multiple frames with different dimensions are selected', () => {
    mocks.useEditor.mockReturnValue({
      applyFramePreset: vi.fn(),
      platform: 'browser',
    });

    const f1 = makeTestFrame('frame-1', 393, 852);
    const f2 = makeTestFrame('frame-2', 1440, 1024);
    render(<FramePresetDropdown frames={[f1, f2]} />);

    expect(screen.getByTestId('frame-preset-dropdown-trigger')).toHaveTextContent('Mixed');
  });

  it('displays common preset name when multiple frames share the same preset dimensions', () => {
    mocks.useEditor.mockReturnValue({
      applyFramePreset: vi.fn(),
      platform: 'browser',
    });

    const f1 = makeTestFrame('frame-1', 402, 874);
    const f2 = makeTestFrame('frame-2', 402, 874);
    render(<FramePresetDropdown frames={[f1, f2]} />);

    expect(screen.getByTestId('frame-preset-dropdown-trigger')).toHaveTextContent('iPhone 17');
  });

  it('opens preset search popover on click and filters by query', async () => {
    const applyFramePreset = vi.fn();
    mocks.useEditor.mockReturnValue({
      applyFramePreset,
      platform: 'browser',
    });

    const frame = makeTestFrame('frame-1', 1234, 5678);
    render(<FramePresetDropdown frame={frame} />);

    // Open dropdown
    fireEvent.click(screen.getByTestId('frame-preset-dropdown-trigger'));

    const dialog = screen.getByTestId('frame-preset-popover');
    expect(dialog).toBeTruthy();

    const searchInput = screen.getByLabelText(/filter presets/i);
    expect(searchInput).toBeTruthy();

    // Filter by "MacBook"
    fireEvent.change(searchInput, { target: { value: 'MacBook Pro 16"' } });

    const optionText = screen.getByText('MacBook Pro 16"');
    const option = optionText.closest('button');
    expect(option).toBeTruthy();

    // Select preset
    fireEvent.click(option!);

    expect(applyFramePreset).toHaveBeenCalledWith({
      name: 'MacBook Pro 16"',
      w: 1728,
      h: 1117,
    });
    expect(mocks.recordRecent).toHaveBeenCalled();
  });

  it('filters presets when clicking category chips (e.g. Social)', () => {
    mocks.useEditor.mockReturnValue({
      applyFramePreset: vi.fn(),
      platform: 'browser',
    });

    const frame = makeTestFrame('frame-1', 1080, 1080);
    render(<FramePresetDropdown frame={frame} />);

    fireEvent.click(screen.getByTestId('frame-preset-dropdown-trigger'));

    // Click Social category chip
    const socialChip = document.querySelector(
      '.insp-preset-chip[aria-label="Social"]',
    ) as HTMLElement;
    expect(socialChip).toBeTruthy();
    fireEvent.click(socialChip);

    // Social presets should be present in the popover
    expect(screen.getAllByText('Instagram Post').length).toBeGreaterThanOrEqual(2);
  });

  it('calls toggleFavorite when clicking the star button on a preset', () => {
    mocks.useEditor.mockReturnValue({
      applyFramePreset: vi.fn(),
      platform: 'browser',
    });

    const frame = makeTestFrame('frame-1', 402, 874);
    render(<FramePresetDropdown frame={frame} />);

    fireEvent.click(screen.getByTestId('frame-preset-dropdown-trigger'));

    const starBtn = document.querySelector('.insp-preset-fav-btn') as HTMLElement;
    expect(starBtn).toBeTruthy();
    fireEvent.click(starBtn);

    expect(mocks.toggleFavorite).toHaveBeenCalled();
  });

  it('batch-resizes all selected frames in a single transaction', () => {
    const beginTransaction = vi.fn();
    const updateNode = vi.fn();
    const commitTransaction = vi.fn();

    mocks.useEditor.mockReturnValue({
      beginTransaction,
      updateNode,
      commitTransaction,
      applyFramePreset: vi.fn(),
      platform: 'browser',
    });

    const f1 = makeTestFrame('frame-1', 100, 100);
    const f2 = makeTestFrame('frame-2', 200, 200);
    render(<FramePresetDropdown frames={[f1, f2]} />);

    fireEvent.click(screen.getByTestId('frame-preset-dropdown-trigger'));

    const searchInput = screen.getByLabelText(/filter presets/i);
    fireEvent.change(searchInput, { target: { value: 'Desktop HD' } });

    const option = screen.getByText('Desktop HD').closest('button');
    expect(option).toBeTruthy();
    fireEvent.click(option!);

    expect(beginTransaction).toHaveBeenCalled();
    expect(updateNode).toHaveBeenCalledTimes(2);
    expect(commitTransaction).toHaveBeenCalled();
  });

  it('prompts and saves current frame size as custom preset', async () => {
    mocks.promptDialog.mockResolvedValue('My Banner Standard');
    mocks.useEditor.mockReturnValue({
      applyFramePreset: vi.fn(),
      platform: 'browser',
    });

    const frame = makeTestFrame('frame-1', 600, 400);
    render(<FramePresetDropdown frame={frame} />);

    fireEvent.click(screen.getByTestId('frame-preset-dropdown-trigger'));

    const saveBtn = screen.getByText('Save current size as preset').closest('button');
    expect(saveBtn).toBeTruthy();
    fireEvent.click(saveBtn!);

    expect(mocks.promptDialog).toHaveBeenCalledWith('Save frame size as preset', 'Frame frame-1');
    await waitFor(() => {
      expect(mocks.addCustomPreset).toHaveBeenCalledWith({
        name: 'My Banner Standard',
        width: 600,
        height: 400,
        unit: 'px',
        orientation: 'landscape',
      });
    });
  });
});
