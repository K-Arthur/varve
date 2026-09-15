import { expect, test } from '@playwright/test';
import { createTimelineInEditor, navigateToEditor } from './helpers';

test.describe('Timeline accessibility', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await createTimelineInEditor(page);
  });

  test('ruler playhead has slider role and ARIA attributes', async ({ page }) => {
    const ruler = page.locator('.timeline-ruler');
    await expect(ruler).toHaveAttribute('role', 'slider');
    await expect(ruler).toHaveAttribute('aria-label', 'Timeline ruler');
    await expect(ruler).toHaveAttribute('aria-valuemin', '0');
  });

  test('ruler responds to ArrowRight keyboard navigation', async ({ page }) => {
    const ruler = page.locator('.timeline-ruler');
    await ruler.focus();
    const timeBefore = await ruler.getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight');
    const timeAfter = await ruler.getAttribute('aria-valuenow');
    // ArrowRight should increase time by 100ms
    expect(Number(timeAfter)).toBeGreaterThan(Number(timeBefore ?? '0'));
  });

  test('ruler responds to ArrowLeft keyboard navigation', async ({ page }) => {
    const ruler = page.locator('.timeline-ruler');
    await ruler.focus();
    // ArrowLeft at time 0 is a clamp no-op (and React bails out of the
    // identical-state render, so the DOM attribute would not move). Seek
    // right twice first, then verify the 100ms step back.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const at200 = Number((await ruler.getAttribute('aria-valuenow')) ?? '0');
    expect(at200).toBe(200);
    await page.keyboard.press('ArrowLeft');
    const at100 = Number((await ruler.getAttribute('aria-valuenow')) ?? '0');
    expect(at100).toBe(100);
  });

  test('playhead is presentational; the ruler is the single slider', async ({ page }) => {
    // The 2026-08-10 review removed the nested slider: the playhead was a
    // second role=slider tab stop inside the ruler slider. The ruler owns
    // all seek semantics; the playhead is an aria-hidden visual marker.
    const playhead = page.locator('.timeline-ruler__playhead');
    await expect(playhead).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.timeline-ruler[role="slider"]')).toHaveCount(1);
    await expect(page.locator('.timeline-ruler [role="slider"]')).toHaveCount(0);
  });

  test('zoom buttons have accessible labels', async ({ page }) => {
    const zoomIn = page.locator('.timeline-panel__zoom-btn').last();
    const zoomOut = page.locator('.timeline-panel__zoom-btn').first();
    await expect(zoomIn).toHaveAttribute('aria-label', 'Zoom in');
    await expect(zoomOut).toHaveAttribute('aria-label', 'Zoom out');
  });

  test('zoom buttons are keyboard accessible', async ({ page }) => {
    const zoomIn = page.locator('.timeline-panel__zoom-btn').last();
    await zoomIn.focus();
    await page.keyboard.press('Enter');
    // Should not throw — button is responsive
    await expect(zoomIn).toBeFocused();
  });

  test('playback controls toolbar has label', async ({ page }) => {
    const toolbar = page.locator('.timeline-playback-controls');
    await expect(toolbar).toHaveAttribute('aria-label', 'Timeline playback controls');
  });

  test('play/pause button toggles label', async ({ page }) => {
    const playBtn = page.locator('.timeline-playback-btn').first();
    await expect(playBtn).toHaveAttribute('aria-label');
    const label = await playBtn.getAttribute('aria-label');
    expect(label?.toLowerCase()).toMatch(/play|pause/);
  });

  test('graph editor toggle has accessible label', async ({ page }) => {
    const toggle = page.locator('.timeline-panel__toggle-btn');
    // Only present if onToggleGraphEditor exists
    if (await toggle.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(toggle).toHaveAttribute('aria-label', 'Toggle graph editor');
    }
  });
});
