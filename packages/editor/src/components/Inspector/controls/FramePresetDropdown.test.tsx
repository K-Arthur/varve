// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FrameNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useEditor: vi.fn(),
  recordRecent: vi.fn(),
}));

vi.mock('../../../context', () => ({
  useEditor: mocks.useEditor,
}));

vi.mock('../../../presetLibrary', () => ({
  usePresetLibrary: () => ({
    recordRecent: mocks.recordRecent,
  }),
}));

import { FramePresetDropdown } from './FramePresetDropdown';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeTestFrame(w: number, h: number): FrameNode {
  return {
    id: 'frame-1',
    kind: 'frame',
    name: 'Frame 1',
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

    const frame = makeTestFrame(402, 874);
    render(<FramePresetDropdown frame={frame} />);

    expect(screen.getByTestId('frame-preset-dropdown-trigger')).toHaveTextContent('iPhone 17');
  });

  it('displays "Custom" when frame dimensions do not match any preset', () => {
    mocks.useEditor.mockReturnValue({
      applyFramePreset: vi.fn(),
      platform: 'browser',
    });

    const frame = makeTestFrame(1234, 5678);
    render(<FramePresetDropdown frame={frame} />);

    expect(screen.getByTestId('frame-preset-dropdown-trigger')).toHaveTextContent('Custom');
  });

  it('opens preset search popover on click and filters by query', async () => {
    const applyFramePreset = vi.fn();
    mocks.useEditor.mockReturnValue({
      applyFramePreset,
      platform: 'browser',
    });

    const frame = makeTestFrame(1234, 5678);
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
});
