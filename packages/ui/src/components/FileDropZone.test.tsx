/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileRejection } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { FileDropZone } from './FileDropZone';

function transfer(files: File[]): DataTransfer {
  return {
    files,
    items: [],
    types: ['Files'],
    dropEffect: 'copy',
  } as unknown as DataTransfer;
}

describe('FileDropZone', () => {
  it('supports the picker fallback and resets the input for reselection', async () => {
    const onFiles = vi.fn();
    render(
      <FileDropZone
        label="Drop images to import"
        description="PNG or SVG files"
        accept="image/*,.svg"
        onFiles={onFiles}
      />,
    );

    const input = screen.getByLabelText('Browse') as HTMLInputElement;
    const image = new File(['pixels'], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [image] } });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([image]));
    expect(input.value).toBe('');
  });

  it('reports partial rejection and accepts valid dropped files in order', async () => {
    const onFiles = vi.fn();
    const onReject = vi.fn<(items: FileRejection<File>[]) => void>();
    const { container } = render(
      <FileDropZone
        label="Drop files to import"
        accept="image/*"
        maxFiles={1}
        onFiles={onFiles}
        onReject={onReject}
      />,
    );

    const zone = container.querySelector('.file-drop-zone')!;
    const good = new File(['pixels'], 'good.png', { type: 'image/png' });
    const bad = new File(['text'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(zone, { dataTransfer: transfer([good, bad]) });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([good]));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject.mock.calls[0]?.[0].map((item) => item.file.name)).toEqual(['notes.txt']);
    expect(zone).toHaveAttribute('data-state', 'accepted');
  });

  it('keeps nested picker activation from causing a second drop action', async () => {
    const onFiles = vi.fn();
    render(<FileDropZone label="Drop images to place" onFiles={onFiles} />);
    const input = screen.getByLabelText('Browse') as HTMLInputElement;
    const file = new File(['pixels'], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
  });

  it('claims external drops so a parent surface cannot ingest them twice', () => {
    const parentDrop = vi.fn();
    const onFiles = vi.fn();
    const { container } = render(
      // biome-ignore lint/a11y/noStaticElementInteractions: test-only parent drop observer
      <div role="presentation" onDrop={parentDrop}>
        <FileDropZone label="Drop files to import" onFiles={onFiles} />
      </div>,
    );
    const zone = container.querySelector('.file-drop-zone')!;
    fireEvent.drop(zone, { dataTransfer: transfer([new File(['x'], 'one.txt')]) });

    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'one.txt' })]);
    expect(parentDrop).not.toHaveBeenCalled();
  });

  it('shows disabled state and does not accept a drop', () => {
    const onFiles = vi.fn();
    const { container } = render(
      <FileDropZone label="Cannot import while read-only" disabled onFiles={onFiles} />,
    );
    const zone = container.querySelector('.file-drop-zone')!;
    const file = new File(['pixels'], 'photo.png', { type: 'image/png' });
    fireEvent.drop(zone, { dataTransfer: transfer([file]) });
    expect(onFiles).not.toHaveBeenCalled();
    expect(zone).toHaveAttribute('data-state', 'disabled');
  });
});
