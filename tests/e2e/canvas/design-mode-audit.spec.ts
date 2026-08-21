import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

const LOW_CONTRAST_DOC = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  formatVersion: '2.0',
  name: 'low-contrast',
  rootChildren: ['frame1'],
  nodes: {
    frame1: {
      id: 'frame1',
      kind: 'frame',
      name: 'Card',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      children: ['text1'],
      strokes: [],
      effects: [],
      w: 400,
      h: 200,
    },
    text1: {
      id: 'text1',
      kind: 'text',
      name: 'Caption',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 204, g: 204, b: 204, a: 255 },
      text: 'Hello',
      fontSize: 16,
      strokes: [],
      effects: [],
    },
  },
  components: {},
  nextId: 2,
  activePageId: null,
  globalChildren: [],
};

test.describe('Design (Dev/Design) Mode — accessibility audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  test('the Audit tab detects a real low-contrast text issue and auto-fix resolves it', async ({
    page,
  }) => {
    await page.locator('#file-open-input').setInputFiles({
      name: 'low-contrast.strata',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(LOW_CONTRAST_DOC)),
    });
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    // The inspector owns the IntelligencePanel. Open its outer Audit tab
    // before addressing the nested Intelligence tabs; otherwise the nested
    // tablist does not exist and the test waits until timeout.
    const inspector = page.locator('.editor-inspector');
    await inspector.getByRole('tab', { name: 'Audit', exact: true }).click();
    const intelligence = page.locator('.intelligence-panel');
    await intelligence.getByRole('tab', { name: 'audit', exact: true }).click();
    await expect(page.getByText(/WCAG AA minimum/i).first()).toBeVisible();
    await expect(page.getByText('No issues detected')).not.toBeVisible();

    await intelligence.getByRole('button', { name: /auto-fix/i }).click();
    await expect(page.getByText('No issues detected')).toBeVisible();
  });
});
