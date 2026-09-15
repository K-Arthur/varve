import { expect, test } from '@playwright/test';
import { createTimelineInEditor, navigateToEditor, openExportDialog } from './helpers';

const hasWebCodecs =
  typeof globalThis.VideoEncoder !== 'undefined' && typeof globalThis.VideoFrame !== 'undefined';

test.describe('Motion video export', () => {
  test.skip(!hasWebCodecs, 'WebCodecs unavailable in this browser');

  test('export dialog shows MP4/WebM when timelines exist', async ({ page }) => {
    await navigateToEditor(page);
    await createTimelineInEditor(page);
    await openExportDialog(page);

    await expect(page.getByRole('button', { name: /Export Timeline 1 as MP4/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export Timeline 1 as WebM/i })).toBeVisible();
  });
});
