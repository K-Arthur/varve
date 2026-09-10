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
    sourceWidth: 100,
    sourceHeight: 100,
    components: [
      {
        id: 1,
        pixelCount: 500,
        bbox: { x: 0, y: 0, w: 40, h: 50 },
        confidence: 0.9,
        relativeArea: 0.3,
        centerOfMass: { x: 20, y: 25 },
        edgePixelCount: 100,
        isLargest: true,
      },
      {
        id: 2,
        pixelCount: 200,
        bbox: { x: 60, y: 60, w: 20, h: 20 },
        confidence: 0.8,
        relativeArea: 0.12,
        centerOfMass: { x: 70, y: 70 },
        edgePixelCount: 40,
        isLargest: false,
      },
    ],
    keepIds: [1],
    pendingMaskDataUrl: 'data:image/png;base64,abc',
    sourceImageSrc: 'data:image/png;base64,xyz',
    method: 'ai-balanced' as const,
    confidence: 0.9,
    feather: 0.5,
    decontaminate: true,
  };

  it('renders all detected subjects', () => {
    render(<SubjectPickerOverlay session={session} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Subject 1')).toBeTruthy();
    expect(screen.getByText('Subject 2')).toBeTruthy();
  });

  it('shows selection count', () => {
    render(<SubjectPickerOverlay session={session} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('1 of 2 selected')).toBeTruthy();
  });

  it('calls onConfirm with selected ids when keeping selected', () => {
    const onConfirm = vi.fn();
    render(<SubjectPickerOverlay session={session} onConfirm={onConfirm} onCancel={vi.fn()} />);
    // Click Subject 2 to select it (Subject 1 is already selected by default)
    const subject2 = screen.getByRole('option', { name: /Subject 2/ });
    fireEvent.click(subject2);
    // When all subjects are selected, the primary button says "Keep all (2)"
    fireEvent.click(screen.getByRole('button', { name: /Keep all/ }));
    expect(onConfirm).toHaveBeenCalledWith([1, 2]);
  });

  it('calls onConfirm with all ids when keeping all', () => {
    const onConfirm = vi.fn();
    render(<SubjectPickerOverlay session={session} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Keep all/ }));
    expect(onConfirm).toHaveBeenCalledWith([1, 2]);
  });

  it('calls onCancel when cancelled', () => {
    const onCancel = vi.fn();
    render(<SubjectPickerOverlay session={session} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('selects all via Select all button', () => {
    render(<SubjectPickerOverlay session={session} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Select all/ }));
    expect(screen.getByText('2 of 2 selected')).toBeTruthy();
  });

  it('deselects all via Deselect all button', () => {
    render(<SubjectPickerOverlay session={session} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Deselect all/ }));
    expect(screen.getByText('0 of 2 selected')).toBeTruthy();
    // Keep button should be disabled
    const keepBtn = screen.getByRole('button', { name: /No subjects selected/ });
    expect(keepBtn).toBeDisabled();
  });

  it('calls onHighlight on hover', () => {
    const onHighlight = vi.fn();
    render(
      <SubjectPickerOverlay
        session={session}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onHighlight={onHighlight}
      />,
    );
    const card = screen.getByRole('option', { name: /Subject 1/ });
    fireEvent.mouseEnter(card);
    expect(onHighlight).toHaveBeenCalledWith(1);
    fireEvent.mouseLeave(card);
    expect(onHighlight).toHaveBeenCalledWith(null);
  });
});
