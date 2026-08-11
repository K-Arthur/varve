import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

// A document with bleed + CMYK colour config already configured — matches
// packages/scene/src/preflight.test.ts's print-ready fixture shape.
const PRINT_READY_DOC = {
  id: 'b0290245-f678-47e6-a285-15fdf0e66407',
  formatVersion: '2.0',
  name: 'print-ready',
  rootChildren: ['n1'],
  nodes: {
    n1: {
      id: 'n1',
      kind: 'group',
      name: 'Page 1 content',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      children: [],
      effects: [],
    },
  },
  components: {},
  nextId: 2,
  activePageId: '3da59ce7-c00f-4737-8c9d-3d4fa4a267aa',
  globalChildren: [],
  pages: [
    {
      id: '3da59ce7-c00f-4737-8c9d-3d4fa4a267aa',
      name: 'Page 1',
      order: 'a0',
      width: 1920,
      height: 1080,
      backgrounds: [],
      contentRoot: 'n1',
    },
  ],
  colorConfig: {
    mode: 'cmyk',
    rgbProfile: { id: 'srgb', name: 'sRGB IEC61966-2.1' },
    cmykProfile: { id: 'fogra39', name: 'Fogra39 (ISO Coated v2 300%)' },
    outputIntent: {
      profile: { id: 'fogra39', name: 'Fogra39 (ISO Coated v2 300%)' },
      renderingIntent: 'relative',
      blackPointCompensation: true,
    },
    blackGeneration: { mode: 'standard', overprintBlack: false },
  },
  documentUnit: 'mm',
  physicalWidth: 210,
  physicalHeight: 297,
  dpi: 300,
  bleed: { top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' },
};

test.describe('Print Mode — Preflight panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  test('preflight badge only appears in Print mode', async ({ page }) => {
    // Design mode (default): no preflight badge in the status bar.
    await expect(page.locator('.preflight-warnings__badge')).toHaveCount(0);

    await page.locator('.workspace-tabs__tab[aria-label="Print workspace"]').click();
    await expect(page.locator('.preflight-warnings__badge')).toBeVisible();

    await page.locator('.workspace-tabs__tab[aria-label="Draw workspace"]').click();
    await expect(page.locator('.preflight-warnings__badge')).toHaveCount(0);
  });

  test('opens the panel and shows a detected issue plus which checks are not verified', async ({
    page,
  }) => {
    await page.locator('.workspace-tabs__tab[aria-label="Print workspace"]').click();
    const badge = page.locator('.preflight-warnings__badge');
    await expect(badge).toBeVisible();
    await badge.click();

    const panel = page.getByRole('dialog', { name: /preflight issues/i });
    await expect(panel).toBeVisible();
    // A brand-new document has no bleed configured — that is an error by default.
    await expect(panel.getByText(/no bleed configured/i)).toBeVisible();
    // Checks that require data this app can't yet supply must say so, not stay silent.
    await expect(panel.getByText('Overset text')).toBeVisible();
    await expect(panel.getByText('Printable-area violations')).toBeVisible();
  });

  test('resolving the underlying issue clears the preflight badge to a clean state', async ({
    page,
  }) => {
    await page.locator('.workspace-tabs__tab[aria-label="Print workspace"]').click();
    const badge = page.locator('.preflight-warnings__badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('aria-label', /errors/i);

    // Open a document that already has bleed + CMYK configured — the real-world
    // resolution for a missing-bleed error is fixing document setup and reopening.
    await page.locator('#file-open-input').setInputFiles({
      name: 'print-ready.strata',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(PRINT_READY_DOC)),
    });

    await expect(badge).toHaveAttribute('aria-label', /no issues found/i, { timeout: 10000 });
  });
});
