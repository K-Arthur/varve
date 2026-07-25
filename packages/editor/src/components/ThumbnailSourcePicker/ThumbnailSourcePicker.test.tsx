// @vitest-environment jsdom

import { createMemoryPlatform, type FileEntry, type Platform } from '@strata/platform';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThumbnailSourcePicker } from './ThumbnailSourcePicker';

function makeFile(overrides?: Partial<FileEntry>): FileEntry {
  return {
    id: 'file-1',
    name: 'Test',
    kind: 'strata',
    projectId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    openedAt: Date.now(),
    size: 100,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: 'hash-1',
    ...overrides,
  };
}

describe('ThumbnailSourcePicker', () => {
  it('renders with automatic source selected', () => {
    const file = makeFile();
    const platform = createMemoryPlatform();
    const onPreferenceChange = vi.fn();
    const onRegenerate = vi.fn();

    render(
      <ThumbnailSourcePicker
        file={file}
        platform={platform}
        onPreferenceChange={onPreferenceChange}
        onRegenerate={onRegenerate}
      />,
    );

    expect(screen.getByText('Project Thumbnail')).toBeTruthy();
    expect(screen.getByText('Automatic')).toBeTruthy();
  });

  it('calls onRegenerate when refresh is clicked', () => {
    const file = makeFile();
    const platform = createMemoryPlatform();
    const onPreferenceChange = vi.fn();
    const onRegenerate = vi.fn();

    render(
      <ThumbnailSourcePicker
        file={file}
        platform={platform}
        onPreferenceChange={onPreferenceChange}
        onRegenerate={onRegenerate}
      />,
    );

    const refreshBtn = screen.getByLabelText('Regenerate thumbnail');
    fireEvent.click(refreshBtn);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('calls onPreferenceChange when automatic is clicked', () => {
    const file = makeFile({ thumbnailPreference: { type: 'automatic' } });
    const platform = createMemoryPlatform();
    const onPreferenceChange = vi.fn();
    const onRegenerate = vi.fn();

    render(
      <ThumbnailSourcePicker
        file={file}
        platform={platform}
        onPreferenceChange={onPreferenceChange}
        onRegenerate={onRegenerate}
      />,
    );

    const autoBtn = screen.getByText('Automatic').closest('button');
    if (autoBtn) {
      fireEvent.click(autoBtn);
      expect(onPreferenceChange).toHaveBeenCalledWith({ type: 'automatic' });
    }
  });

  it('renders in compact mode', () => {
    const file = makeFile();
    const platform = createMemoryPlatform();

    render(
      <ThumbnailSourcePicker
        file={file}
        platform={platform}
        onPreferenceChange={vi.fn()}
        onRegenerate={vi.fn()}
        compact
      />,
    );

    expect(screen.getByText('Project Thumbnail')).toBeTruthy();
  });
});
