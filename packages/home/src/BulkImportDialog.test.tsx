/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Platform } from '@varve/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkImportDialog } from './BulkImportDialog';

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

function createPlatform() {
  return {
    kind: 'memory',
    upsertFile: vi.fn().mockResolvedValue(undefined),
    importAsset: vi.fn().mockResolvedValue(undefined),
  } as unknown as Platform;
}

describe('BulkImportDialog', () => {
  it('keeps native documents intact and stores assets in the asset library', async () => {
    const platform = createPlatform();
    const onImportComplete = vi.fn();
    render(
      <BulkImportDialog
        open
        onClose={vi.fn()}
        platform={platform}
        workspaceId="workspace-1"
        onImportComplete={onImportComplete}
      />,
    );

    const document = new File([JSON.stringify({ name: 'Poster' })], 'poster.varve', {
      type: 'application/json',
    });
    const asset = new File(['image bytes'], 'reference.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose files'), {
      target: { files: [document, asset] },
    });
    fireEvent.click(screen.getByRole('button', { name: /add to library/i }));

    await waitFor(() =>
      expect(onImportComplete).toHaveBeenCalledWith({ success: 2, failed: 0, total: 2 }),
    );
    expect(platform.upsertFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Poster', kind: 'strata' }),
      JSON.stringify({ name: 'Poster' }),
    );
    expect(platform.importAsset).toHaveBeenCalledWith(
      'workspace-1',
      'reference.png',
      expect.any(Uint8Array),
      'image/png',
    );
    expect(screen.getByText('2 added')).toBeDefined();
  });

  it('reports malformed native documents without creating a placeholder', async () => {
    const platform = createPlatform();
    const onImportComplete = vi.fn();
    render(
      <BulkImportDialog
        open
        onClose={vi.fn()}
        platform={platform}
        workspaceId="workspace-1"
        onImportComplete={onImportComplete}
      />,
    );

    fireEvent.change(screen.getByLabelText('Choose files'), {
      target: { files: [new File(['not json'], 'broken.varve', { type: 'application/json' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /add to library/i }));

    await waitFor(() =>
      expect(onImportComplete).toHaveBeenCalledWith({ success: 0, failed: 1, total: 1 }),
    );
    expect(platform.upsertFile).not.toHaveBeenCalled();
    expect(screen.getByText(/not valid JSON/i)).toBeDefined();
  });
});
