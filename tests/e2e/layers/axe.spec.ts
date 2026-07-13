import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers Panel - axe-core scan', () => {
  test('layers panel has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);

    const results = await new AxeBuilder({ page })
      .include('.layers-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
