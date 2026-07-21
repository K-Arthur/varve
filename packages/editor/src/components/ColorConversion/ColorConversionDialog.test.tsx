// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorConversionDialog } from './ColorConversionDialog';

// Mock the editor context
const mockSwitchColorMode = vi.fn();
const mockBeginTransaction = vi.fn();
const mockCommitTransaction = vi.fn();

vi.mock('../../context', () => ({
  useEditor: () => ({
    documentColorMode: 'rgb',
    switchColorMode: mockSwitchColorMode,
    beginTransaction: mockBeginTransaction,
    commitTransaction: mockCommitTransaction,
  }),
}));

describe('ColorConversionDialog', () => {
  it('renders when open', () => {
    render(<ColorConversionDialog open onClose={() => {}} />);
    expect(screen.getByText('Convert Document Color Space')).toBeTruthy();
  });

  it('shows current mode', () => {
    render(<ColorConversionDialog open onClose={() => {}} />);
    expect(screen.getByText('RGB / uint8')).toBeTruthy();
  });

  it('calls switchColorMode on convert', () => {
    render(<ColorConversionDialog open onClose={() => {}} />);
    // Select CMYK mode
    const cmykRadio = screen.getByRole('radio', { name: 'CMYK' });
    act(() => {
      cmykRadio.click();
    });
    const convertBtn = screen.getByRole('button', { name: 'Convert' });
    act(() => {
      convertBtn.click();
    });
    expect(mockBeginTransaction).toHaveBeenCalled();
    expect(mockSwitchColorMode).toHaveBeenCalledWith('cmyk');
    expect(mockCommitTransaction).toHaveBeenCalled();
  });
});
