// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorConversionDialog } from './ColorConversionDialog';

// Mock the editor context
const mockAssign = vi.fn();
const mockConvert = vi.fn();
const mockBeginTransaction = vi.fn();
const mockCommitTransaction = vi.fn();

vi.mock('../../context', () => ({
  useEditor: () => ({
    documentColorMode: 'rgb',
    assignDocumentColorMode: mockAssign,
    convertDocumentColors: mockConvert,
    beginTransaction: mockBeginTransaction,
    commitTransaction: mockCommitTransaction,
  }),
}));

describe('ColorConversionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open', () => {
    render(<ColorConversionDialog open onClose={() => {}} />);
    expect(screen.getByText('Document Color Mode')).toBeTruthy();
  });

  it('shows current mode', () => {
    render(<ColorConversionDialog open onClose={() => {}} />);
    const value = document.querySelector('.color-conversion__value');
    expect(value?.textContent).toBe('RGB');
  });

  it('calls assignDocumentColorMode on Assign mode', () => {
    render(<ColorConversionDialog open onClose={() => {}} />);
    const cmykRadio = screen.getByRole('radio', { name: 'CMYK' });
    act(() => {
      cmykRadio.click();
    });
    const assignBtn = screen.getByRole('button', { name: 'Assign mode' });
    act(() => {
      assignBtn.click();
    });
    expect(mockBeginTransaction).toHaveBeenCalled();
    expect(mockAssign).toHaveBeenCalledWith('cmyk');
    expect(mockCommitTransaction).toHaveBeenCalled();
    expect(mockConvert).not.toHaveBeenCalled();
  });

  it('calls convertDocumentColors on Convert colors', () => {
    render(<ColorConversionDialog open onClose={() => {}} />);
    const cmykRadio = screen.getByRole('radio', { name: 'CMYK' });
    act(() => {
      cmykRadio.click();
    });
    const convertBtn = screen.getByRole('button', { name: 'Convert colors' });
    act(() => {
      convertBtn.click();
    });
    expect(mockBeginTransaction).toHaveBeenCalled();
    expect(mockConvert).toHaveBeenCalledWith('cmyk');
    expect(mockCommitTransaction).toHaveBeenCalled();
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it('disables actions when the target equals the current mode', () => {
    render(<ColorConversionDialog open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Assign mode' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Convert colors' })).toBeDisabled();
  });

  it('closes without actions when cancelling', () => {
    const onClose = vi.fn();
    render(<ColorConversionDialog open onClose={onClose} />);
    act(() => {
      screen.getByRole('button', { name: 'Cancel' }).click();
    });
    expect(onClose).toHaveBeenCalled();
    expect(mockAssign).not.toHaveBeenCalled();
    expect(mockConvert).not.toHaveBeenCalled();
  });
});
