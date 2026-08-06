/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TabStrip } from './TabStrip';

const { closeTab, save, showToast, switchTab } = vi.hoisted(() => ({
  closeTab: vi.fn(),
  save: vi.fn(),
  showToast: vi.fn(),
  switchTab: vi.fn(),
}));

const sessions = [
  { id: 's1', name: 'Doc A', dirty: true, fileId: 'f1' },
  { id: 's2', name: 'Doc B', dirty: false, fileId: 'f2' },
];

vi.mock('./context', () => ({
  useEditor: () => ({
    state: { sessions, activeId: 's1' },
    closeTab,
    save,
    showToast,
    switchTab,
  }),
}));

beforeEach(() => {
  closeTab.mockReset();
  save.mockReset();
  showToast.mockReset();
  switchTab.mockReset();
  closeTab.mockImplementation((_id: string, force = false) => {
    if (force) return true;
    return false;
  });
  save.mockResolvedValue(true);
});

describe('TabStrip — dirty-close flow', () => {
  it('opens a Save / Don\u2019t save / Cancel dialog when closing a dirty tab', () => {
    render(<TabStrip />);
    const closeBtn = screen.getByLabelText('Close Doc A');
    fireEvent.click(closeBtn);
    expect(closeTab).toHaveBeenCalledWith('s1');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Don't save" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('Cancel keeps the tab open and does not close it', () => {
    render(<TabStrip />);
    fireEvent.click(screen.getByLabelText('Close Doc A'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(closeTab).toHaveBeenCalledTimes(1); // only the guard call
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("Don't save force-closes the dirty tab", () => {
    render(<TabStrip />);
    fireEvent.click(screen.getByLabelText('Close Doc A'));
    fireEvent.click(screen.getByRole('button', { name: "Don't save" }));
    expect(closeTab).toHaveBeenCalledWith('s1', true);
  });

  it('Save persists the document before closing', async () => {
    render(<TabStrip />);
    fireEvent.click(screen.getByLabelText('Close Doc A'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(closeTab).toHaveBeenCalledWith('s1', true);
  });

  it('Save on a background dirty tab activates that tab first', async () => {
    closeTab.mockImplementation((_id: string, force = false) => {
      // First call is the guard (no force); background tab close also guards.
      if (!force) return false;
      return true;
    });
    render(<TabStrip />);
    const closeBtn = screen.getByLabelText('Close Doc B');
    fireEvent.click(closeBtn);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(switchTab).toHaveBeenCalledWith('s2'));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a failed save keeps the document open and surfaces a toast', async () => {
    save.mockResolvedValue(false);
    render(<TabStrip />);
    fireEvent.click(screen.getByLabelText('Close Doc A'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(closeTab).not.toHaveBeenCalledWith('s1', true);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
