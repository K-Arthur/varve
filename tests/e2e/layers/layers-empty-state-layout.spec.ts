import { expect, test } from '@playwright/test';
import { navigateToEditor, switchWorkspace } from '../shared';

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1024, height: 720 },
]) {
  test(`Email layers empty state stays readable at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await navigateToEditor(page);
    await switchWorkspace(page, 'Email');

    const tree = page.locator('.layers-panel__tree');
    const headline = tree.getByRole('heading', { name: 'No layers yet' });
    const description = tree.getByText('Add a shape to get started', { exact: true });
    await expect(tree).toBeVisible();
    await expect(headline).toBeVisible();
    await expect(description).toBeVisible();

    // `toBeVisible` does not detect text hidden outside a scrollport. Require
    // the whole description to fit within the tree's currently visible area,
    // so users can discover the empty-state guidance without guessing that
    // the panel itself needs scrolling.
    const visibleBounds = await description.evaluate((element) => {
      const scrollport = element.closest('.layers-panel__tree');
      if (!scrollport) throw new Error('Empty-state description is outside the Layers tree');
      const text = element.getBoundingClientRect();
      const tree = scrollport.getBoundingClientRect();
      const top = tree.top + scrollport.clientTop;
      return {
        textTop: text.top,
        textBottom: text.bottom,
        treeTop: top,
        treeBottom: top + scrollport.clientHeight,
      };
    });
    expect(visibleBounds.textTop).toBeGreaterThanOrEqual(visibleBounds.treeTop);
    expect(visibleBounds.textBottom).toBeLessThanOrEqual(visibleBounds.treeBottom);
  });
}
