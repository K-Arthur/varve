/**
 * Email Workspace Dogfood Test
 *
 * Build a realistic marketing email and capture high-quality screenshots
 * for the v0.5.1 marketing video.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

// Configure for high-quality screenshots
test.use({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenshotMetadata {
  filename: string;
  description: string;
  elements: Record<string, BoundingBox>;
}

const screenshots: ScreenshotMetadata[] = [];
const artifactsDir = '/tmp/cursor/artifacts/email-workspace-dogfood';

// Ensure artifacts directory exists
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

async function navigateToEditor(page: Page): Promise<void> {
  await page.goto('http://localhost:1420', { timeout: 60000, waitUntil: 'domcontentloaded' });

  // Wait for the New button
  const newButton = page.getByRole('button', { name: /^new$/i });
  await newButton.waitFor({ state: 'visible', timeout: 30000 });
  await newButton.click();

  // Click Create Design
  const createButton = page.locator('dialog[open]').getByRole('button', { name: /create design/i });
  await createButton.waitFor({ state: 'visible', timeout: 10000 });
  await createButton.click();

  // Wait for editor to load
  await page.locator('.layers-panel, .editor__layers-panel').first().waitFor({ timeout: 30000 });

  // Close welcome dialog if present
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

async function switchToEmailWorkspace(page: Page): Promise<void> {
  // Use keyboard shortcut Ctrl+Shift+6 to switch to Email workspace
  await page.keyboard.press('Control+Shift+6');
  await page.waitForTimeout(1000);

  // Verify we're in Email workspace
  const emailWorkspace = page.getByRole('radio', { name: 'Email workspace' });
  await expect(emailWorkspace).toBeChecked();
}

async function captureElementBounds(
  page: Page,
  selector: string,
  _name: string,
): Promise<BoundingBox | null> {
  const element = page.locator(selector).first();
  if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
    const box = await element.boundingBox();
    if (box) {
      return {
        x: Math.round(box.x * 2), // Account for deviceScaleFactor
        y: Math.round(box.y * 2),
        width: Math.round(box.width * 2),
        height: Math.round(box.height * 2),
      };
    }
  }
  return null;
}

async function captureScreenshotWithMetadata(
  page: Page,
  filename: string,
  description: string,
  elementSelectors: Record<string, string> = {},
): Promise<void> {
  const filepath = path.join(artifactsDir, filename);
  await page.screenshot({ path: filepath, fullPage: false });

  const elements: Record<string, BoundingBox> = {};
  for (const [name, selector] of Object.entries(elementSelectors)) {
    const bounds = await captureElementBounds(page, selector, name);
    if (bounds) {
      elements[name] = bounds;
    }
  }

  screenshots.push({
    filename,
    description,
    elements,
  });

  console.log(`[OK] Captured: ${filename} - ${description}`);
}

test('dogfood Email workspace and capture screenshots', async ({ page }) => {
  console.log('\n[START] Starting Email Workspace Dogfood Test\n');

  // Navigate to editor
  await navigateToEditor(page);
  console.log('[OK] Navigated to editor');

  // Switch to Email workspace
  await switchToEmailWorkspace(page);
  console.log('[OK] Switched to Email workspace');

  // Wait a moment for workspace to settle
  await page.waitForTimeout(1000);

  // Capture 1: Full Email workspace view
  await captureScreenshotWithMetadata(
    page,
    '01-email-workspace-full.png',
    'Full Email workspace with inspector, layers, and canvas',
    {
      'workspace-tabs': '.workspace-dock__bar',
      'layers-panel': '.layers-panel',
      inspector: '.inspector',
      canvas: '.editor-canvas',
      toolbar: '.toolbar',
    },
  );

  // Look for the Email inspector tab and click it
  const emailInspectorTab = page.getByRole('tab', { name: /email/i }).first();
  if (await emailInspectorTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await emailInspectorTab.click();
    await page.waitForTimeout(500);
    console.log('[OK] Clicked Email inspector tab');
  }

  // Capture 2: Email inspector panel
  await captureScreenshotWithMetadata(
    page,
    '02-email-inspector.png',
    'Email inspector with authoring controls',
    {
      'inspector-tabs': '.inspector__tabs',
      'email-panel': '.inspector__content',
    },
  );

  // Now let's create some email content
  // First, create a frame for the email container
  const toolbarFrameButton = page.getByRole('button', { name: /frame/i, exact: false }).first();
  if (await toolbarFrameButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await toolbarFrameButton.click();
    await page.waitForTimeout(300);

    // Draw a frame on the canvas (600x800 typical email size)
    const canvas = page.locator('.editor-canvas').first();
    const canvasBox = await canvas.boundingBox();
    if (canvasBox) {
      const startX = canvasBox.x + canvasBox.width / 2 - 150;
      const startY = canvasBox.y + canvasBox.height / 2 - 200;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 300, startY + 400);
      await page.mouse.up();
      await page.waitForTimeout(500);
      console.log('[OK] Created email frame');
    }
  }

  // Select the frame and add text
  const selectTool = page.getByRole('button', { name: /^select$/i, exact: false }).first();
  if (await selectTool.isVisible({ timeout: 2000 }).catch(() => false)) {
    await selectTool.click();
    await page.waitForTimeout(300);
  }

  // Try to add a text node
  const textTool = page.getByRole('button', { name: /text/i, exact: false }).first();
  if (await textTool.isVisible({ timeout: 2000 }).catch(() => false)) {
    await textTool.click();
    await page.waitForTimeout(300);

    // Click on canvas to create text
    const canvas = page.locator('.editor-canvas').first();
    const canvasBox = await canvas.boundingBox();
    if (canvasBox) {
      const textX = canvasBox.x + canvasBox.width / 2;
      const textY = canvasBox.y + canvasBox.height / 2 - 150;
      await page.mouse.click(textX, textY);
      await page.waitForTimeout(300);

      // Type some text
      await page.keyboard.type('Design without the detour');
      await page.waitForTimeout(500);
      console.log('[OK] Added header text');
    }
  }

  // Capture 3: Canvas with email content
  await captureScreenshotWithMetadata(
    page,
    '03-email-canvas-content.png',
    'Canvas with email frame and text content',
    {
      canvas: '.editor-canvas',
      'email-frame': '.editor-canvas frame',
    },
  );

  // Look for Email Preview panel
  const emailPreviewPanel = page
    .locator('[data-panel-id="emailPreview"], .email-preview-panel')
    .first();
  if (await emailPreviewPanel.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('[OK] Found Email Preview panel');

    // Capture 4: Email Preview desktop
    await captureScreenshotWithMetadata(
      page,
      '04-email-preview-desktop.png',
      'Email preview in desktop mode',
      {
        'preview-panel': '.email-preview-panel',
        'desktop-toggle': 'button[aria-label*="desktop" i], button:has-text("Desktop")',
        'mobile-toggle': 'button[aria-label*="mobile" i], button:has-text("Mobile")',
      },
    );

    // Try to switch to mobile preview
    const mobileToggle = page
      .locator('button[aria-label*="mobile" i], button:has-text("Mobile")')
      .first();
    if (await mobileToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
      await mobileToggle.click();
      await page.waitForTimeout(500);

      // Capture 5: Email Preview mobile
      await captureScreenshotWithMetadata(
        page,
        '05-email-preview-mobile.png',
        'Email preview in mobile mode',
        {
          'preview-panel': '.email-preview-panel',
          'mobile-toggle': 'button[aria-label*="mobile" i], button:has-text("Mobile")',
        },
      );

      console.log('[OK] Captured mobile preview');
    }
  }

  // Look for Email Output panel
  const emailOutputPanel = page
    .locator('[data-panel-id="emailOutput"], .email-output-panel')
    .first();
  if (await emailOutputPanel.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('[OK] Found Email Output panel');

    // Capture 6: Email Output HTML
    await captureScreenshotWithMetadata(
      page,
      '06-email-output-html.png',
      'Email Output panel with generated HTML',
      {
        'output-panel': '.email-output-panel',
        'html-code': '.email-code-editor',
      },
    );
  } else {
    // Try to open it from menu or panels
    console.log('! Email Output panel not visible, trying to open it');
  }

  // Look for preflight/compatibility panel
  const preflightPanel = page
    .locator('.email-preflight-panel, [data-testid="email-preflight"]')
    .first();
  if (await preflightPanel.isVisible({ timeout: 1000 }).catch(() => false)) {
    // Capture 7: Preflight results
    await captureScreenshotWithMetadata(
      page,
      '07-email-preflight.png',
      'Email preflight and compatibility results',
      {
        'preflight-panel': '.email-preflight-panel',
      },
    );
    console.log('[OK] Captured preflight panel');
  }

  // Capture 8: Layers panel showing email structure
  const layersPanel = page.locator('.layers-panel').first();
  if (await layersPanel.isVisible({ timeout: 1000 }).catch(() => false)) {
    await captureScreenshotWithMetadata(
      page,
      '08-layers-panel-email.png',
      'Layers panel showing email document structure',
      {
        'layers-panel': '.layers-panel',
        'layer-rows': '.layers-panel .layer-row',
      },
    );
    console.log('[OK] Captured layers panel');
  }

  // Capture 9: Close crop of canvas
  const canvasArea = page.locator('.editor-canvas').first();
  if (await canvasArea.isVisible({ timeout: 1000 }).catch(() => false)) {
    await canvasArea.screenshot({ path: path.join(artifactsDir, '09-canvas-crop.png') });
    screenshots.push({
      filename: '09-canvas-crop.png',
      description: 'Close crop of canvas showing email design',
      elements: {},
    });
    console.log('[OK] Captured canvas crop');
  }

  // Capture 10: Whole workspace one more time with everything visible
  await captureScreenshotWithMetadata(
    page,
    '10-email-workspace-complete.png',
    'Complete Email workspace showing finished email design',
    {
      'workspace-tabs': '.workspace-dock__bar',
      toolbar: '.toolbar',
      'layers-panel': '.layers-panel',
      canvas: '.editor-canvas',
      inspector: '.inspector',
      'email-preview': '.email-preview-panel',
      'email-output': '.email-output-panel',
    },
  );

  // Write metadata JSON
  const metadataPath = path.join(artifactsDir, 'screenshot-metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(screenshots, null, 2));
  console.log(`\n[OK] Saved metadata to ${metadataPath}`);

  // Write a summary report
  const reportPath = path.join(artifactsDir, 'dogfood-report.md');
  const report = `# Email Workspace Dogfood Report

Date: ${new Date().toISOString()}
Viewport: 1920x1080 @ 2x scale
Environment: Dev server on http://localhost:1420

## Screenshots Captured

${screenshots.map((s, i) => `${i + 1}. **${s.filename}** - ${s.description}`).join('\n')}

## UI Elements Captured

${screenshots
  .map((s) => {
    const elementsText =
      Object.keys(s.elements).length > 0
        ? Object.entries(s.elements)
            .map(
              ([name, box]) =>
                `  - ${name}: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`,
            )
            .join('\n')
        : '  (no elements tracked)';
    return `### ${s.filename}\n${elementsText}`;
  })
  .join('\n\n')}

## Notes

- All screenshots are captured at 2x device scale factor for high quality
- Bounding boxes are in screenshot pixel coordinates (already scaled)
- Elements may not be visible in all screenshots

## Issues Found

(To be filled in by reviewing the screenshots and interaction log)
`;

  fs.writeFileSync(reportPath, report);
  console.log(`[OK] Saved report to ${reportPath}`);

  console.log('\n[DONE] Email Workspace Dogfood Test Complete!\n');
  console.log(`Artifacts saved to: ${artifactsDir}`);
  console.log(`Total screenshots: ${screenshots.length}`);
});
