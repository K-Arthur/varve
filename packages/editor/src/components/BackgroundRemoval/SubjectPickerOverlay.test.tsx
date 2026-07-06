// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubjectPickerOverlay } from './SubjectPickerOverlay';

afterEach(cleanup);

describe('SubjectPickerOverlay', () => {
  const session = {
    nodeId: 'n1',
    width: 100,
    height: 100,
    components: [
      { id: 1, pixelCount: 500, bbox: { x: 0, y: 0, w: 40, h: 50 } },
      { id: 2, pixelCount: 200, bbox: { x: 60, y: 60, w: 20, h: 20 } },
    ],
    keepIds: [1],
    pendingMaskDataUrl: 'data:image/png;base64,abc',
    method: 'ai-balanced' as const,
    confidence: 0.9,
    feather: 0.5,
    decontaminate: true,
  };

  it('renders all detected subjects', () => {
    render(<SubjectPickerOverlay session={session} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Subject 1 (largest)')).toBeTruthy();
    expect(screen.getByText('Subject 2')).toBeTruthy();
  });

  it('calls onConfirm with selected ids', () => {
    const onConfirm = vi.fn();
    render(<SubjectPickerOverlay session={session} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('Subject 2'));
    fireEvent.click(screen.getByRole('button', { name: /Keep selected/i }));
    expect(onConfirm).toHaveBeenCalledWith([1, 2]);
  });

  it('calls onCancel when cancelled', () => {
    const onCancel = vi.fn();
    render(<SubjectPickerOverlay session={session} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
