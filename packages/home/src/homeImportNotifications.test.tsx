/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from '@varve/ui';
import { describe, expect, it } from 'vitest';
import { useHomeImportNotifications } from './homeImportNotifications';

function NotificationFixture() {
  const { finishHomeDrop, notifyImportComplete, startHomeDrop } = useHomeImportNotifications();
  return (
    <>
      <button
        type="button"
        onClick={() => notifyImportComplete({ success: 2, failed: 0, total: 2 }, 'asset')}
      >
        Complete assets
      </button>
      <button
        type="button"
        onClick={() => notifyImportComplete({ success: 1, failed: 1, total: 2 }, 'file')}
      >
        Complete partial files
      </button>
      <button
        type="button"
        onClick={() => {
          const id = startHomeDrop(2);
          finishHomeDrop(id, 2, 1);
        }}
      >
        Complete dropped files
      </button>
    </>
  );
}

function renderFixture() {
  return render(
    <ToastProvider>
      <NotificationFixture />
    </ToastProvider>,
  );
}

describe('useHomeImportNotifications', () => {
  it('emits one success summary for a completed asset batch', () => {
    renderFixture();

    fireEvent.click(screen.getByRole('button', { name: 'Complete assets' }));

    expect(screen.getByRole('status')).toHaveTextContent('Assets added');
    expect(screen.getByRole('status')).toHaveTextContent('2 assets added locally');
  });

  it('uses a warning summary for a partial batch', () => {
    renderFixture();

    fireEvent.click(screen.getByRole('button', { name: 'Complete partial files' }));

    expect(screen.getByRole('status')).toHaveTextContent('Some files were not added');
    expect(screen.getByRole('status')).toHaveTextContent('1 file added locally · 1 file failed');
  });

  it('updates a drop loading notification instead of stacking another toast', () => {
    renderFixture();

    fireEvent.click(screen.getByRole('button', { name: 'Complete dropped files' }));

    expect(screen.getByRole('status')).toHaveTextContent('Some files were not added');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});
